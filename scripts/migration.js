/** Non-destructive, idempotent conversion from PF1AE v1 reloadState. */
export const OLD_NS = "pf1-automation-engine";
export const NEW_NS = "pf1-firearms-and-reload";
const KEY = "reloadState";
const clone = value => foundry.utils.deepClone(value);
const valid = state => state?.schema === 1 &&
  Number.isSafeInteger(state.capacity) && state.capacity >= 1 && state.capacity <= 100 &&
  Array.isArray(state.slots) && state.slots.length <= state.capacity &&
  state.slots.every(slot => typeof slot?.ammoId === "string" && slot.ammoId.length > 0);
const weapons = actor => [...(actor?.items?.contents ?? actor?.items?.values?.() ?? [])]
  .filter(item => item?.type === "weapon");
const collectActors = () => {
  const result = new Map();
  const add = actor => { if (actor?.uuid) result.set(actor.uuid, actor); };
  for (const actor of game.actors?.contents ?? []) add(actor);
  for (const scene of game.scenes?.contents ?? []) {
    for (const token of scene.tokens?.contents ?? []) {
      // Unlinked token actor is synthetic and has a distinct UUID.
      add(token.actor);
    }
  }
  return [...result.values()];
};
export async function migrateLegacyReload() {
  if (!game.user?.isGM) return { skipped: true, reason: "GM required" };
  // Do not migrate concurrently from multiple GMs. Lowest active GM id wins.
  const gms = [...(game.users?.contents ?? [])].filter(user => user.active && user.isGM)
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  if (gms.length && gms[0].id !== game.user.id)
    return { skipped: true, reason: "Another GM is migration coordinator" };
  const report = { migrated: 0, preserved: 0, invalid: [], failed: [] };
  for (const actor of collectActors()) {
    for (const weapon of weapons(actor)) {
      try {
        const existing = weapon.getFlag(NEW_NS, KEY);
        if (existing !== undefined) {
          if (!valid(existing)) report.invalid.push(weapon.uuid + ": invalid destination");
          else report.preserved++;
          continue;
        }
        const original = weapon.getFlag(OLD_NS, KEY);
        if (original === undefined) continue;
        if (!valid(original)) {
          report.invalid.push(weapon.uuid + ": invalid legacy state");
          continue;
        }
        const snapshot = clone(original);
        // Historical flags are deliberately retained as rollback data.
        await weapon.setFlag(NEW_NS, KEY, snapshot);
        const stored = weapon.getFlag(NEW_NS, KEY);
        if (JSON.stringify(stored) !== JSON.stringify(snapshot)) {
          report.failed.push(weapon.uuid + ": read-back mismatch");
          // Do not erase the legacy state or try an unverified correction.
        } else report.migrated++;
      } catch (error) {
        report.failed.push(weapon.uuid + ": " + String(error?.message ?? error));
      }
    }
  }
  console.info("[PF1FR][Migration] Non-destructive reload state migration", report);
  return report;
}
