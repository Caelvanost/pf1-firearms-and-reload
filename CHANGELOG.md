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
