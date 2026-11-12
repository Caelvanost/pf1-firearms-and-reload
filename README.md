# PF1 Firearms & Reload

Development extraction of the **tested PF1 Automation Engine v1.24.5 reload core** for Foundry VTT 13.351 / Pathfinder 1e 11.11.

> **Development preview — do not install on a production world yet.** No release ZIP is published. The legacy PF1AE reload engine has **not yet** been removed. If old PF1AE is active, the new engine remains disabled until PF1AE explicitly advertises `api.reloadDelegated === true`.

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

- Original PF1AE stores weapon locks in a client-local `Set`. This is **not a distributed transactional lock**, and simultaneous players/GM actions remain a race risk.
- The source regression suite relies on a simulated PF1 ActionUse and **does not replace live Foundry v13.351 / PF1 v11.11 validation**.
- Migration coordination by the lowest active GM ID avoids routine simultaneous runs but does not establish a distributed lock.
- The historical `reloadEnabled` world setting is copied once to the new namespace when accessible, with a `migrationSchema` marker. It is left intact for rollback. A disconnected/absent source setting is logged and not overwritten.
- New API migration, compatibility adapter, acceptance tests and release publishing remain pending.

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

A draft PF1AE 1.24.6 branch removes `reload-core.js` from `esmodules` and installs a compatibility-only `reload-adapter.js`. The standalone engine's ownership guard activates only when PF1AE is absent/inactive or its adapter sets `api.reloadDelegated === true`. Node tests exercise all three states. This is **not** proof of multiplayer atomicity or a live PF1 ActionUse regression test.
