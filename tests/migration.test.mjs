import test from "node:test";
import assert from "node:assert/strict";
import { migrateLegacyReload } from "../scripts/migration.js";
const old="pf1-automation-engine", modern="pf1-firearms-and-reload";
function makeWeapon(id, legacy, destination) {
  const flags = { [old]: legacy ? {reloadState:structuredClone(legacy)} : {}, [modern]:destination ? {reloadState:structuredClone(destination)} : {} };
  return {id,type:"weapon",uuid:"Actor.test.Item."+id,
    getFlag(ns,k){ return flags[ns]?.[k]; },
    async setFlag(ns,k,val){ (flags[ns]??={})[k]=structuredClone(val); }
  };
}
function state(n=2){return {schema:1,capacity:2,ammoType:"gunBullet",base:"standard",actionId:null,
  actionCosts:{double:2},slots:Array.from({length:n},()=>({ammoId:"balls"}))};}
function fixture(actorItems, tokens=[]) {
  globalThis.foundry={utils:{deepClone:structuredClone}};
  globalThis.game={
    user:{id:"gm1",isGM:true},
    users:{contents:[{id:"gm1",isGM:true,active:true}]},
    actors:{contents:[{uuid:"Actor.test",items:{contents:actorItems}}]},
    scenes:{contents:[{tokens:{contents:tokens}}]}
  };
}
test("migration copies loaded 2/2 and preserves source, existing native actions",async()=>{
  const weapon=makeWeapon("gun",state());weapon.actions=[{id:"reload",name:"Recharger"}];
  fixture([weapon]);
  const result=await migrateLegacyReload();
  assert.equal(result.migrated,1);
  assert.equal(weapon.getFlag(modern,"reloadState").slots.length,2);
  assert.deepEqual(weapon.getFlag(old,"reloadState"),state());
  assert.equal(weapon.actions[0].id,"reload");
  const again=await migrateLegacyReload();
  assert.equal(again.migrated,0);
  assert.equal(again.preserved,1);
});
test("migration does not clobber already-migrated state",async()=>{
  const weapon=makeWeapon("gun",state(2),state(1));fixture([weapon]);
  const result=await migrateLegacyReload();
  assert.equal(result.migrated,0);
  assert.equal(weapon.getFlag(modern,"reloadState").slots.length,1);
});
test("invalid legacy state is rejected, never cleared",async()=>{
  const invalid={schema:1,capacity:1,slots:[{ammoId:"a"},{ammoId:"a"}]};
  const weapon=makeWeapon("gun",invalid);fixture([weapon]);
  const result=await migrateLegacyReload();
  assert.equal(result.invalid.length,1);
  assert.equal(weapon.getFlag(modern,"reloadState"),undefined);
  assert.deepEqual(weapon.getFlag(old,"reloadState"),invalid);
});
test("unlinked synthetic token actor is included",async()=>{
  const weapon=makeWeapon("synthetic",state(1));
  fixture([], [{actor:{uuid:"Scene.s.Token.t.Actor.a",items:{contents:[weapon]}}}]);
  const result=await migrateLegacyReload();
  assert.equal(result.migrated,1);
});
test("player cannot execute migration",async()=>{
  const weapon=makeWeapon("gun",state());fixture([weapon]);game.user.isGM=false;
  const result=await migrateLegacyReload();
  assert.equal(result.skipped,true);
  assert.equal(weapon.getFlag(modern,"reloadState"),undefined);
});

test("world reload opt