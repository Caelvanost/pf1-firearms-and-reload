# External ammunition consumption API (PF1FR v0.5.0)

Target: Foundry VTT 13.351 / PF1 11.11. This API lets feats, class abilities, skills and other **non-weapon ItemActions** consume ammunition already **reserved in an actual loaded weapon** without generating an ordinary attack.

## APIs

```javascript
const api=game.modules.get("pf1-firearms-and-reload")?.api?.reload;
const check=api.canConsumeAmmo(weapon,{count:1});
const result=await api.consumeAmmo(weapon,{
 count:1,reason:"external-script",idempotencyKey:"unique-per-use-operation"
});
```

Both return a structured result with `ok`, `reason`, `loaded`, `capacity`, `needed`, `weaponUuid`. Successful consumption also reports `consumed`, `ammoIds`, `operationKey`, `duplicate`. `canConsumeAmmo` is **synchronous and strictly read-only**, and never initializes a weapon. If the weapon has not yet been configured, use PF1FR's existing `api.initialize(weapon)` outside the preflight as an explicit setup step, then reload it normally.

`consumeAmmo` removes the requested **first N reserved chambers** and deducts the matching **native PF1 ammunition Item quantity**, respecting each exact loaded Item ID. Also supports an explicitly native-linked legacy `loot/ammo` Item already recognized by PF1FR. `system.abundant === true` ammunition empties the selected chambers without reducing inventory quantity. There is **no** call to `ActionUse.process()`, `weapon.use()`, or native `subtractAmmo()`: do not call any of these from the external ability.

It refuses missing or incompatible inventory items, insufficient quantities, invalid or non-owned weapons, insufficient chambers, destroyed/exploded weapons, concurrent local operations, and flagged reconciliation. A weapon is **not** considered unusable solely because it has PF1's broken condition after a first misfire; it may still shoot subject to PF1's broken-weapon rules.

## Idempotency and transaction limitations

Provide a unique `idempotencyKey` for **one external ability invocation**, e.g. one native PF1 ActionUse plus one specific ammo operation. The key is recorded with the modified chambers in the weapon's existing `reloadState.externalOps` (last 32 successful keys). Repeating the same key and count returns `ok:true,duplicate:true,consumed:0` without another debit; reusing it with a different count fails.

The module serializes weapon operations and matching ammunition stacks **on the current client**; native PF1 shots also respect the local weapon lock. It writes the inventory **before** writing the chamber state. If the chamber write fails and the weapon state can be verified unchanged, it attempts to refund the inventory. If the server accepted one update before reporting an error, if rollback fails, or if documents were changed concurrently, it flags reconciliation and blocks further external consumption.

**Foundry does not provide an atomic transaction spanning two Item documents**, nor a cross-client compare-and-swap lock. The client-side locks, operation keys and state checks prevent double submissions on one client and detect many inconsistencies, but **simultaneous requests from two different user clients are not provably serializable**. For strict multi-client exactly-once guarantees, an authoritative single-writer/GM arbitration service would be needed; do not claim atomicity here. Prefer the acting owner/client to invoke the script once. On a reconciliation warning, the GM must inspect ammo quantity and the weapon's `reloadState.slots` before clearing `flags.pf1-firearms-and-reload.externalAmmoNeedsReconciliation`.

## Cancelable PF1 native ActionUse

The PF1 v11.11 event `pf1PreActionUse(actionUse)` is **cancellable** by returning `false`; this is separate from Script Calls, whose mere `return false` is **not** a documented native cancellation contract.

PF1FR exposes a safe optional cancellation bridge for an **active native** ability use, not just weapon actions:

```javascript
const use=api.findExternalActionUse({item,action}); // action optional if exactly one active use
const cancellation=api.abortExternalUse({
 item,action,reason:"insufficient-ammo"
});
```

If a unique native use is found **before** `pf1PreActionUse`, PF1FR marks that instance. Its own synchronous hook returns `false` when PF1 reaches it, cancelling the action. If the hook already passed, `abortExternalUse` returns `{ok:false,reason:'native-pre-use-already-passed'}`; it does not pretend the action was cancelled retroactively. Cancellation is never applied to an unrelated action or actor. The Script Call must not apply its own effects on failure, even when the native cancellation boundary has already passed.

## Complete PF1 11.11 Script Call: Utility Shot — category **Utilisation**

The following Script Call works on the **ability Item** (one of the actions "Blast Lock", "Scoot Unattended Object", "Stop Bleeding"). It does not know, check, or consume Grit. Put any independent ability prerequisite checks **before** the ammo preflight. Keep the ability's native actions **nonattacking and without native ammo cost**, or they may also consume ammunition outside this API.

```javascript
// PF1FR v0.5.0 — External ability ammo consumption.
// PF1 Script Call category: Utilisation.
// Works on the ability Item, not the firearm. Does not perform attacks.
// Add independent resource/eligibility checks ABOVE the ammo request.

const API = game.modules.get("pf1-firearms-and-reload")?.api?.reload;

if (!API) {
  ui.notifications.error("PF1 Firearms & Reload n'est pas disponible.");
  return;
}

const abilityItem = item;
const actor = abilityItem?.actor;
const nativeAction = typeof action !== "undefined" ? action : undefined;

// An actual live PF1 ActionUse is needed for per-use idempotency;
// refuse ambiguous overlapping uses rather than guessing an attack ID.
const actionUse = API.findExternalActionUse({
  item: abilityItem,
  action: nativeAction
});

function refuse(reason) {
  const cancellation = API.abortExternalUse({
    item: abilityItem,
    action: nativeAction,
    reason
  });
  ui.notifications.warn(
    "Action impossible : " + reason +
    (cancellation.ok ? " (utilisation annulée)." :
      " (annulation native non confirmée).")
  );
}

if (!actor || !actionUse) {
  refuse("utilisation native introuvable ou ambiguë");
  return;
}

// Restrict this example to one **equipped**, **PF1FR-configured** gun.
// Several equipped guns are ambiguous: do not pick arbitrarily.
const equipped = [...actor.items].filter(w =>
  w.type === "weapon" &&
  w.system?.equipped === true &&
  API.getState(w) != null &&
  /pistolet|pistol|mousquet|musket|tromblon|blunderbuss/i.test(w.name)
);

if (equipped.length !== 1) {
  refuse("sélectionne exactement une arme à feu équipée et configurée");
  return;
}

const weapon = equipped[0];

// Read-only check. Other prerequisites (including class resources)
// remain entirely outside PF1FR and belong ABOVE consumeAmmo().
const check = API.canConsumeAmmo(weapon, {count:1});

if (!check.ok) {
  refuse("munitions indisponibles : " + check.reason);
  return;
}

// Stable for the current native ActionUse, new for the next use.
actionUse.shared ??= {};
actionUse.shared.pf1frExternalAmmoKeys ??= {};
const keyName = "utility-shot-external-ammo";
actionUse.shared.pf1frExternalAmmoKeys[keyName] ??=
  foundry.utils.randomID();

const result = await API.consumeAmmo(weapon, {
  count:1,
  reason:"Utility Shot",
  idempotencyKey:actionUse.shared.pf1frExternalAmmoKeys[keyName]
});

if (!result.ok) {
  refuse("consommation refusée : " + result.reason);
  return;
}

// Exactly one round is now spent (or an already-completed invocation was
// recognized by its key). Let the ability's ordinary PF1 use continue.
console.info("[PF1FR] Utility-style ammunition consumed", result);
```

**Caveat:** this sample depends on the **Utilisation** Script Call occurring after `pf1CreateActionUse` and before `pf1PreActionUse`. The system's existing event sequence supports this integration model, but the actual callback order with this ability must be validated in the user's world. If the script fires after the pre-use hook, the API will report cancellation as not possible and will **never** claim the native action was prevented. For fully authoritative pre-use validation, register a synchronous pre-use policy before play, not an awaited mutation in a `Hooks.call` callback.

## Diagnostics and public hooks

```javascript
const api=game.modules.get("pf1-firearms-and-reload")?.api?.reload;
console.log(api.externalAmmoDiagnostic());
console.log(api.ammoDiagnostic(weapon));
console.log(api.getState(weapon));
```

Events:

- `pf1frAmmoConsumed`: successful external consumption.
- `pf1frAmmoConsumeDenied`: refusal or a compensated failed update.
- `pf1frAmmoReconciliationRequired`: consistency could not be restored.
- `pf1frAmmoExternalUseBlocked`: targeted native PF1 ActionUse cancelled in the pre-use hook.

Test with the 2-slot pistol: 2→1→0, empty refusal, insufficient physical inventory, abundant stock, exploded gun, simultaneous same-client calls, duplicate keys, external→native→external, failure/compensation and F5 recovery. A successful operation's last 32 keys survive F5 in the weapon's reload state.
