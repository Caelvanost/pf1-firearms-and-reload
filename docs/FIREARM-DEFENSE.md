# Firearm defense resolution — PF1AE v1.25.0 integration (PF1FR v0.4.1)

PF1AE now publishes `api.attackResolution.registerDefenseProvider({id,priority,resolve})`. PF1 Firearms & Reload registers a provider on startup when PF1AE is active; no change to PF1's native Action `touch` checkbox, attack roll, damage, ammunition, reload or misfire scripts.

**Action configuration**: Keep the native `Contact` / `Touch` checkbox unchecked on ordinary firearms, and set PF1AE's per-action defense selector to **auto**. A forced PF1AE action defense override takes precedence over the firearm provider.

**Distance**: The provider calls PF1AE's **`api.range.measure(origin,target,canvas.grid)`** to measure the nearest occupied grid cells; it uses **`api.range.convert(value,sceneUnit,weaponUnit)`** for the same 5 ft = 1.5 m convention as PF1AE's range penalty logic. It reads the actual PF1 Action range increment and units and selects touch AC for early firearms within one increment and advanced firearms within five. After that it selects normal AC; outside the allowed five/ten increments it returns `manual`, as the generic provider contract cannot block attacks on its own. Range penalties remain owned exclusively by PF1AE and are never added twice.

**Evidence safety**: Only ranged weapon attacks on recognizable firearms are affected. The attacker Token UUID must resolve unambiguously and both Tokens must belong to the active scene. Missing metadata, targets, distances, other-scene or scatter situations return `manual` for a recognized firearm (or `null` for non-firearms); no silent AC guess. Multiple targets without verified per-roll matching remain indeterminate in PF1AE itself.

**Deadeye**: `api.defense.setAttackOverride` still requires a validated single-shot identity. The provider only accepts a naturally verified `sourceMessageId:attackIndex` identity from PF1AE, so a future Deadeye Script Call needs a validated pre-roll binding strategy before the override can be reliably consumed. Do not treat Deadeye as fully automated in this release.

**Testing**: Use the actual pistol with 20 ft range on a metric 1.5 m grid. At 4.5 m, PF1AE's resolved `defense.type` should be `touch`; at 12 m, it should be `normal`. Inspect:
```javascript
console.log(game.modules.get('pf1-automation-engine')?.api?.attackResolution?.listDefenseProviders());
console.log(game.modules.get('pf1-automation-engine')?.api?.attackResolution?.lastDiagnostic());
console.log(game.modules.get('pf1-firearms-and-reload')?.api?.defense?.lastDiagnostic());
```
The registration list should include `pf1-firearms-and-reload` with priority 100. PF1AE's full hit/AC comparison still depends on unambiguous native target, d20 and any concealment checks.

If PF1AE is absent, PF1FR's reload, ammunition, misfire and explosion features still work independently. No provider is registered.

## Original standalone resolver (v0.4.0)

This is a standalone **rules selection** API for Foundry 13 / PF1 11.11. It does **not** roll, alter an attack, calculate range penalties, compare against AC, or declare a hit.

## Availability / partner contract

As audited on 2026-11-14, PF1 Automation Engine version **1.24.6** has `attackEvents` and `attackOutcomes`, but **does not export** `api.attackResolution` or `registerDefenseProvider`. Consequently **there is NO PF1AE registration in this release**. The caller must supply a measured target distance and the native attack Action. No native automatic comparison uses this module yet.

```js
const defense=game.modules.get("pf1-firearms-and-reload")?.api?.defense;
const weapon=actor.items.get("ACTUAL_WEAPON_ID");
const action=[...weapon.actions.values()].find(a=>a.hasAttack);
const answer=defense.resolveForAttack({
  actorUuid:actor.uuid,
  weapon, action,
  attackId:"unique-shot-0", attackIndex:0,
  distance:12, distanceUnits:"m", sceneUnits:"m"
});
console.log(answer,defense.lastDiagnostic());
```

`status:"ok"` with `type:"touch"` or `type:"normal"` is a **defense recommendation**. `status:"out-of-range"` must be rejected by the eventual generic engine. `status:"unresolved"` means manual resolution or additional context is required. A non-firearm returns `null`.

## Game rules

| Firearm type | Touch AC | Maximum |
| --- | --- | --- |
| Early / primitive | first range increment | 5 increments |
| Advanced | first five range increments | 10 increments |

The engine does **not** apply any −2 range penalties; that is reserved for the generic attack pipeline. Measurement boundaries use actual numerical distance with a small floating point tolerance.

## Weapon configuration and provenance

Set Foundry Item flags in namespace `pf1-firearms-and-reload`:

- `firearmCategory`: `"early"`, `"advanced"`, `"other"` (explicit exclusion).
- `rangeIncrement`: positive numeric increment.
- `rangeUnits`: `"ft"`, `"m"` or `"scene"` (requires `sceneUnits` in the supplied context).
- `touchIncrements`: optional positive integer.
- `maxIncrements`: optional positive integer.

There is no dedicated UI in this experimental phase. Native metadata, when recognizable, is preferred over name patterns. The name fallback is provided only for known weapon types; a renamed/unrecognized firearm should be explicitly configured. If native range units are missing or ambiguous, the resolver fails closed instead of assuming English or metric units.

## Precise single-attack exception

```js
defense.setAttackOverride({
  actorUuid:actor.uuid,itemUuid:weapon.uuid,actionId:action.id,
  attackId:"unique-shot-0",defense:"touch",reason:"deadeye",
  validated:true // caller already verified all ability conditions and Grit costs
});
// Use EXACT matching identity in resolveForAttack; the override is consumed once.
defense.cancelAttackOverride({
  actorUuid:actor.uuid,itemUuid:weapon.uuid,actionId:action.id,attackId:"unique-shot-0"
});
```

Overrides require exact attack IDs and caller-side validation and expire after 120 seconds. They cannot circumvent maximum range. The eventual integration must ensure this ID corresponds to the real attack before the comparison and cancels it upon abort. The engine does NOT validate Deadeye class features or spend Grit itself. For simultaneous barrels use distinct `attackId` values. The API deliberately refuses ambiguous multi-target scatter.

## Outstanding integration work

- Confirm PF1AE's actually published `attackResolution` provider registration and context fields.
- Adapt the provider's signature **after it exists**, including attacker/target tokens and target-specific attack index.
- Use Foundry's native occupied-token grid measurement with exact units and scene identity, or the verified distance from PF1AE. Until then the caller must provide `distance` and `distanceUnits`; missing distances return `unresolved`.
- Offer a compact translated weapon configuration UI and expanded live tests: metric/imperial, mixed token sizes, scene changes, multiple GMs, reload and misfire regression, F5 and reconnect.
- Keep all existing reload, ammo, misfire, explosion and repair code unmodified.
