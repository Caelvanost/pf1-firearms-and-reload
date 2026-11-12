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
