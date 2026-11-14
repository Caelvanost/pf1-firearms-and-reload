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
