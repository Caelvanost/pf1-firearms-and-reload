## 0.4.1 — Live PF1AE firearm touch AC selection (experimental)

- Register a true `attackResolution.registerDefenseProvider` with PF1AE **v1.25.0** (priority 100) when available; keep PF1FR functional without that module.
- Reuse PF1AE's `api.range.measure()` for closest occupied-token distance and `api.range.convert()` for its existing metric/imperial conversion, including the 5 ft = 1.5 m table convention.
- For ordinary ranged firearm attacks, automatically request **touch** AC for primitive weapons in first increment / advanced in first five, and **normal** AC beyond. Unmeasurable or out-of-range cases are left **manual**, not falsely resolved. Existing explicit action defense settings retain precedence.
- Preserve native PF1 Action `Contact` checkbox, attack rolls, ammunition, range penalties, Reload, misfire, explosions and Quick Clear scripts. No double range penalty and no synthetic attack roll.
- Tests cover PF1AE adapter (token occupied-cell measurement, precise range boundaries, missing tokens and wrong scenes) and complete existing reload regression.
- **Known limitations:** Deadeye ability Script Call pre-roll binding is not complete; PF1AE may lack verified target mapping for simultaneous/multitarget attacks. Live Foundry validation is required.

## 0.4.0 — Standalone firearm target-defense resolver (experimental)

- Add `api.defense.getWeaponProfile(weapon,action)`, `resolveForAttack(context)`, `lastDiagnostic()`, `setAttackOverride()`, `cancelAttackOverride()` and `integrationStatus()`.
- Primitive firearms: touch AC in first range increment, maximum 5; advanced firearms: touch AC in first five, maximum 10. Beyond contact range, choose normal AC. Out-of-range and unknown measurements fail closed.
- Respect explicit firearm flags and recognizable native metadata, plus conservative name fallback. Resolve measured distance in imperial or metric units; do not duplicate existing range penalties or attack comparison.
- Deadeye-style exceptions require validated conditions and a precise actor/weapon/action/attack ID; use once, cancel explicitly, expire after 120 seconds. Independent indices for double-barrel attacks.
- Add independent test suite for boundaries, imperial/metric, configurations, overrides, unusual attacks and regressions.
- **Not yet connected to PF1AE:** the published PF1AE v1.24.6 has no `api.attackResolution` provider contract. This release exposes a standalone resolver but does NOT change live attack targeting. Native target distance measurement and translated weapon UI are deferred. See `docs/FIREARM-DEFENSE.md`.
- Existing ammo, reload, long feu and explosion processing unchanged.

## 0.3.5 — Set nonmagical exploded firearm HP to zero

- Fix explosions that left the weapon's current hit points unchanged.
- A **nonmagical** early firearm destroyed by a verified explosion now updates native PF1 item `system.hp.value=0` (and synchronizes `system.hp.offset` when the system exposes that field), preserving maximum HP and keeping its Item record for GM inspection.
- Magical early firearms remain broken/unusable and retain their current hit points under their special rules; the `exploded` flag still blocks firing and reloading.
- If an unusual item does not provide native numeric current HP, warn instead of inventing a field or modifying actor HP.
- Tests cover nonmagical destruction, magical exception, and native HP-offset synchronization. Existing reload and explosion chat card remain unchanged.

## 0.3.4 — Automatic explosion damage roll and chat buttons (experimental)

- On a confirmed early-firearm explosion, roll damage **automatically once** from the weapon's native PF1 attack damage parts; post a dedicated chat card containing the rolled result.
- Add **Jet de Réflexes DD 12**, **Appliquer les dégâts** and **Appliquer la moitié** alongside the result. Select affected tokens before clicking; uses PF1 native `actor.rollSavingThrow('ref', ...)` and `actor.applyDamage(...)` for health changes.
- Guard against accidental duplicate damage applications to the same actor from the same chat card. Saving throws remain independent of damage application so the GM can adjudicate success/evasion.
- If the native damage formula cannot be safely identified, do **not invent a value** or roll an arbitrary die. The card indicates manual adjudication instead. For exceptional weapons, a GM may explicitly set `flags.pf1-firearms-and-reload.explosionDamageFormula` to the correct normal-damage formula.
- Damage is never applied without a deliberate button click; no automatic area targeting or automatic successful-save adjudication. Weapon state, misfire origin, ammo and Reload behavior remain unchanged.

## 0.3.3 — Second misfire and explosion tracking (experimental)

- On a broken firearm, increase the natural-d20 misfire range by **+4**; an explicit weapon flag `flags.pf1-firearms-and-reload.brokenMisfireIncrease=2` enables the PF1 **+2** exception for applicable gun training. No automatic feat inference yet.
- Evaluate successive attack rolls in order, including double-barreled weapons: a first misfire breaks the firearm, and a further misfire on an already-broken **early firearm** causes an explosion.
- **Advanced firearms never explode** from repeated misfires.
- Record early firearm explosion non-destructively as `flags.pf1-firearms-and-reload.exploded=true` and `explosionPending=true`; prevent further firing and reloading while the weapon remains exploded. The weapon Item is retained to avoid irreversible deletion and preserve its data.
- Announce the burst radius when present in the description, affected creatures, **Reflex DC 12 for half damage**, and the need to determine whether a magical gun is wrecked or a nonmagical gun destroyed. Damage, saves, center selection and final loss/restoration are resolved by the GM, **not automatically**.
- Avoid false-positive automated rulings on multirole scatter attacks; they report `unresolved` until grouped-scatter detection is implemented.
- Preserve the earlier `misfire` cause flag for future Quick Clear/repair ability scripts; no automatic repair.
- Reload and native ammo consumption logic are unchanged.

## 0.3.2 — Broken firearm misfire origin flag (experimental)

- On first **confirmed** natural-d20 long feu, mark the weapon with PF1's native `system.broken=true` and persistent `flags.pf1-firearms-and-reload.misfire=true` in one Item update.
- Flag records **why** this weapon became broken. A broken weapon from another cause does not receive the misfire origin flag.
- Future item/ability scripts can read `weapon.getFlag('pf1-firearms-and-reload','misfire')===true` and, after valid repair, clear both the flag and `system.broken`.
- No automatic repair, flag clearing, explosion, damage or second-misfire resolution in this version.
- Preserve all reload, native ammunition and chooser behaviors.

## 0.3.1 — Read the natural d20 directly from PF1 attack rolls

- Fix `unresolved` misfire diagnostics caused by reading the wrong PF1 v11.11 chat-card roll structure.
- Capture evaluated native attack rolls through `pf1AttackRoll(action, roll, context)` while the associated firearm is actively firing; use the natural d20 die face rather than the modified total.
- Preserve the previous conservative parser as a fallback, isolate simultaneous weapon rolls by UUID, and clear captured rolls after completion or errors.
- No automatic broken condition, explosion, damage or repair is applied yet. Live Foundry validation is still required.

## 0.3.0 — Long-feu: phase 1 (experimental)

- Recognize firearms with an explicit **Misfire / Long feu 1–N** value in their descriptions, distinguishing early and advanced firearms conservatively.
- Examine **natural d20 faces** from PF1 native chat attack rolls after an authorized shot, never relying on an attack total or inventing a roll value.
- Report verifiable misfires through the `pf1frMisfireDetected` hook and a visible warning; expose `game.modules.get('pf1-firearms-and-reload').api.reload.misfire.lastDiagnostic()` for live Foundry testing.
- Unknown or ambiguous roll formats fail closed with diagnostic `unresolved`; crossbows and Reload actions are excluded.
- **Phase 1 does not yet mark weapons broken, suppress damage/hits, apply explosions, destroy items, or auto-repair firearms.** These effects need in-world validation and separate regression coverage, including modifiers, scatter fire, dual barrels and second misfires.
- Existing Reload button, ActionSelector closing, ammunition accounting and multiplayer behavior are unchanged.

## 0.2.7 — Close ActionSelector after Reload (experimental)

- Fix the native PF1 ActionSelector remaining open after a successful direct Reload selection.
- Find the exact chooser in Foundry V13 `foundry.applications.instances` (ApplicationV2 registry), instead of looking only in legacy `ui.windows`.
- Close only the chooser containing the clicked Reload form, preserving other applications and all Attack actions.
- Add a regression test for V2 chooser closure and isolation; no ammo or reload changes.

## 0.2.6 — PF1 ActionSelector Reload click fix (experimental)

- Capture the real PF1 v11.11 action chooser click (`div.action[data-action="click"]` inside `form#ActionSelector-Actor-...-Item-...`), as identified in a live browser trace.
- Only for uniquely matched weapon-owned `Reload`/`Recharger` actions, prevent the selector's default handler, close its chooser and call native `weapon.use({actionId,skipDialog:true})` directly.
- Preserve normal `Attack` selection and unrelated action dialogs; no ammunition logic changes.
- Add regression test that simulates the actual chooser DOM click, action resolution and native options.
- Live in-world verification is required.

## 0.2.5 — Direct Reload button fix (experimental)

- Fix the ItemAction parent resolution in PF1 v11.11: weapon-owned `Reload`/`Recharger` buttons now directly call their owning weapon's native `use({actionId,skipDialog:true})`, the same API verified by the user's working macro.
- Preserve all other action dialogs, the native Attack flow, the action ID and supplied roll mode.
- Regression tests now simulate the actual `ItemAction.parent` structure rather than a fabricated `ItemAction.item` property.
- Requires live Foundry confirmation.

## 0.2.4 — PF1 ItemAction Reload popup fix (experimental)

- Intercept the correct PF1 v11.11 action class, `pf1.components.ItemAction.use`, before it forwards Reload to the item.
- Pass `skipDialog: true` only for recognized non-attack `Reload` and `Recharger` actions; ordinary attacks and other actions remain unchanged.
- Add a regression test using only the PF1 v11.11 action interface (no newer models Action.use shortcut).
- This change still requires confirmation in a running Foundry world.

## 0.2.3 — Default action name Reload

- Automatically created native reload actions are now named **Reload** instead of **Recharger**, regardless of the client language.
- Keep accepting both `Reload` and `Recharger` on existing manually configured or previously generated weapon actions; do not rename any existing actions or change `Attack`.
- Update regression tests for default generated action names.

## 0.2.2 — Native PF1 Action.create array contract fix

- Fix `TypeError: e.map is not a function` in PF1 v11.11 when automatically generating weapon-owned Recharger actions; pass an array of action data to `Action.create([data], {parent: weapon})`.
- Strengthen tests to require array inputs, preventing the earlier permissive mock from hiding the API error.
- Existing compatible weapons are re-scanned on GM world startup; no need to delete or re-add weapons.

## 0.2.1 — Stock crossbow detection fix (experimental)

- Automatically add `Recharger` to recognized light/hand/heavy crossbows and standard early firearms without requiring native `Attack` ammunition fields to be configured first.
- Reproduce a stock `Arbalète légère` containing only `Attack` in a regression test; verify native `move` action and nonduplication on subsequent updates.
- Add `game.modules.get('pf1-firearms-and-reload').api.reload.diagnoseAutoAction(weapon)` for precise Foundry-side diagnosis.
- The real reload operation still requires compatible PF1 ammunition, and the native use-dialog bypass is not verified in all sheet variants.

## 0.2.0 — Automatic weapon-owned Reload actions (experimental)

- On GM world startup, scan existing actor-owned weapons and create the native PF1 `Recharger` action where absent.
- Also create the action for new or updated eligible weapon Items; no world-level activation setting.
- Select native activation costs: light/hand crossbows (`move`), heavy crossbows (`full`), early one-handed pistols (`standard`), muskets and blunderbusses (`full`).
- Do not modify existing Reload actions; avoid duplicates and do not guess specialized/repeating weapons.
- Retain PF1 native ammo deduction and current reload state handling.
- Rapid Reload feats, alchemical cartridges, repeating magazines and advanced firearm categories are **not automatically adjusted** in this initial release.
- The native usage-dialog bypass still requires further live verification.

## 0.1.3 — ActionUse dialog bypass (experimental)

- Skip the PF1 action configuration dialog on a recognized Reload by marking `ActionUse.shared.skipDialog` and wrapping `ActionUse.process({skipDialog:true})` through the `pf1CreateActionUse` hook.
- Preserve native PF1 attack processing, reload hooks, ammunition accounting, attack dialogs and roll options.
- Expand tests to assert no dialogue in the simulated native ActionUse processing pipeline.
- Live PF1 v11.11 validation remains necessary.

## 0.1.2 — Native action-sheet Reload dialog fix (experimental)

- Fix direct click on Recharger/Reload from PF1 v11.11 character sheet by intercepting the Action component's `use()` in addition to Item `use()`.
- Keep attack dialogs, chat roll options, native PF1 ammo deduction and post-use reload hooks unchanged.
- Add simulated character-sheet Action.use regression coverage; full Foundry verification still required.

## 0.1.1 — Instant native Reload (experimental)

- Automatically bypass PF1 handedness and roll-configuration dialogs for unambiguous non-attack `Recharger` / `Reload` actions using the native `ItemPF.use({skipDialog:true})` option.
- Preserve native action IDs, existing roll modes, attack dialogs, normal PF1 action hooks and ammo tracking.
- Support standalone Reload feats targeting exactly one eligible weapon; ambiguous targets remain unchanged.
- Add regression tests for direct Reload, default action, ordinary attacks, feature association and wrapper idempotency.

- Always-on reload manager: removing the world enable/disable setting and its migration; only Foundry module activation controls operation.
- Fail visibly and safely when an active legacy PF1AE still owns reload hooks.
# Changelog

## 0.1.0-dev.0 (unreleased)

- Initialized standalone Foundry manifest for v13.351 and PF1 11.11.
- Extracted the PF1AE v1.24.5 reload core without intentional changes to shot accounting.
- Added non-destructive legacy flag migration and preserved fallback reads.
- Copied English/French reload translations.
- Disabled the new engine while an active PF1AE has not explicitly declared reload delegation.
- **Not production-ready:** compatibility adapter, regression tests, multiclient locking and release ZIP are outstanding.
