# Firearm defense resolver — experimental v0.4.0

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
