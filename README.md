# PF1 Firearms & Reload

Development extraction of the **tested PF1 Automation Engine v1.24.5 reload core** for Foundry VTT 13.351 / Pathfinder 1e 11.11.

> **Development preview — do not install on a production world yet.** No release ZIP is published. The legacy PF1AE reload engine has **not yet** been removed. If old PF1AE is active and still loads its own reload core, the standalone engine refuses to register duplicate reload hooks; use the paired PF1AE adapter branch.

## Preserved semantics

- Weapon-specific `flags.pf1-automation-engine.reloadState` schema 1 (read-only legacy fallback), copied to `flags.pf1-firearms-and-reload.reloadState`.
- Loaded `slots` reserve rounds, without subtracting inventory at reload time.
- PF1 native attack action deducts inventory ammunition **once** on firing; the module then clears the fired loaded slots.
- Default ammunition and explicitly linked legacy `loot/ammo` are respected.
- Existing non-attack `Recharger` / `Reload` actions are preserved and triggered from `pf1PostActionUse`.
- No automatic Reload action creation, Rapid Reload effect, misfire, explosion or Quick Clear automation in this preview.
- Counter remains in the sidebar below the native Hardness field.

## Data migration and rollback

GM-only initial migration iterates world actors and accessible linked/unlinked scene token actors. It does **not** overwrite existing destination flags, delete source flags, alter ammunition quantities, reset weapon loading, change native PF1 actions or infer new quantities. Per-weapon legacy state is validated and read back. Re-running is idempotent; malformed records are logged and skipped. Prior to testing, **back up the Foundry world**. Roll back by disabling this module and returning to PF1AE v1.24.5; legacy flags are preserved.

## Known limitations / requirements before release

- Local reload/unload/configure writes are now blocked while the same weapon has an in-flight native shot. The post-use update reads current chamber slots under the local lock; a mismatch is reported for manual reconciliation. **This is still not a distributed transactional lock**: simultaneous actions from different clients may race.
- The source regression suite relies on a simulated PF1 ActionUse and **does not replace live Foundry v13.351 / PF1 v11.11 validation**.
- Migration coordination by the lowest active GM ID avoids routine simultaneous runs but does not establish a distributed lock.
- **Always-on behavior:** enabling the Foundry module is sufficient. There is no `reloadEnabled` or similar world setting. Historical PF1AE preferences are ignored and preserved unchanged for rollback.
- The source adapter and regressions exist in draft branches; real Foundry integration, distributed synchronization, acceptance tests and release publishing remain pending.

## Public API (preview)

```js
const api = game.modules.get("pf1-firearms-and-reload")?.api?.reload;
api?.getState(weapon);
api?.infer(weapon);
api?.ammoDiagnostic(weapon);
api?.lastDiagnostic();
api?.configure(weapon, { capacity: 2, ammoType: "gunBullet" });
await api?.reload(weapon, { count: 1 });
await api?.unload(weapon, { count: 1 });
```

Do not set `api.reloadDelegated` manually. That marker belongs exclusively to a future PF1AE version with its legacy engine physically removed.

## Transition verification (development branch)

A draft PF1AE 1.24.6 branch removes `reload-core.js` from `esmodules` and installs a compatibility-only `reload-adapter.js`. The standalone engine starts whenever enabled in Foundry, except when an active old PF1AE still owns reload hooks. The guard checks the legacy manifest modules (and bridge marker where needed); incompatible legacy installations produce a persistent GM notification rather than running two engines. Node tests cover the scenarios. This is **not** proof of multiplayer atomicity or a live PF1 ActionUse regression test.

## Automatic operation

Enable **PF1 Firearms & Reload** in Foundry's *Manage Modules*. No additional setting is required or provided. The Reload/Chargement widget and native Reload actions are available automatically for supported weapons. Clicking an unambiguous non-attack **Recharger / Reload** action now runs PF1's own ItemPF.use with `skipDialog: true`, bypassing the handedness/roll-mode configuration dialog. Normal attacks, unrelated actions and ambiguous feat-based Reload actions retain their native dialogs; native action scripts and inventory consumption are unchanged. Pair it with an updated PF1AE whose manifest replaces `scripts/reload-core.js` with `scripts/reload-adapter.js`; older active PF1AE versions must be upgraded or disabled to avoid double processing. The old PF1AE `reloadEnabled` preference is not read or copied. Per-weapon legacy states are still migrated.

## Concurrency and safety note

A shot blocks competing local chamber mutations until the PF1 post-use handler has removed the fired slots. When the ammunition identity or available chambers differ from the authorized shot, the module logs a `shot-reconciliation-required` diagnostic rather than silently discarding an unrelated cartridge. The underlying native PF1 inventory deduction cannot be undone safely at this stage. **Cross-client atomicity is not yet implemented.** Do not run simultaneous reload/tir operations from separate browser clients on the same weapon in this preview.

## Legacy event compatibility

The standalone engine emits its own `pf1frReload`, `pf1frReloadShot`, `pf1frReloadUnload` and `pf1frReloadFireDenied` notifications, while **also emitting** the original `pf1aeReload`, `pf1aeReloadShot`, `pf1aeUnload` and `pf1aeReloadFireDenied` event names for existing macros. Each notification is emitted after its corresponding operation only once; these hooks do not subtract inventory ammunition. Legacy PF1AE's reload core must not be loaded at the same time.

### Development ZIPs

The pull request packaging workflow publishes a **temporary GitHub Actions artifact**, not a GitHub Release. The future tag-only release workflow validates that `module.json` refers to the exact versioned ZIP asset before publishing. Both modules must be updated together and tested on a copy of the world; the old PF1AE reload engine is deliberately excluded from the future PF1AE package.

## Instant Reload action (v0.1.1)

The module automatically detects a non-attack `Recharger` or `Reload` action on a weapon (and a standalone Reload feat when there is exactly one eligible weapon). It calls the **same native PF1 Item.use action**, using the original `actionId` and any supplied roll mode, but sets `skipDialog: true`. This removes the action-usage pop-up without changing attack handling, ammunition deduction, or the existing Reload post-use hook. There is no new world setting. If the action could resolve to multiple weapons, the native dialog remains instead of guessing.

## v0.1.2 — Action-sheet click fix

The v0.1.1 Item.use-only hook missed PF1 action-sheet buttons. This version also hooks `pf1.models.components.Action.prototype.use` so the action itself delegates to PF1 with `skipDialog: true` before opening its normal configuration popup. The module remains always-on and does not change attack dialogs. Test this release directly in Foundry; the regression harness simulates the native action forwarding path.

## v0.1.3 — Native ActionUse dialog guard

The v0.1.1 and v0.1.2 sheet-method wrappers were insufficient in real-world testing. This release adds a more direct `pf1CreateActionUse` integration: recognized non-attack Reload actions receive `shared.skipDialog=true`, and their own `process()` is invoked with `skipDialog:true`. Other uses are untouched. This is an experimental update; verify the actual behavior in Foundry.

## Automatic Reload action creation (v0.2.0)

When a GM opens a world, PF1 Firearms & Reload now scans existing actor-owned weapons and automatically creates a **native non-attack** `Recharger` action on supported crossbows and early firearms that do not already have one. Newly created/updated weapon Items are handled as well. This is built using PF1's native Action component API, not a character feat; existing manually configured Reload actions are kept unchanged.

Default action economy (before feats, cartridges and special rules): **light/hand crossbow: move; heavy crossbow: full; early one-handed pistol: standard; early two-handed musket/blunderbuss: full**. Each activation reloads one chamber under the existing first-stage engine. Unrecognized/exotic, repeating and advanced firearms are intentionally excluded until their correct magazine and action rules have dedicated handling; we do not insert incorrect actions. Rapid Reload and cartridge adjustments are also a follow-up feature.

The UI's separate native PF1 action-use dialog remains a known live-testing issue despite experimental bypass attempts in v0.1.1–0.1.3; this release adds actions, but does **not** claim that the popup is resolved in all sheet variants.
