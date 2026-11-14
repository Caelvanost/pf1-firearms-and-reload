import test from "node:test";
import assert from "node:assert/strict";
import {createFirearmDefenseAPI,createPF1AEDefenseProvider} from "../scripts/defense.js";

function firearm(category="early",range=6,units="m"){
 const flags={firearmCategory:category,rangeIncrement:range,rangeUnits:units};
 return {type:"weapon",uuid:"Actor.a.Item.w",name:"Arme personnalisée",
  system:{},
  getFlag:(_ns,key)=>flags[key],flags:()=>flags};
}
const action={id:"a1",hasAttack:true,actionType:"rwak"};
function context(weapon,distance,distanceUnits="m",additional={}){
 return {weapon,action,actorUuid:"Actor.a",attackId:"attack-1",
  distance,distanceUnits,sceneUnits:"m",...additional};
}
test("primitive range boundaries and failure beyond five increments",()=>{
 const api=createFirearmDefenseAPI(),gun=firearm();
 for(const [distance,expected,type] of [
  [4.5,"ok","touch"],[6,"ok","touch"],[6.00001,"ok","normal"],
  [12,"ok","normal"],[18,"ok","normal"],[30,"ok","normal"],
  [30.1,"out-of-range",null]
 ]){const r=api.resolveForAttack(context(gun,distance));assert.equal(r.status,expected);
   assert.equal(r.type??null,type);}
 assert.equal(api.resolveForAttack(context(gun,12)).increment,2);
});
test("advanced firearms use touch through five increments; ten increments maximum",()=>{
 const api=createFirearmDefenseAPI(),gun=firearm("advanced",6);
 for(const x of [1,6,24,30])assert.equal(api.resolveForAttack(context(gun,x)).type,"touch");
 assert.equal(api.resolveForAttack(context(gun,30.1)).type,"normal");
 assert.equal(api.resolveForAttack(context(gun,60)).status,"ok");
 assert.equal(api.resolveForAttack(context(gun,60.1)).status,"out-of-range");
});
test("imperial and metric units and tolerance",()=>{
 const api=createFirearmDefenseAPI(),gun=firearm("early",20,"ft");
 assert.equal(api.resolveForAttack(context(gun,6,"m")).type,"touch");
 assert.equal(api.resolveForAttack(context(gun,20,"ft")).type,"touch");
 assert.equal(api.resolveForAttack(context(gun,20.01,"ft")).type,"normal");
 assert.equal(api.resolveForAttack(context(gun,100,"ft")).status,"ok");
 assert.equal(api.resolveForAttack(context(gun,100.1,"ft")).status,"out-of-range");
});
test("custom category and overrides, renamed weapon, native metadata and unknown",()=>{
 const api=createFirearmDefenseAPI(),gun=firearm("advanced",9);
 assert.equal(api.getWeaponProfile(gun).classificationSource,"manual");
 assert.equal(api.resolveForAttack(context(gun,20)).type,"touch");
 const native={type:"weapon",name:"Secret weapon",system:{
  weaponType:"firearm",firearmCategory:"primitive",range:{value:20,units:"ft"}
 }};
 assert.equal(api.getWeaponProfile(native,action).category,"early");
 const unknown={...native,system:{weaponType:"firearm",range:{value:20,units:"ft"}}};
 assert.equal(api.getWeaponProfile(unknown).status,"unknown");
 const nonGun={type:"weapon",name:"Arbalète légère",system:{}};
 assert.equal(api.resolveForAttack(context(nonGun,5)),null);
 const melee={...gun};assert.equal(api.resolveForAttack(context(melee,5,"m",{
 action:{hasAttack:true,actionType:"mwak"}
 })),null);
});
test("indeterminate distances/units and scatter never silently pick defense",()=>{
 const api=createFirearmDefenseAPI(),gun=firearm();
 for(const ctx of [
  context(gun,undefined),context(gun,5,"strides"),context(gun,-1),
  context(gun,5,"m",{scatter:true}),
  context(gun,5,"m",{action:{...action,scatter:true}})
 ])assert.equal(api.resolveForAttack(ctx).status,"unresolved");
 assert.equal(api.resolveForAttack(context(gun,5)).type,"touch");
});
test("single-use validated Deadeye override cannot cross a shot and cannot defeat max range",()=>{
 let clock=1000;const api=createFirearmDefenseAPI({now:()=>clock});
 const gun=firearm();
 const shot=context(gun,12,"m",{actionId:"a1",attackId:"shot-A"});
 assert.throws(()=>api.setAttackOverride({...shot,defense:"touch",reason:"deadeye"}),/validated/);
 assert.equal(api.resolveForAttack(shot).type,"normal");
 api.setAttackOverride({...shot,defense:"touch",reason:"deadeye",validated:true});
 const other={...shot,attackId:"shot-B"};
 assert.equal(api.resolveForAttack(other).type,"normal");
 const a=api.resolveForAttack(shot);
 assert.equal(a.type,"touch");assert.equal(a.overrideApplied,true);
 assert.equal(api.resolveForAttack(shot).type,"normal");
 api.setAttackOverride({...shot,defense:"touch",validated:true});
 assert.equal(api.cancelAttackOverride(shot),true);
 assert.equal(api.resolveForAttack(shot).type,"normal");
 api.setAttackOverride({...shot,defense:"touch",validated:true});
 const beyond={...shot,distance:40};
 assert.equal(api.resolveForAttack(beyond).status,"out-of-range");
 clock+=120001;assert.equal(api.pendingOverrides(),0);
 assert.equal(api.resolveForAttack(shot).type,"normal");
});
test("double barrel attack indices are independent and second shot has no Deadeye leakage",()=>{
 const api=createFirearmDefenseAPI(),gun=firearm();
 const first=context(gun,12,"m",{attackId:"double-0",attackIndex:0,actionId:"a1"});
 const second=context(gun,12,"m",{attackId:"double-1",attackIndex:1,actionId:"a1"});
 api.setAttackOverride({...first,defense:"touch",reason:"deadeye",validated:true});
 assert.equal(api.resolveForAttack(second).type,"normal");
 assert.equal(api.resolveForAttack(first).type,"touch");
 assert.equal(api.resolveForAttack(second).type,"normal");
});
test("missing increment or unsupported category fail closed; standalone API reports absent integration",()=>{
 const api=createFirearmDefenseAPI();
 const gun=firearm();delete gun.getFlag;gun.name="Pistolet custom";gun.system={};
 assert.equal(api.resolveForAttack(context(gun,6)).status,"unresolved");
 assert.equal(api.integrationStatus().available,false);
});

test("PF1AE v1.25 provider uses the SAME occupied-cell measurement as range penalties",async()=>{
 const defense=createFirearmDefenseAPI();
 const weapon=firearm("early",20,"ft");
 const origin={uuid:"Scene.scene.Token.origin",parent:{id:"scene"}};
 const target={uuid:"Scene.scene.Token.target",parent:{id:"scene"}};
 const scene={id:"scene",grid:{units:"m"}};
 let calls=0,receivedGrid=null;
 const grid={};
 const measured={distance:6};
 const api={measure(a,b,g){calls++;assert.equal(a,origin);assert.equal(b,target);
   receivedGrid=g;return measured.distance;},
  convert(value,from,to){assert.equal(from,"m");assert.equal(to,"ft");return value/0.3}};
 const provider=createPF1AEDefenseProvider({
  defense,gameRef:{modules:new Map([["pf1-automation-engine",{
    active:true,api:{range:api}}]])},canvasRef:{scene,grid},
  fromUuidRef:async uuid=>uuid===origin.uuid?origin:null});
 const ctx={actor:{uuid:"Actor.a"},item:weapon,action,attackerToken:origin.uuid,
  targetToken:target,attackIndex:0,sourceMessageId:"msg-1"};
 assert.equal(provider.id,"pf1-firearms-and-reload");
 assert.equal(provider.priority,100);
 assert.equal((await provider.resolve(ctx)).type,"touch");
 measured.distance=12;
 assert.equal((await provider.resolve(ctx)).type,"normal");
 measured.distance=30;
 assert.equal((await provider.resolve(ctx)).type,"normal");
 measured.distance=30.1;
 const outside=await provider.resolve(ctx);
 assert.equal(outside.type,"manual");
 assert.match(outside.reason,/beyond-maximum-range/);
 assert.equal(receivedGrid,grid);
 assert.equal(calls,4);
 assert.equal(action.touch,undefined,"native PF1 Contact checkbox is never mutated");
});
test("PF1AE provider returns manual safely if range/scene or target evidence is absent",async()=>{
 const defense=createFirearmDefenseAPI();
 const gun=firearm();
 const target={uuid:"Scene.scene.Token.target",parent:{id:"scene"}};
 const grid={};
 const api={measure:()=>null,convert:()=>null};
 const adapter=createPF1AEDefenseProvider({
  defense,gameRef:{modules:new Map([["pf1-automation-engine",{
   active:true,api:{range:api}}]])},canvasRef:{scene:{id:"scene",grid:{units:"m"}},grid},
  fromUuidRef:async()=>({uuid:"Scene.scene.Token.origin",parent:{id:"scene"}})});
 const base={actor:{uuid:"Actor.a"},item:gun,action,attackerToken:"origin",
  targetToken:target};
 assert.equal((await adapter.resolve(base)).type,"manual");
 assert.equal(await adapter.resolve({...base,item:{type:"weapon",name:"Arbalète",
   system:{}}}),null);
 const misplaced={...base,targetToken:{...target,parent:{id:"other"}}};
 assert.equal((await adapter.resolve(misplaced)).type,"manual");
});

function nativeScenario({advanced=false}={}){
 const actor={uuid:"Actor.owner",testUserPermission:()=>true};
 const weapon=firearm(advanced?"advanced":"early",6,"m");
 weapon.actor=actor;weapon.uuid="Actor.owner.Item.gun";
 const nativeAction={id:"fire",hasAttack:true,actionType:"rwak",parent:weapon};
 const makeUse=()=>({actor,item:weapon,action:nativeAction,shared:{chatAttacks:[]}});
 const origin={uuid:"Scene.scene.Token.origin",parent:{id:"scene"}};
 const target={uuid:"Scene.scene.Token.target",parent:{id:"scene"},actor:{
  uuid:"Actor.target",system:{attributes:{ac:{normal:{total:18},touch:{total:12}}}}}};
 let distance=12;
 const range={measure:()=>distance,convert:(n)=>n};
 const gameRef={modules:new Map([["pf1-automation-engine",{
  active:true,api:{range}}]])};
 const canvasRef={scene:{id:"scene",grid:{units:"m"}},grid:{}};
 return {actor,weapon,nativeAction,makeUse,origin,target,gameRef,
  canvasRef,range,setDistance:n=>distance=n};
}
test("native ActionUse: exact index 0 override wins; different use, actor, action and index stay isolated",async()=>{
 globalThis.game={user:{isGM:false}};
 const v=nativeScenario(),api=createFirearmDefenseAPI();
 const provider=createPF1AEDefenseProvider({defense:api,
  gameRef:v.gameRef,canvasRef:v.canvasRef,fromUuidRef:async()=>v.origin});
 const use=v.makeUse(),other=v.makeUse();
 const ctx=(actionUse,attackIndex=0,actor=v.actor)=>({
  actor,item:v.weapon,action:v.nativeAction,actionUse,
  attackerToken:v.origin.uuid,targetToken:v.target,attackIndex
 });
 assert.equal(api.captureNativeActionUse(use),true);
 assert.equal(api.prepareAttackOverride({actionUse:use,attackIndex:0,
  defense:"touch",reason:"external-script"}),true);
 assert.equal(api.pendingPreparedOverrides(),1);
 assert.equal((await provider.resolve(ctx(other))).type,"normal");
 assert.equal((await provider.resolve(ctx(use,1))).type,"normal");
 assert.equal((await provider.resolve(ctx(use,0,{
  uuid:"Actor.other",testUserPermission:()=>true
 }))).type,"normal");
 const result=await provider.resolve(ctx(use));
 assert.equal(result.type,"touch");
 assert.equal(result.reason,"external-script");
 assert.equal(api.lastDiagnostic().overrideSource,"actionUse");
 // Multiple target comparisons in one attack must NOT consume early.
 assert.equal((await provider.resolve(ctx(use))).type,"touch");
 assert.equal(api.bindActionUseMessage(use,{id:"Chat-10"}),true);
 assert.equal(api.finishResolvedAttack({
  sourceMessageId:"Chat-10",actorUuid:v.actor.uuid,itemUuid:v.weapon.uuid,
  actionId:v.nativeAction.id,attackIndex:0,defense:{type:"touch",provider:"pf1-firearms-and-reload"}
 }),true);
 assert.equal(api.pendingPreparedOverrides(),0);
 assert.equal((await provider.resolve(ctx(use))).type,"normal");
 assert.equal((await provider.resolve(ctx(other))).type,"normal");
});
test("multiple barrel indices and multiple targets: preserve other index until its own completion",async()=>{
 globalThis.game={user:{isGM:true}};
 const v=nativeScenario(),api=createFirearmDefenseAPI();
 const provider=createPF1AEDefenseProvider({
  defense:api,gameRef:v.gameRef,canvasRef:v.canvasRef,
  fromUuidRef:async()=>v.origin
 });
 const use=v.makeUse(),c=i=>({actor:v.actor,item:v.weapon,action:v.nativeAction,
  actionUse:use,attackIndex:i,targetToken:v.target,attackerToken:v.origin.uuid});
 api.captureNativeActionUse(use);
 api.prepareAttackOverride({actionUse:use,attackIndex:0,defense:"touch",reason:"override-a"});
 api.prepareAttackOverride({actionUse:use,attackIndex:1,defense:"normal",reason:"override-b"});
 assert.equal((await provider.resolve(c(0))).type,"touch");
 assert.equal((await provider.resolve(c(1))).type,"normal");
 // Another target from the SAME attack uses the same override and still
 // cannot leak into the following attack index.
 const secondTarget={...v.target,uuid:"Scene.scene.Token.other"};
 assert.equal((await provider.resolve({...c(0),targetToken:secondTarget})).type,"touch");
 api.bindActionUseMessage(use,{id:"card"});
 assert.equal(api.finishResolvedAttack({sourceMessageId:"card",actorUuid:v.actor.uuid,
  itemUuid:v.weapon.uuid,actionId:"fire",attackIndex:0}),true);
 assert.equal(api.pendingPreparedOverrides(),1);
 assert.equal((await provider.resolve(c(0))).type,"normal");
 assert.equal((await provider.resolve(c(1))).type,"normal");
 assert.equal(api.finishResolvedAttack({sourceMessageId:"card",actorUuid:v.actor.uuid,
  itemUuid:v.weapon.uuid,actionId:"fire",attackIndex:1}),true);
 assert.equal(api.pendingPreparedOverrides(),0);
});
test("cancelled ActionUse cannot affect next attack; ambiguous simultaneous uses refuse lookup",()=>{
 globalThis.game={user:{isGM:true}};
 const v=nativeScenario(),api=createFirearmDefenseAPI();
 const first=v.makeUse(),second=v.makeUse();
 api.captureNativeActionUse(first);
 assert.equal(api.findCurrentActionUse({item:v.weapon,action:v.nativeAction}),first);
 api.captureNativeActionUse(second);
 assert.equal(api.findCurrentActionUse({item:v.weapon,action:v.nativeAction}),null);
 assert.throws(()=>api.prepareForCurrentUse({
  item:v.weapon,action:v.nativeAction,defense:"touch"
 }),/No unique/);
 api.releaseNativeActionUse(second);
 assert.equal(api.prepareForCurrentUse({
  item:v.weapon,action:v.nativeAction,defense:"touch"
 }),true);
 assert.equal(api.cancelPreparedAttackOverride({actionUse:first,attackIndex:0}),true);
 assert.equal(api.pendingPreparedOverrides(),0);
 assert.equal(api.cancelPreparedAttackOverride({actionUse:first}),false);
 assert.equal(api.findCurrentActionUse({item:v.weapon,action:v.nativeAction}),null);
});
test("early and advanced firearms, hard max range, missing PF1AE and F5 never leak overrides",async()=>{
 globalThis.game={user:{isGM:true}};
 for(const advanced of [false,true]){
  const v=nativeScenario({advanced}),api=createFirearmDefenseAPI();
  const provider=createPF1AEDefenseProvider({defense:api,gameRef:v.gameRef,
   canvasRef:v.canvasRef,fromUuidRef:async()=>v.origin});
  const use=v.makeUse(),ctx={actor:v.actor,item:v.weapon,action:v.nativeAction,
   actionUse:use,attackIndex:0,attackerToken:v.origin.uuid,targetToken:v.target};
  api.prepareAttackOverride({actionUse:use,defense:"touch"});
  v.setDistance(advanced?61:31);
  assert.equal((await provider.resolve(ctx)).type,"manual",
   "override cannot bypass maximum range");
  v.setDistance(advanced?36:12);
  assert.equal((await provider.resolve(ctx)).type,"touch");
  const withoutAE=createPF1AEDefenseProvider({
   defense:api,gameRef:{modules:new Map()},canvasRef:v.canvasRef,
   fromUuidRef:async()=>v.origin});
  assert.equal((await withoutAE.resolve(ctx)).type,"manual");
  const afterRefresh=createFirearmDefenseAPI();
  assert.equal(afterRefresh.pendingPreparedOverrides(),0);
  assert.equal(afterRefresh.resolveForAttack({weapon:v.weapon,
   action:v.nativeAction,distance:12,distanceUnits:"m",attackIndex:0,
   actor:v.actor,actionUse:use}).type,advanced?"touch":"normal");
  api.clearAllPrepared();
 }
});
test("owner permission, invalid indexes, no-attack action, late preparation and null attack indexes",async()=>{
 const v=nativeScenario(),api=createFirearmDefenseAPI();
 const use=v.makeUse();
 globalThis.game={user:{isGM:false}};
 assert.equal(api.prepareAttackOverride({actionUse:use,defense:"touch"}),true);
 assert.throws(()=>api.prepareAttackOverride({actionUse:use,defense:"normal"}),/already prepared/);
 assert.throws(()=>api.prepareAttackOverride({actionUse:use,attackIndex:-1,defense:"normal"}),/Invalid native/);
 assert.throws(()=>api.prepareAttackOverride({actionUse:use,attackIndex:1,defense:"cmd"}),/Invalid defense/);
 assert.equal(api.cancelPreparedAttackOverride({actionUse:use}),true);
 const notOwner={...v.actor,testUserPermission:()=>false};
 const otherUse={...use,actor:notOwner,item:{...v.weapon,actor:notOwner}};
 assert.throws(()=>api.prepareAttackOverride({actionUse:otherUse,defense:"touch"}),/OWNER/);
 use.shared.chatAttacks.push({});
 assert.throws(()=>api.prepareAttackOverride({actionUse:use,defense:"touch"}),/before native/);
 use.shared.chatAttacks=[];
 api.prepareAttackOverride({actionUse:use,defense:"touch"});
 const adapter=createPF1AEDefenseProvider({
  defense:api,gameRef:v.gameRef,canvasRef:v.canvasRef,
  fromUuidRef:async()=>v.origin});
 const ctx={actor:v.actor,item:v.weapon,action:v.nativeAction,
  actionUse:use,attackIndex:null,attackerToken:v.origin.uuid,targetToken:v.target};
 assert.equal((await adapter.resolve(ctx)).type,"normal",
  "unknown index cannot consume or apply a prepared override");
 assert.equal(api.finishResolvedAttack({sourceMessageId:null,actorUuid:v.actor.uuid,
  itemUuid:v.weapon.uuid,actionId:"fire",attackIndex:null}),true);
 assert.equal(api.pendingPreparedOverrides(),0);
});
test("same weapon across two actors cannot receive another actor's temporary override",async()=>{
 globalThis.game={user:{isGM:true}};
 const a=nativeScenario(),b=nativeScenario(),api=createFirearmDefenseAPI();
 b.actor.uuid="Actor.someone-else";b.weapon.actor=b.actor;
 b.weapon.uuid="Actor.someone-else.Item.gun";
 const useA=a.makeUse(),useB=b.makeUse();
 api.prepareAttackOverride({actionUse:useA,defense:"touch"});
 const provider=createPF1AEDefenseProvider({
  defense:api,gameRef:a.gameRef,canvasRef:a.canvasRef,
  fromUuidRef:async()=>a.origin});
 const ctx={actor:b.actor,item:b.weapon,action:b.nativeAction,
  actionUse:useB,attackIndex:0,attackerToken:a.origin.uuid,targetToken:a.target};
 assert.equal((await provider.resolve(ctx)).type,"normal");
 assert.equal(api.pendingPreparedOverrides(),1);
 api.clearAllPrepared();
});
