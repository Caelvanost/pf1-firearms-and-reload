# Temporary defense overrides — PF1FR 0.4.2

Foundry VTT **13.351**, Pathfinder 1 **11.11**, optional PF1AE **1.25.1**.

## Purpose

This is a class-neutral, resource-neutral, **in-memory** exception for the defense selected by a *particular native PF1 attack use and attack index*. The caller is solely responsible for validating any prerequisites or resource costs. PF1FR changes **neither** ItemAction.touch nor rolls, attack bonuses, ammunition, damage, native range penalties, or weapon flags.

## Exact API: preferred when the native ActionUse object is available

```js
const api = game.modules.get("pf1-firearms-and-reload")?.api?.defense;
api.prepareAttackOverride({
  actionUse,        // actual native PF1 ActionUse instance, NOT the Item or a copy
  attackIndex: 0,   // exact native zero-based attack index (default 0)
  defense: "touch", // or "normal"
  reason: "external-script"
});
```

Return value: `true` or a **throw** on invalid/late use, unsupported action, ownership, invalid index/defense, duplicate override, or reuse of a completed ActionUse. No action ID, chat message, or roll ID is fabricated.

Cancel an entire use, or just one index:

```js
api.cancelPreparedAttackOverride({actionUse});
api.cancelPreparedAttackOverride({actionUse, attackIndex: 0});
```

Preparing one index does not change the others. All selected targets of one *verified* native attack index receive the same override, and the override is removed **after** PF1AE reports that index's resolution (its `pf1aeAttackResolution` Hook). If the native attack index is unknown, nothing is applied and the override is discarded. Unresolved or aborted uses expire after 120 seconds. F5/reconnection creates an empty in-memory registry.

## Native PF1 Usage Script Call without an exposed ActionUse variable

PF1FR observes `pf1CreateActionUse`, which carries the native instance before PF1 evaluates the attack. For Script Calls in the weapon's **Utilisation** section, the API can find that instance by the *actual Item and Action*, but ONLY if it is unambiguous.

Complete example, to place in **Utilisation** on the **weapon Item** (not its reload or repair action). This is an API example, not a resource/ability implementation:

```javascript
// Example of a generic temporary defense preference.
// Executed on the firing client's weapon Item Script Call: Utilisation.
const api = game.modules.get("pf1-firearms-and-reload")?.api?.defense;
if (!api) throw new Error("PF1 Firearms & Reload defense API unavailable.");

const eligible = [...item.actions.values()].filter(
  a => a.hasAttack === true && a.actionType === "rwak"
);
const selectedAction =
  (typeof action !== "undefined" &&
   action?.hasAttack === true &&
   action?.actionType === "rwak")
   ? action
   : (eligible.length === 1 ? eligible[0] : null);

if (!selectedAction) {
  throw new Error("Cannot identify one native ranged attack Action.");
}

// Only when the external script has already established that this
// exception should apply. This example does not spend any resource.
api.prepareForCurrentUse({
  item, action: selectedAction,
  attackIndex: 0,
  defense: "touch",
  reason: "external-script"
});
```

If a different Item invokes the script, pass the **actual attacking weapon Item** and its native **attack Action** rather than the ability Item. The helper never guesses among two concurrent ActionUse instances of the same actor/item/action. When that happens it throws and the caller should use the explicit `prepareAttackOverride({actionUse,...})` form.

Scripts can inspect the currently tracked use with `api.findCurrentActionUse({item,action})` or explicitly call `api.cancelPreparedAttackOverride({actionUse})` if an operation is interrupted.

**Ordering**: `pf1CreateActionUse` is the native pre-attack creation hook. A Script Call must run after this hook and **before** the native attack rolls. The API rejects preparation when the use already contains native chat attacks. If a specific Script Call phase runs after the attack dice on a PF1 build, move the call to a pre-roll phase. No guarantee is claimed for contexts that do not expose or identify the correct native ActionUse.

## Native PF1AE integration

The existing PF1FR defense provider receives `context.actionUse` from PF1AE 1.25.1 and uses it as the **WeakMap key** plus `context.attackIndex` and actor/item/action UUID identity. It selects a temporary `touch` or `normal` only **after** verifying the firearm classification and maximum range. It retains the value through multiple target comparisons of the same index and discards it when `pf1aeAttackResolution` finishes that index.

PF1AE 1.25.1 treats native PF1 **Contact** (`action.touch === true` or `actionUse.shared.touch === true`) as authoritative **before invoking providers**. Thus a temporary `normal` override cannot cancel a native checked Contact action. For dynamically selected defense, leave Contact unchecked.

PF1AE itself refuses ambiguous multi-target roll-to-target mappings. The provider cannot correct missing native pairing, and must not apply a prepared exception to a different roll. A generic attack with no verified index uses regular defense. Outside the firearm's maximum range the provider reports `manual`, never granting a valid out-of-range attack.

## Diagnostics

```js
const defense = game.modules.get("pf1-firearms-and-reload")?.api?.defense;
console.log(defense.pendingPreparedOverrides());
console.log(defense.lastPreparedDiagnostic());
console.log(defense.lastPreparedResolution());
console.log(defense.lastDiagnostic());
console.log(game.modules.get("pf1-automation-engine")?.api?.attackResolution?.lastDiagnostic());
```

The last prepared resolution records actor UUID, weapon UUID, action ID, attack index, chat message ID (if available), final defense and provider. The regular `lastDiagnostic` additionally records the measured increment and whether an override was applied.

The registry is **local to the client that executes the native attack**. Its contents are not broadcast to another player or MJ. The normal native roll remains client-authoritative under Foundry/PF1's existing ownership rules. On F5 the overrides intentionally disappear.

## Test coverage and limits

Automated tests include simple and double-barrel uses, multiple indices, two targets, concurrent uses, cancellation and stale reuse, distinct actors, owner checks, primitive/advanced profiles, maximum range, null attackIndex, absent PF1AE and fresh API after reload. Existing ammunition, reload, long-feu and explosion suites run unchanged.

Live verification is still required for the actual PF1 11.11 Script Call phase and ActionUse object available in your specific Foundry world. If PF1AE is disabled, the API can prepare and cancel overrides locally, but no AC provider will consume them.
