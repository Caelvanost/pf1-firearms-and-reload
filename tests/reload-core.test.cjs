'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const code=fs.readFileSync(path.resolve(__dirname,'../scripts/reload-core.js'),'utf8').replace(/^import .*migration\.js.*\n/m,'');
const domHandlers=[];
const listeners=new Map(),once=new Map(),settings=new Map([
 ['genericEnabled',true],['reloadEnabled',true]]);
const count={rolls:0,charges:0,nativeAmmo:0,messages:0,warns:0,dialogs:0};
const uuid='Actor.a.Item.w';
const actor={id:'a',uuid:'Actor.a',documentName:'Actor',items:new Map(),
 testUserPermission(){return true}};
const ammo={id:'am',type:'ammo',system:{quantity:8,subType:'gunBullet',abundant:false},
 getFlag(){return false}};
actor.items.set('am',ammo);
const weapon={id:'w',uuid,type:'weapon',actor,actions:[],system:{ammo:{default:'am'}},
 flags:{},getFlag(_n,k){return this.flags[k]},
 async setFlag(_n,k,value){this.flags[k]=structuredClone(value);return this.flags[k]},
 async update(data){
  if(data['system.ammo.default'])this.system.ammo.default=data['system.ammo.default'];
  if(Object.hasOwn(data,'system.broken'))this.system.broken=data['system.broken'];
  if(Object.hasOwn(data,'flags.pf1-firearms-and-reload.misfire'))
   this.flags.misfire=data['flags.pf1-firearms-and-reload.misfire'];
  if(Object.hasOwn(data,'flags.pf1-firearms-and-reload.exploded'))
   this.flags.exploded=data['flags.pf1-firearms-and-reload.exploded'];
  if(Object.hasOwn(data,'flags.pf1-firearms-and-reload.explosionPending'))
   this.flags.explosionPending=data['flags.pf1-firearms-and-reload.explosionPending'];
 },
};
actor.items.set('w',weapon);
const events={on(n,fn){(listeners.get(n)??listeners.set(n,[]).get(n)).push(fn)},
 once(n,fn){(once.get(n)??once.set(n,[]).get(n)).push(fn)},
 callAll(n,...args){for(const fn of listeners.get(n)??[])fn(...args)},
 call(n,...args){let allowed=true;for(const fn of listeners.get(n)??[]){
  if(fn(...args)===false)allowed=false;
 }return allowed}};
const actionType={create:async(data,{parent})=>{
 // PF1 v11.11 Action.create iterates data.map() and requires an array.
 assert.ok(Array.isArray(data),'PF1 Action.create requires an array of action records');
 assert.equal(data.length,1,'create exactly one native Reload action');
 const a={...data[0],id:'reloadA',item:parent,hasAttack:false};
 parent.actions.push(a);return [a];
}};
class ActionUse{
 constructor(action,attacks=1,item=weapon){
  this.action=action;this.item=item;this.actor=actor;
  this.shared={attacks:Array.from({length:attacks},()=>({
   hasAmmo:true,ammo:{id:'am'}
  }))};
 }
 getAmmo(){return [...actor.items.values()].filter(i=>i.type==='ammo'&&i.system?.subType===this.action.ammo?.type).map(i=>({id:i.id,quantity:i.system.quantity,abundant:!!i.system.abundant,document:i,isDefault:i.id===this.item.system.ammo.default}))}
 async generateChatAttacks(){if(this.action.hasAttack)count.rolls++}
 async process(){
  events.callAll('pf1CreateActionUse',this);
  if(this.action.hasAttack){
   const selected=this.getAmmo().find(a=>a.id===this.item.system.ammo.default);
   for(const attack of this.shared.attacks){attack.ammo=selected?{id:selected.id}:null;attack.hasAmmo=!!selected;}
  }
  await this.generateChatAttacks();
  // Native hook occurs after generation, before any ammo/charge cost.
  if(events.call('pf1PreActionUse',this)===false)return;
  if(this.action.hasAttack){
   const cost=this.shared.attacks.length*this.action.ammo.cost;
   count.nativeAmmo+=cost;
   const item=actor.items.get(this.shared.attacks[0]?.ammo?.id);
   if(item)item.system.quantity-=cost;
   count.charges++;
  }
  events.callAll('pf1PostActionUse',this,null);
  return this;
 }
}
const t=(id,cost=1)=>({id,name:id,item:weapon,actionType:'rwak',
 hasAttack:true,ammo:{type:'gunBullet',cost}});
const simple=t('shot'),double=t('double');
weapon.actions.push(simple,double);
class NativeItemUseStub { use(options={}){return {called:true,options,owner:this}} }
class NativeActionUseStub {
 constructor(item,id,name,hasAttack=false){
  // Real PF1 v11.11 ItemAction exposes parent; it need not have .item.
  this.parent=item;this.id=id;this.name=name;this.hasAttack=hasAttack;
 }
 use(options={}){return this.parent.use({...options,actionId:this.id})}
}
NativeActionUseStub.create=actionType.create;
const context={console,Math,Number,Map,Set,WeakMap,WeakSet,Symbol,
 structuredClone,globalThis:null,foundry:{applications:{instances:new Map()},utils:{deepClone:structuredClone,
 escapeHTML:x=>x}},game:{user:{isGM:true},actors:{contents:[actor]},scenes:{contents:[]},modules:new Map([[
 'pf1-firearms-and-reload',{active:true,api:{}}]]),
 settings:{get:(_ns,k)=>settings.get(k),register:(_ns,k,opt)=>{
  if(!settings.has(k))settings.set(k,opt.default)}}},
 document:{addEventListener:(name,fn,capture)=>{
  if(name==='click'&&capture===true)domHandlers.push(fn);
 }},
 Hooks:events,ui:{windows:{},notifications:{warn(){count.warns++},info(){},error(){}}},
 ChatMessage:{getSpeaker:()=>({}),async create(){count.messages++}},
 pf1:{models:{components:{Action:actionType}},components:{ActionUse,ItemAction:NativeActionUseStub}},
};
context.CONFIG={Item:{documentClass:NativeItemUseStub}};
context.migrateLegacyReload=async()=>({migrated:0});
context.globalThis=context;vm.createContext(context);vm.runInContext(code,context);
(async()=>{
 for(const fn of once.get('init')??[])fn();
 for(const fn of once.get('ready')??[])await fn();
 const api=context.game.modules.get('pf1-firearms-and-reload').api.reload;
 const seenEvents={frReload:0,oldReload:0,frShot:0,oldShot:0,frUnload:0,oldUnload:0};
 for(const [event,key] of [
  ['pf1frReload','frReload'],['pf1aeReload','oldReload'],
  ['pf1frReloadShot','frShot'],['pf1aeReloadShot','oldShot'],
  ['pf1frReloadUnload','frUnload'],['pf1aeUnload','oldUnload']
 ])events.on(event,()=>{seenEvents[key]++});

 // Regression: widget anchors to a native language-independent hardness
 // input, within the sidebar; it must never prepend the item header.
 assert.match(code,/sidebar\.querySelector\('input\[name="system\.hardness"\]'\)/);
 assert.match(code,/anchor\.insertAdjacentElement\('afterend',container\)/);
 assert.doesNotMatch(code,/header\.append\(container\)/);
 
 // Automatic weapon setup uses native action ammo and a conservative
 // capacity parse; it never requires a full custom configuration form.
 const originalName=weapon.name;
 weapon.name='Pistolet à double canon';
 weapon.system.description={value:'<p>Misfire 1–2 (5 ft.); Capacity 2</p>'};
 assert.equal(api.infer(weapon).ok,true);
 assert.equal(api.infer(weapon).capacity,2);
 assert.equal(api.infer(weapon).ammoId,'am');
 assert.equal(api.infer(weapon).source,'description');
 // An unidentified native ammo stack is still usable; identification is
 // not a loading requirement in PF1, only ammo type and inventory count.
 ammo.system.identified=false;
 assert.equal(api.infer(weapon).ok,true,'unidentified ammo remains selectable');
 const diag=api.ammoDiagnostic(weapon);
 assert.equal(diag.ammoType,'gunBullet');
 assert.equal(diag.inventory[0].quantity,8);
 assert.equal(diag.inventory[0].matches,true);
 ammo.system.identified=true;
 
 const auto=await api.initialize(weapon);
 assert.equal(auto.capacity,2);
 assert.equal(weapon.actions.length,2,'automatic setup never creates a native Action');
 assert.equal(api.infer(weapon).capacity,2);
 assert.equal((await api.initialize(weapon)).capacity,2,'idempotent automatic init');
 weapon.name=originalName;
 await weapon.unsetFlag?.('pf1-firearms-and-reload','reloadState');
 weapon.flags={};
 
 // Auto setup deliberately ignores unconfigured actions and non-ammo loot.
 context.actor=actor;context.weapon=weapon;
 const rawChoice=vm.runInContext('rlAttackActions(weapon)',context);
 assert.equal(rawChoice.length,2);
 const incomplete={id:'incomplete',name:'Unconfigured attack',
   actionType:'rwak',hasAttack:true,ammo:{type:null,cost:0}};
 weapon.actions.push(incomplete);
 assert.equal(vm.runInContext('rlAttackActions(weapon)',context).length,2);
 weapon.actions.pop();
 const ammoOptions=vm.runInContext('rlItems(actor).filter(x=>x.type==="ammo")',context);
 assert.equal(ammoOptions.length,1,'native PF1 ammo Item found');
 actor.items.set('loot',{id:'loot',type:'loot',system:{quantity:99}});
 assert.equal(vm.runInContext('rlItems(actor).filter(x=>x.type==="ammo")',context).length,1,
   'generic loot is not native ammunition');
 actor.items.delete('loot');
 // First use of a recognized but never reloaded pistol must be refused.
 weapon.name='Pistolet à double canon';
 await new ActionUse(simple,1).process();
 assert.equal(count.rolls,0,'first-ever attack must not become a free shot');
 assert.equal(count.nativeAmmo,0,'first-ever denied shot does not consume inventory');
 assert.equal(api.lastDiagnostic().status,'blocked');
 weapon.name=originalName;
 let state=await api.configure(weapon,{capacity:2,ammoType:'gunBullet',
  base:'standard',actionCosts:{double:2}});
 assert.equal(state.slots.length,0);
 assert.equal(weapon.actions.length,2,'configure does not add a Reload action');
 await api.configure(weapon,{capacity:2,ammoType:'gunBullet',
  base:'standard',actionCosts:{double:2}});
 assert.equal(weapon.actions.length,2,'still no automatic Reload action');
 const fire=async(action,n=1)=>new ActionUse(action,n).process();
 await fire(simple);
 assert.equal(count.rolls,0,'empty weapon refuses BEFORE roll');
 assert.equal(count.nativeAmmo,0);assert.equal(count.charges,0);
 const reloadAction={id:'manual-reload',name:'Recharger',actionType:'other',
  hasAttack:false,ammo:{type:null,cost:0}};
 weapon.actions.push(reloadAction);
 const dialogCountBeforeReload=count.dialogs;
 await fire(reloadAction);
 await new Promise(r=>setImmediate(r));
 assert.equal(count.dialogs,dialogCountBeforeReload,
  'real PF1 ActionUse.process reload path must skip dialog');
 const syntheticUse=new ActionUse(reloadAction,0);
 events.callAll('pf1CreateActionUse',syntheticUse);
 assert.equal(syntheticUse.shared.skipDialog,true,
  'pre-process PF1 hook marks reload dialog as skipped');
 assert.equal(typeof syntheticUse.process,'function');
 assert.equal(syntheticUse.process.pf1frInstantProcessWrapped,true,
  'pre-process PF1 hook wraps actual ActionUse.process, not only Item.use');

 assert.equal(api.getState(weapon).slots.length,1,'manually created native Reload action loads one');
 assert.equal(ammo.system.quantity,8,'no inventory consumption at reload');
 await fire(double,2);
 assert.equal(count.rolls,0,'double shot denied with one loaded');
 assert.equal(count.nativeAmmo,0);
 await fire(simple);
 await new Promise(r=>setImmediate(r));
 assert.equal(count.rolls,1,'single shot actually rolls');
 assert.equal(count.nativeAmmo,1,'PF1 consumes one native ammo once');
 assert.equal(ammo.system.quantity,7);
 assert.equal(api.getState(weapon).slots.length,0,'loaded state decremented after native shot');
 // A stale or deleted default ammunition ID must not force a false
 // out-of-ammo result when matching native ammo exists in inventory.
 weapon.system.ammo.default='deleted-id';
 await api.reload(weapon,{count:1});
 assert.equal(api.getState(weapon).slots.length,1);
 assert.equal(weapon.system.ammo.default,'am','default relinked to matching ammo');
 await api.unload(weapon,{count:1});
 
 // ItemPF.use receives options; only resolved Reload uses skipDialog.
 const makeNative=(base,actions)=>Object.assign(new NativeItemUseStub(),base,{actions});
 const nativeWeapon=makeNative(weapon,[
  {id:'reload-direct',name:'Recharger',hasAttack:false,actionType:'other'},
  {id:'shot-direct',name:'Tir simple',hasAttack:true,actionType:'rwak'}
 ]);
 const clickReload=new NativeActionUseStub(nativeWeapon,'reload-direct','Recharger');
 assert.equal(clickReload.item,undefined,
  'legacy ItemAction has parent, not item');
 const clicked=clickReload.use({rollMode:'blindroll'});
 assert.equal(clicked.options.skipDialog,true,
  'PF1 character-sheet Action.use must bypass native Reload dialog');
 assert.equal(clicked.options.rollMode,'blindroll',
  'PF1 Action.use preserves the requested chat roll mode');
 const clickFrench=new NativeActionUseStub(nativeWeapon,'reload-direct','Recharger');
 assert.equal(clickFrench.use().options.skipDialog,true,
  'legacy French Reload action is direct too');
 const clickAttack=new NativeActionUseStub(nativeWeapon,'shot-direct','Tir simple',true);
 assert.equal(clickAttack.use().options.skipDialog,undefined,
  'PF1 character-sheet attack Action.use retains dialog');
 // This test intentionally exposes only the PF1 11.11 ItemAction use()
 // entry point, NOT the newer models.components.Action.use().
 assert.equal(typeof context.pf1.models.components.Action.prototype?.use,'undefined');
 assert.equal(context.pf1.components.ItemAction,NativeActionUseStub);
 assert.equal(NativeActionUseStub.prototype.use.pf1frInstantReloadWrapped,true,
  'old PF1 ItemAction.use is patched before the configuration dialog');
 const reloadInstant=nativeWeapon.use({actionId:'reload-direct',rollMode:'gmroll'});
 assert.equal(reloadInstant.options.skipDialog,true,'Reload is immediate');
 assert.equal(reloadInstant.options.rollMode,'gmroll','roll mode preserved');
 assert.equal(reloadInstant.options.actionId,'reload-direct','native action preserved');
 assert.equal(nativeWeapon.use({actionId:'shot-direct'}).options.skipDialog,undefined,
  'attacks retain native dialogs');
 assert.equal(nativeWeapon.use({actionId:'nonexistent'}).options.skipDialog,undefined,
  'invalid action ID does not redirect the click');
 assert.equal(nativeWeapon.use().options.skipDialog,true,
  'default first Reload action is immediate');
 const initialWrapper=NativeItemUseStub.prototype.use;
 vm.runInContext('rlInstallInstantUse()',context);
 assert.equal(NativeItemUseStub.prototype.use,initialWrapper,'hook is idempotent');
 const nativeFeat=makeNative({id:'reloadFeat',type:'feat',name:'Recharger',actor},
  [{id:'activate',name:'Utiliser',hasAttack:false,actionType:'other'}]);
 assert.equal(nativeFeat.use({actionId:'activate'}).options.skipDialog,true,
  'feat Reload is immediate for one weapon');
 actor.items.set('otherGun',{...weapon,id:'otherGun',uuid:'Actor.a.Item.otherGun',
  flags:{reloadState:api.getState(weapon)}});
 assert.equal(nativeFeat.use({actionId:'activate'}).options.skipDialog,undefined,
  'ambiguous feat preserves dialog');
 actor.items.delete('otherGun');

 // User's "capacité Recharger" can also be a standalone nonattack feat.
 // Only one eligible weapon exists, so there is no ambiguous selection.
 const ability={id:'reloadFeat',type:'feat',name:'Recharger',actor,
  system:{disabled:false}};
 const abilityAction={id:'activate',name:'Utiliser',actionType:'other',
  hasAttack:false,ammo:{type:null,cost:0}};
 actor.items.set('reloadFeat',ability);
 settings.set('genericEnabled',false);
 const featUse=new ActionUse(abilityAction,0,ability);
 await featUse.process();
 await new Promise(r=>setImmediate(r));
 assert.equal(api.getState(weapon).slots.length,1,
  'actor Reload ability loads one round without enabling generic automations');
 assert.equal(api.lastDiagnostic().status,'reloaded');
 assert.equal(ammo.system.quantity,7,'feat reload does not subtract ammo');
 await api.unload(weapon,{count:1});
 actor.items.delete('reloadFeat');
 settings.set('genericEnabled',true);

 await api.reload(weapon,{count:2});
 assert.equal(api.getState(weapon).slots.length,2);
 // The native shot owns the local weapon until its PF1 post-use callback.
 // Reload and unload must not mutate the loaded slots while it is in flight.
 vm.runInContext("RL_FIRING.add(weapon.uuid)",context);
 await assert.rejects(()=>api.reload(weapon,{count:1}),/in progress/i);
 await assert.rejects(()=>api.unload(weapon,{count:1}),/in progress/i);
 await assert.rejects(()=>api.configure(weapon,{
  capacity:2,ammoType:'gunBullet',actionCosts:{double:2}
 }),/in progress/i);
 assert.equal(api.getState(weapon).slots.length,2);
 vm.runInContext("RL_FIRING.delete(weapon.uuid)",context);
 // Simulate a stale authorized shot whose selected ammunition does not
 // match the currently loaded chambers. Never silently discard the slots.
 const staleUse=new ActionUse(simple,1);
 context.staleUse=staleUse;
 vm.runInContext("RL_SHOTS.set(staleUse,{needed:1,selected:'wrong-ammo'})",context);
 vm.runInContext("RL_FIRING.add(weapon.uuid)",context);
 const beforeMismatch=api.getState(weapon);
 await vm.runInContext("rlCommitShot(staleUse)",context);
 assert.deepEqual(api.getState(weapon),beforeMismatch,
  'mismatched shot leaves all chambers unchanged for manual reconciliation');
 assert.equal(api.lastDiagnostic().status,'shot-reconciliation-required');
 assert.equal(vm.runInContext("RL_FIRING.has(weapon.uuid)",context),false);
 await fire(double,2);await new Promise(r=>setImmediate(r));
 assert.equal(count.rolls,2);
 assert.equal(count.nativeAmmo,3,'double shot consumed two, not four');
 assert.equal(api.getState(weapon).slots.length,0);
 assert.equal(ammo.system.quantity,5);
 await api.reload(weapon,{count:1});
 await assert.rejects(()=>api.reload(weapon,{count:2}),/capacity/i);
 assert.equal(api.getState(weapon).slots.length,1);
 await api.unload(weapon,{count:1});
 assert.equal(api.getState(weapon).slots.length,0);
 // PF1 legacy compendium ammunition can be loot with subType ammo.
 // Its native weapon default ID remains the authoritative link.
 const legacy={id:'legacy',type:'loot',name:'Balle d\'arme à feu',
  system:{subType:'ammo',quantity:54,abundant:false},inContainer:false,
  toObject(){return {name:this.name,type:this.type,system:{...this.system}}}};
 actor.items.set(legacy.id,legacy);
 weapon.system.ammo.default=legacy.id;
 assert.equal(api.ammoDiagnostic(weapon).inventory.some(i=>i.id===legacy.id&&
  i.linkedLegacy&&i.matches&&i.quantity===54),true,
  'linked legacy loot ammunition is a real eligible ammo stack');
 const previous=api.getState(weapon);
 assert.equal(previous.slots.length,0);
 await api.reload(weapon,{count:1});
 assert.equal(api.getState(weapon).slots[0].ammoId,legacy.id,
  'native linked legacy loot Item is loaded without duplication');
 assert.equal(legacy.system.quantity,54,'reload reserves ammo; does not subtract');
 const legacyUse=new ActionUse(simple,1);
 events.callAll('pf1CreateActionUse',legacyUse);
 assert.equal(legacyUse.getAmmo().some(a=>a.id===legacy.id&&a.quantity===54),true,
  'PF1 ActionUse obtains the same linked legacy ammo document');
 await fire(simple);
 await new Promise(r=>setImmediate(r));
 assert.equal(legacy.system.quantity,53,'PF1 native deduction uses linked legacy Item ID');
 assert.equal(api.getState(weapon).slots.length,0,'legacy fired chamber cleared');
 assert.equal(ammo.system.quantity,5,'other native ammo stack unchanged');
 actor.items.delete(legacy.id);
 weapon.system.ammo.default='am';
 await fire(simple);
 assert.equal(count.rolls,3,'module remains enforced without a world setting');
 assert.equal(api.getState(weapon).slots.length,0,'empty weapon still denied');
 // Native PF1 weapon actions are generated automatically and idempotently.
 // No feat creation, no duplicate action and no guess for repeating weapons.
 const examples=[
  ['Arbalète légère','bolt','move'],
  ['Arbalète lourde','bolt','full'],
  ['Arbalète de poing','bolt','move'],
  ['Pistolet à double canon','gunBullet','standard'],
  ['Mousquet','gunBullet','full']
 ];
 for(const [name,ammoType,expected] of examples){
  const a={id:'auto-'+expected,uuid:'Actor.a.Item.'+name,actor,type:'weapon',
   name,actions:[{id:'fire',name:'Attack',hasAttack:true,actionType:'rwak',
    ammo:{type:ammoType,cost:1}}]};
  assert.equal(api.reloadProfile(a).base,expected);
  assert.equal(await api.ensureReloadAction(a),true,'Action created for '+name);
  assert.equal(a.actions.length,2);
  assert.equal(a.actions[1].name,'Reload');
  assert.equal(a.actions[1].activation.type,expected);
  assert.equal(a.actions[1].hasAttack,false);
  assert.equal(await api.ensureReloadAction(a),false,'no duplicates for '+name);
 }
 for(const name of ['Arbalète à répétition','Revolver','Arbalète exotique']){
  const a={id:'special',uuid:'Actor.a.Item.'+name,actor,type:'weapon',
   name,actions:[{id:'fire',name:'Attack',hasAttack:true,actionType:'rwak',
    ammo:{type:name.includes('Arbalète')?'bolt':'gunBullet',cost:1}}]};
  assert.equal(await api.ensureReloadAction(a),false,'unsupported specialist: '+name);
  assert.equal(a.actions.length,1);
 }
 // A stock compendium Light Crossbow often has only an 'Attack' action,
 // and ammo fields may be null until the user links bolts. The Reload
 // action must still appear immediately after adding the weapon.
 for(const missingAmmo of [null,{type:null,cost:0},{type:'bolt',cost:0}]){
  const unconfigured={id:'unconfigured',uuid:'Actor.a.Item.unconfigured',
   actor,type:'weapon',name:'Arbalète légère',
   actions:[{id:'stock-attack',name:'Attack',actionType:'rwak',hasAttack:true,
    ammo:missingAmmo}]};
  assert.equal(api.reloadProfile(unconfigured).base,'move',
   'recognize French light crossbow independently of ammo settings');
  assert.equal(await api.ensureReloadAction(unconfigured),true,
   'create Recharger even if stock Attack does not yet have native bolt settings');
  assert.equal(unconfigured.actions[1].name,'Reload');
  assert.equal(unconfigured.actions[1].activation.type,'move');
  assert.equal(await api.ensureReloadAction(unconfigured),false,
   'do not create duplicate Reload on updateItem');
  assert.equal(api.diagnoseAutoAction(unconfigured).alreadyHasReload,true);
 }
 const noAction={id:'none',uuid:'Actor.a.Item.none',actor,type:'weapon',
  name:'Light Crossbow',actions:[]};
 assert.equal(await api.ensureReloadAction(noAction),true,
  'recognized weapon still gets Reload when native attack action is absent');
 assert.equal(noAction.actions[0].name,'Reload');
 assert.equal(noAction.actions[0].activation.type,'move');

 // Reproduce the ACTUAL PF1 v11.11 ActionSelector popup from the player's
 // screenshot: div.action[data-action=click], img alt=Reload, parent form
 // id=ActionSelector-Actor-a-Item-none. This is not ItemAction.use.
 assert.equal(domHandlers.length,1,'install a capture-phase chooser click handler');
 const selected=noAction.actions[0];
 let used=null, chooserClosed=0;
 noAction.use=async options=>{used=options;return options};
 actor.items.set(noAction.id,noAction);
 const form={id:'ActionSelector-Actor-a-Item-none'};
 // Foundry 13 registers ActionSelector in ApplicationV2 instances, not
 // ui.windows. An unrelated window must never be closed.
 let unrelatedClosed=0;
 context.ui.windows={};
 context.foundry.applications.instances.set('unrelated',{
  element:{contains:()=>false},close:async()=>{unrelatedClosed++}
 });
 context.foundry.applications.instances.set('chooser',{
  element:{contains:x=>x===form},form,
  close:async()=>{chooserClosed++}
 });
 const selection=(label)=>{
  const row={textContent:label,querySelector:()=>({
   getAttribute:()=>label
  }),closest:selector=>selector.startsWith('form[')?form:null};
  const event={target:{closest:selector=>
   selector==='.action[data-action="click"]'?row:null},
   defaultPrevented:false,
   preventDefault(){this.defaultPrevented=true},
   stopImmediatePropagation(){this.stopped=true},
   stopPropagation(){this.bubbled=false}};
  domHandlers[0](event);
  return event;
 };
 const attackEvent=selection('Attack');
 assert.equal(attackEvent.defaultPrevented,false,
  'PF1 Attack chooser selections retain their normal handler');
 assert.equal(used,null);
 const reloadEvent=selection('Reload');
 await new Promise(r=>setImmediate(r));
 assert.equal(reloadEvent.defaultPrevented,true,
  'ActionSelector native Reload click is intercepted');
 assert.equal(reloadEvent.stopped,true);
 assert.equal(used.actionId,selected.id,'native action ID is preserved');
 assert.equal(used.skipDialog,true,'no PF1 handedness/roll dialog after selection');
 assert.equal(chooserClosed,1,'Foundry 13 ApplicationV2 chooser closes');
 assert.equal(unrelatedClosed,0,'unrelated ApplicationV2 stays open');
 context.foundry.applications.instances.clear();
 actor.items.delete(noAction.id);

 const existing={id:'manual',uuid:'Actor.a.Item.manual',actor,type:'weapon',
  name:'Pistolet',actions:[{id:'fire',hasAttack:true,actionType:'rwak',
   ammo:{type:'gunBullet',cost:1}},{id:'existing',name:'Recharger',
   hasAttack:false,activation:{type:'move'}}]};
 assert.equal(await api.ensureReloadAction(existing),false,
  'never override an existing custom Reload action');
 assert.equal(existing.actions[1].activation.type,'move');
 // Misfire phase 1: evaluate the NATURAL d20, never the modified total.
 // The module deliberately only reports an incident; no permanent weapon
 // modification or automatic explosion without verified PF1 roll data.
 const firearm={...weapon,name:'Pistolet à double canon',system:{
  ...weapon.system,description:{value:'Misfire 1–2 (5 ft.); Capacity 2'}}};
 assert.equal(api.misfire.profile(firearm).base,2);
 assert.equal(api.misfire.profile(firearm).category,'early');
 const asRoll=natural=>({
  total:natural+12,dice:[{faces:20,results:[{result:natural,active:true}]}]
 });
 const asMisfireUse=natural=>({item:firearm,action:{
  id:'shot',actionType:'rwak',hasAttack:true},
  shared:{chatAttacks:[{attack:{roll:asRoll(natural)}}]}});
 assert.equal(api.misfire.inspect(asMisfireUse(1)).status,'misfire');
 assert.equal(api.misfire.inspect(asMisfireUse(2)).status,'misfire');
 assert.equal(api.misfire.inspect(asMisfireUse(3)).status,'clear');
 assert.equal(api.misfire.inspect(asMisfireUse(20)).status,'clear');
 assert.equal(api.misfire.flagPath,'flags.pf1-firearms-and-reload.misfire');
 assert.equal(api.misfire.isMarked(weapon),false,'unmarked weapon has no misfire origin');
 // Simulate a first confirmed misfire on the weapon Item itself.
 const savedName=weapon.name,savedDesc=weapon.system.description;
 weapon.name='Pistolet à double canon';
 weapon.system.description={value:'Misfire 1–2 (5 ft.); Capacity 2'};
 const first={item:weapon,actor,action:{id:'shot',actionType:'rwak',hasAttack:true},
  shared:{chatAttacks:[{attack:{roll:{dice:[{faces:20,results:[{result:1}]}]}}}]}};
 await vm.runInContext('rlTrackMisfire',context)(first);
 assert.equal(weapon.system.broken,true,'first confirmed misfire sets PF1 native broken condition');
 assert.equal(weapon.getFlag('pf1-firearms-and-reload','misfire'),true,
  'first confirmed misfire stores its origin on weapon Item');
 assert.equal(api.misfire.isMarked(weapon),true,'script-readable flag accessor');
 assert.equal(api.misfire.lastDiagnostic().brokenApplied,true);
 await vm.runInContext('rlTrackMisfire',context)({
  ...first,shared:{chatAttacks:[{attack:{roll:{dice:[{faces:20,results:[{result:2}]}]}}}]}
 });
 assert.equal(weapon.system.broken,true,'second misfire never clears native broken state');
 assert.equal(weapon.flags.misfire,true,'second misfire preserves original origin flag');
 weapon.system.broken=false;
 weapon.flags.misfire=false;
 const damagedUse={...first,shared:{chatAttacks:[{attack:{roll:{dice:[
  {faces:20,results:[{result:1}]}]}}}]}};
 weapon.system.broken=true; // ordinary damage, not a misfire-origin break
 await vm.runInContext('rlTrackMisfire',context)(damagedUse);
 assert.equal(weapon.flags.misfire,false,'preexisting unrelated broken condition is not relabeled');
 weapon.system.broken=false;
 delete weapon.flags.misfire;

 // PF1 broken early firearm: misfire range increases by +4.
 weapon.name='Pistolet à double canon';
 weapon.system.description={value:'Misfire 1–2 (5 ft.); Capacity 2'};
 weapon.system.broken=true;weapon.flags.misfire=true;
 const second=natural=>({item:weapon,actor,action:{
  id:'shot',actionType:'rwak',hasAttack:true},
  shared:{chatAttacks:[{attack:{roll:asRoll(natural)}}]}});
 const secondResult=api.misfire.inspect(second(5));
 assert.equal(secondResult.status,'explosion',
  'already-broken early pistol explodes on natural 5 (misfire 1-6)');
 assert.equal(secondResult.misfires[0].threshold,6);
 assert.equal(secondResult.profile.burstRadius,5);
 assert.equal(secondResult.profile.burstUnit,'ft');
 assert.equal(api.misfire.inspect(second(7)).status,'clear');
 // A verified explosion must mark the weapon unusable without deleting
 // its Item, preserve the existing misfire origin flag and notify the GM.
 const messagesBeforeExplosion=count.messages;
 await vm.runInContext('rlTrackMisfire',context)(second(5));
 assert.equal(weapon.flags.exploded,true,'explosion persisted on weapon Item');
 assert.equal(weapon.flags.explosionPending,true,'GM must resolve burst damage');
 assert.equal(weapon.flags.misfire,true,'repair origin flag preserved');
 assert.equal(api.misfire.isExploded(weapon),true);
 assert.equal(count.messages,messagesBeforeExplosion+1,'explosion announced in chat');
 await assert.rejects(()=>api.reload(weapon,{count:1}),/exploded/i,
  'exploded firearm cannot reload');
 assert.equal(vm.runInContext('rlCheck',context)({
  item:weapon,action:simple
 }).ok,false,'exploded firearm cannot shoot');
 // An advanced firearm never explodes, even when already broken.
 const advancedGun={...weapon,name:'Revolver',system:{
  ...weapon.system,description:{value:'Misfire 1 (5 ft.)'}}};
 const advancedUse={...second(1),item:advancedGun};
 assert.equal(api.misfire.inspect(advancedUse).status,'misfire',
  'advanced broken firearms do not explode');
 // Explicitly designated gun training narrows broken range bonus +2.
 weapon.flags.brokenMisfireIncrease=2;
 assert.equal(api.misfire.inspect(second(5)).status,'clear',
  'gun training +2 results in misfire 1-4 instead of 1-6');
 assert.equal(api.misfire.inspect(second(4)).status,'explosion');
 delete weapon.flags.brokenMisfireIncrease;
 // Separate shot sequences from a multi-barrel weapon: the first misfire
 // breaks the pistol, the second (with raised threshold) explodes.
 weapon.system.broken=false;weapon.flags.misfire=false;
 const multiple={...second(1),shared:{chatAttacks:[
  {attack:{roll:asRoll(2)}},{attack:{roll:asRoll(5)}}
 ]}};
 const multiResult=api.misfire.inspect(multiple);
 assert.equal(multiResult.status,'explosion');
 assert.deepEqual(multiResult.misfires.map(x=>x.threshold),[2,6]);
 const scatter={...multiple,action:{...multiple.action,name:'Scatter shot'}};
 assert.equal(api.misfire.inspect(scatter).status,'unresolved',
  'scatter attacks must not cause false positive explosions');
 // Restore weapon for remaining native reload tests.
 weapon.flags.exploded=false;
 weapon.flags.explosionPending=false;
 weapon.flags.misfire=false;
 weapon.system.broken=false;
 weapon.name=savedName;weapon.system.description=savedDesc;


 // The system's real pf1AttackRoll hook supplies the evaluated attack
 // Roll before it is transformed to a chat card. Capture the actual
 // natural d20 only while the correct weapon is firing.
 const hookUse=asMisfireUse(2);
 hookUse.item=weapon;
 weapon.name='Pistolet à double canon';
 weapon.system.description={value:'Misfire 1–2 (5 ft.); Capacity 2'};
 context.hookUse=hookUse;
 vm.runInContext("RL_FIRING.add(weapon.uuid)",context);
 const hookAction={id:'shot',parent:weapon,actionType:'rwak',hasAttack:true};
 events.callAll('pf1AttackRoll',hookAction,asRoll(2),{});
 const tracked=api.misfire.inspect({...hookUse,shared:{chatAttacks:[]}});
 assert.equal(tracked.status,'misfire',
  'pf1AttackRoll hook captures a natural 2 without chatAttacks layout');
 assert.equal(tracked.misfires[0].natural,2);
 vm.runInContext("RL_FIRING.delete(weapon.uuid); RL_MISFIRE_ROLLS.delete(weapon.uuid)",context);
 events.callAll('pf1AttackRoll',hookAction,asRoll(1),{});
 assert.equal(api.misfire.inspect({...hookUse,shared:{chatAttacks:[]}}).status,
  'unresolved','unrelated attacks never supply a stale misfire');
 weapon.name='w';

 const unresolved=asMisfireUse(2);
 unresolved.shared.chatAttacks[0].attack.roll={total:2};
 assert.equal(api.misfire.inspect(unresolved).status,'unresolved',
  'attack total must never be mistaken for natural die face');
 const badWeapon={...firearm,system:{description:{value:'Capacity 2'}}};
 assert.equal(api.misfire.profile(badWeapon).known,false,
  'unknown misfire threshold cannot silently use a guessed default');
 const crossbow={...firearm,name:'Arbalète légère'};
 assert.equal(api.misfire.inspect({...asMisfireUse(1),item:crossbow}).status,
  'not-firearm','crossbows are never misfire candidates');
 const advanced={...firearm,name:'Revolver'};
 assert.equal(api.misfire.profile(advanced).category,'advanced');
 assert.equal(typeof api.timing,'undefined','action economy belongs to native Reload');
 assert.ok(seenEvents.frReload>0&&seenEvents.frShot>0&&seenEvents.frUnload>0);
 assert.equal(seenEvents.frReload,seenEvents.oldReload,
  'reload notifications preserve PF1AE legacy listeners without duplicate writes');
 assert.equal(seenEvents.frShot,seenEvents.oldShot,
  'shot notifications preserve PF1AE legacy listeners');
 assert.equal(seenEvents.frUnload,seenEvents.oldUnload,
  'unload notifications preserve PF1AE legacy listeners');

 console.log('PASS reload core: manual Reload, empty/double pre-roll denial, native ammo once, load/unload and always-on');
})().catch(error=>{console.error(error);process.exitCode=1});
