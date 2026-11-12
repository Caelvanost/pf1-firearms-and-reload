import { migrateLegacyReload } from "./migration.js";
/**
 * PF1AE reload core, Foundry 13 / PF1 11.11.
 * Inventory model B: native PF1 consumes ammunition exactly once when firing.
 * Loaded rounds are reserved, not removed from inventory by reload.
 * Only explicitly configured weapons are intercepted.
 */
const RL_NS='pf1-firearms-and-reload',RL_KEY='reloadState';
const RL_ACTION='pf1fr-reload';
const RL_BUSY=new Set(),RL_SHOTS=new WeakMap(),RL_DENIED=new WeakSet();
const RL_RELOAD_SEEN=new WeakSet();
const RL_FIRING=new Set();
// Compatibility bridge for worlds listening to PF1AE's old event names.
// The old engine is unloaded, so these notifications never double-apply changes.
const rlEvent=(current,legacy,payload)=>{
 Hooks.callAll(current,payload);
 if(legacy)Hooks.callAll(legacy,payload);
};
let RL_LAST=null;
const rlL=(key,data={})=>{
 const fallback={
  Action:'Reload',
  AutoUnavailable:'Unable to infer weapon capacity or native ammunition automatically',
  ReloadFailed:'Reload failed',
  Loading:'Loading',
  AmmoGuidance:'Check that the actor has native PF1 ammo Items of the matching subtype, with positive quantity.',
  InitialStatus:'Reloading will initialize this weapon automatically',
  Loaded:'Loaded: {loaded}/{capacity}',Unload:'Unload',
  Configure:'Configure reload',Capacity:'Capacity',Ammo:'Ammunition',
  Shots:'Shots for Action',Save:'Save',
  Empty:'Weapon is not sufficiently loaded.',
  Insufficient:'Not enough ammunition available to reload.',
  OutOfCapacity:'Weapon capacity exceeded.',
  Reloaded:'Weapon reloaded: {loaded}/{capacity}.',
  Blocked:'Attack blocked: {loaded} loaded; {needed} required.',
  AoO:'Reloading may provoke an attack of opportunity.',
  Missing:'Weapon or ammunition is unavailable.',
  Unconfigured:'Weapon reload tracking is not configured.'
 }[key]??key;
 const ref='PF1FR.Reload.'+key;
 const translated=Object.keys(data).length?game.i18n?.format?.(ref,data):game.i18n?.localize?.(ref);
 if(!translated||translated===ref)return fallback.replace(/\{(\w+)\}/g,(_,k)=>data[k]??'');
 return translated;
};
const rlAllowed=()=>{
 if(game.modules.get(RL_NS)?.active!==true) return false;
 // Safe until PF1AE has been upgraded to a delegating compatibility adapter.
 const old=game.modules.get('pf1-automation-engine');
 if(old?.active){
  const scripts=Array.isArray(old.esmodules)?old.esmodules:null;
  // Inspect manifest ownership as well as the ready-time bridge marker;
  // Foundry may invoke the standalone ready handler before PF1AE's adapter.
  if(scripts?.some(path=>String(path).endsWith('/reload-core.js'))) return false;
  if(!scripts?.includes('scripts/reload-adapter.js') && old.api?.reloadDelegated!==true) return false;
 }
 return true;
};
const rlActor=weapon=>weapon?.actor??(weapon?.parent?.documentName==='Actor'?weapon.parent:null);
const rlOwner=actor=>game.user?.isGM||actor?.testUserPermission?.(game.user,'OWNER');
const rlClone=o=>foundry.utils.deepClone(o);
const rlState=weapon=>{
 const s=weapon?.getFlag?.(RL_NS,RL_KEY)??weapon?.getFlag?.('pf1-automation-engine',RL_KEY);
 if(!s || s.schema!==1 || !Number.isSafeInteger(s.capacity)||s.capacity<1||s.capacity>100 ||
  !Array.isArray(s.slots)||s.slots.length>s.capacity)return null;
 if(s.slots.some(x=>typeof x?.ammoId!=='string'||!x.ammoId))return null;
 return rlClone(s);
};
const rlActions=weapon=>[...(weapon?.actions?.contents??weapon?.actions?.values?.()??weapon?.actions??[])];
const rlReloadName=name=>/^(?:recharger|reload)(?:\s|$)/i.test(String(name??'').trim());
function rlReloadRequest(use){
 const item=use?.item??use?.action?.item;
 if(!item||!use?.action)return {candidate:false,weapon:null};
 const state=rlState(item);
 const named=rlReloadName(use.action.name)||
  (!use.action.hasAttack&&rlReloadName(item.name));
 const legacy=!!state?.actionId&&use.action.id===state.actionId;
 if(!named&&!legacy)return {candidate:false,weapon:null};
 if(use.action.hasAttack)return {candidate:true,weapon:null,
  reason:'Reload must be a non-attack PF1 action.'};
 if(item.type==='weapon')return {candidate:true,weapon:item};
 // A character ability can reload its ONLY eligible weapon. Never choose
 // between multiple pistols/crossbows without explicit association.
 const actor=use.actor??rlActor(item);
 const weapons=rlItems(actor).filter(x=>x?.type==='weapon'&&
  (rlState(x)||rlInfer(x).ok));
 if(weapons.length===1)return {candidate:true,weapon:weapons[0]};
 return {candidate:true,weapon:null,reason:weapons.length>1?
  'Multiple compatible weapons: place the Reload action on the specific weapon.':
  'No compatible weapon with native ammunition and capacity could be found.'};
}
const rlNativeAction=use=>rlReloadRequest(use).candidate;
const rlCompatible=(item,capacity)=>{
 if(item?.type!=='weapon'||!rlActor(item)||!Number.isSafeInteger(capacity)||capacity<1||capacity>100)
  throw Error('An actor-owned weapon and capacity 1–100 are required.');
};
const rlType=(weapon,state,action)=>state?.ammoType??action?.ammo?.type??weapon?.system?.ammo?.type??null;
const rlAmmo=(actor,id)=>actor?.items?.get(id)??null;
const rlIsNativeAmmo=(item,ammoType)=>item?.type==='ammo'&&
 (!ammoType||!item.system?.subType||item.system.subType===ammoType);
// PF1 legacy compendiums can store linked bullets as loot/subType ammo.
// Accept ONLY a loot Item explicitly linked by the weapon's native
// "Default Ammunition" field, never arbitrary loot.
const rlIsLinkedLegacyAmmo=(weapon,item,ammoType)=>!!item&&
 item.type==='loot'&&item.system?.subType==='ammo'&&
 item.id===weapon?.system?.ammo?.default&&
 !!ammoType&&rlActions(weapon).some(a=>a?.ammo?.type===ammoType&&a?.hasAttack);
const rlIsWeaponAmmo=(weapon,item,ammoType)=>rlIsNativeAmmo(item,ammoType)||
 rlIsLinkedLegacyAmmo(weapon,item,ammoType);
const rlQuantity=item=>Number(item?.system?.quantity??0);
const rlReservations=(actor,ammoId,except)=>{
 let reserved=0;
 for(const item of rlItems(actor)){
  if(item.id===except?.id)continue;
  const s=rlState(item);
  if(s)reserved+=s.slots.filter(x=>x.ammoId===ammoId).length;
 }
 return reserved;
};
function rlAvailable(weapon,ammoId,state){
 const actor=rlActor(weapon),ammo=rlAmmo(actor,ammoId);
 if(ammo?.inContainer||!rlIsWeaponAmmo(weapon,ammo,state.ammoType))return 0;
 if(ammo.system?.abundant===true)return Infinity;
 const own=state.slots.filter(x=>x.ammoId===ammoId).length;
 return Math.max(0,rlQuantity(ammo)-rlReservations(actor,ammoId,weapon)-own);
}
const rlLock=async(weapon,fn,{allowFiring=false}={})=>{
 const key=weapon?.uuid;
 if(!key||RL_BUSY.has(key)||(!allowFiring&&RL_FIRING.has(key)))
  throw Error('Weapon operation already in progress.');
 RL_BUSY.add(key);
 try{return await fn()}finally{RL_BUSY.delete(key)}
};
function rlNeeded(use,state){
 const action=use.action;
 if(!action?.hasAttack||!['rwak','twak'].includes(action.actionType))return 0;
 if(action.actionType==='twak')return 0; // thrown weapon, not loaded
 if(!action.ammo?.type || action.ammo.cost<=0)return 0;
 const explicit=state.actionCosts?.[action.id];
 if(Number.isSafeInteger(explicit)&&explicit>=1)return explicit;
 // Count all actual attacks, including rapid shot/iteratives and possible
 // unselected ammunition. If reliable attack data is unavailable, fail closed.
 const attacks=use.shared?.attacks;
 if(!Array.isArray(attacks)||!attacks.length)return null;
 return attacks.length*Math.max(1,Number(action.ammo.cost)||1);
}
function rlCheck(use){
 const weapon=use?.item;
 if(!rlAllowed()||weapon?.type!=='weapon'||rlNativeAction(use))return {managed:false};
 if(rlExploded(weapon))return {managed:true,ok:false,reason:'firearm exploded / unusable'};
 const stored=rlState(weapon),inferred=stored?null:rlInfer(weapon);
 if(!stored&&!inferred?.ok){
  // A known firearm/crossbow with an attack must not silently fire because
  // its native ammo configuration is incomplete. Explicitly deny it.
  const label=String(weapon?.name??'');
  const recognizable=/(?:pistol|pistolet|musket|mousquet|crossbow|arbal[eè]te)/i.test(label);
  const ranged=rlActions(weapon).some(a=>a?.actionType==='rwak');
  if(recognizable&&ranged)return {managed:true,ok:false,needed:1,loaded:0,
    reason:inferred?.reason??'missing PF1 native ammo data'};
  return {managed:false,reason:inferred?.reason??'unsupported'};
 }
 // Recognized but never reloaded means EMPTY, not unmanaged.
 const state=stored??{schema:1,capacity:inferred.capacity,ammoType:inferred.ammoType,
   slots:[],actionCosts:{}};
 const needed=rlNeeded(use,state);
 if(needed===0)return {managed:false};
 if(needed===null)return {managed:true,ok:false,reason:'unknown attack count'};
 if(RL_FIRING.has(weapon.uuid))
  return {managed:true,ok:false,needed,loaded:state.slots.length,
    reason:'another shot is being processed'};
 const actual=(use.shared?.attacks??[]).reduce((sum,a)=>sum+(a?.hasAmmo?
   Math.max(1,Number(use.action?.ammo?.cost)||1):0),0);
 if(actual!==needed)return {managed:true,ok:false,needed,
   loaded:state.slots.length,reason:'native ammo usage differs from configured cost'};
 const selected=weapon?.system?.ammo?.default;
 const ammo=rlAmmo(rlActor(weapon),selected);
 const loaded=state.slots.filter(x=>x.ammoId===selected).length;
 // The native PF1 action will consume from its default ammunition Item;
 // forbid firing a different loaded ammo or an inventory deficit.
 const available=ammo?.system?.abundant?Infinity:rlQuantity(ammo);
 const ok=!!selected&&!!ammo&&loaded>=needed&&available>=needed&&
  (use.shared?.attacks??[]).every(x=>x?.ammo?.id===selected);
 return {managed:true,ok,needed,loaded,selected,
   reason:ok?null:'insufficient loaded ammo or native ammunition inventory'};
}
async function rlConfigure(weapon,{capacity,ammoType,base='standard',actionCosts={},initialLoaded=0}={}){
 rlCompatible(weapon,capacity);
 const actor=rlActor(weapon);
 if(!rlOwner(actor))throw Error('Actor OWNER permission required.');
 if(!['free','move','standard','full'].includes(base))throw Error('Invalid reload action economy.');
 if(typeof ammoType!=='string'||!ammoType)throw Error('Native PF1 ammunition subtype required.');
 if(!Number.isSafeInteger(initialLoaded)||initialLoaded<0||initialLoaded>capacity)
  throw Error('Invalid initial loaded count.');
 for(const [key,value] of Object.entries(actionCosts)){
  if(!rlActions(weapon).some(a=>a.id===key)||!Number.isSafeInteger(value)||value<1||value>capacity)
   throw Error('Invalid shot cost; select an existing Action ID.');
 }
 return rlLock(weapon,async()=>{
  const prev=rlState(weapon);
  // Preserve legacy ID; user manages native Reload action and its cost.
  const actionId=prev?.actionId??null;
  // Preserve loaded slot identity on changes. Never silently empty a weapon.
  const slots=prev?.slots??[];
  if(slots.length>capacity)throw Error('Unload before decreasing capacity.');
  if(initialLoaded>0&&!prev){
   const id=weapon.system.ammo?.default,ammo=rlAmmo(actor,id);
   if(!rlIsWeaponAmmo(weapon,ammo,ammoType)||rlQuantity(ammo)<initialLoaded)
    throw Error('Choose enough native default ammunition before initializing loaded rounds.');
   slots.push(...Array.from({length:initialLoaded},()=>({ammoId:id})));
  }
  const state={schema:1,capacity,ammoType,base,actionId,actionCosts,slots};
  await weapon.setFlag(RL_NS,RL_KEY,state);
  return rlClone(state);
 });
}
function rlAmmoDiagnostic(weapon){
 const actor=rlActor(weapon),state=rlState(weapon),inferred=rlInfer(weapon);
 const ammoType=state?.ammoType??inferred?.ammoType??
  rlAttackActions(weapon)[0]?.ammo?.type??null;
 const selectedId=weapon?.system?.ammo?.default??null;
 const inventory=rlItems(actor).filter(x=>x?.type==='ammo'||
  rlIsLinkedLegacyAmmo(weapon,x,ammoType)).map(item=>({
  itemType:item.type,
  id:item.id,name:item.name??null,subType:item.system?.subType??null,
  quantity:rlQuantity(item),inContainer:!!item.inContainer,
  abundant:item.system?.abundant===true,
  reserved:rlReservations(actor,item.id,weapon)+
   (state?.slots??[]).filter(slot=>slot.ammoId===item.id).length,
  matches:rlIsWeaponAmmo(weapon,item,ammoType),
  linkedLegacy:rlIsLinkedLegacyAmmo(weapon,item,ammoType)
 }));
 return {weapon:weapon?.name??null,weaponUuid:weapon?.uuid??null,
  capacity:state?.capacity??inferred.capacity??null,
  loaded:state?.slots?.length??0,ammoType,
  selectedId,selectedName:inventory.find(x=>x.id===selectedId)?.name??null,
  inferReason:inferred.ok?null:inferred.reason??null,
  inventory};
}
function rlChooseAmmo(weapon,state,ammoId){
 const actor=rlActor(weapon);
 if(ammoId){
  const ammo=rlAmmo(actor,ammoId);
  if(rlIsWeaponAmmo(weapon,ammo,state.ammoType))
   return ammoId;
  throw Error('The chosen ammunition is missing or incompatible.');
 }
 const def=weapon.system?.ammo?.default;
 const defaultAmmo=rlAmmo(actor,def);
 if(rlIsWeaponAmmo(weapon,defaultAmmo,state.ammoType)&&
   rlAvailable(weapon,def,state)>0)return def;
 // Never change ammo identity while another cartridge is loaded.
 if(state.slots.length>0)return def;
 const other=rlItems(actor).find(x=>x?.type==='ammo'&&!x.inContainer&&
  rlIsWeaponAmmo(weapon,x,state.ammoType)&&rlAvailable(weapon,x.id,state)>0);
 return other?.id??def??null;
}
async function rlReload(weapon,{ammoId,count=1}={}){
 const actor=rlActor(weapon),state=rlState(weapon);
 if(rlExploded(weapon))throw Error('Exploded firearm cannot be reloaded.');
 if(!state)throw Error(rlL('Unconfigured'));
 if(!rlOwner(actor))throw Error('Actor OWNER permission required.');
 if(!rlAllowed())throw Error('Reload manager is unavailable or a legacy engine is still active.');
 if(!Number.isSafeInteger(count)||count<1)throw Error('Invalid reload quantity.');
 return rlLock(weapon,async()=>{
  const current=rlState(weapon);
  if(count>current.capacity-current.slots.length)throw Error(rlL('OutOfCapacity'));
  const selected=rlChooseAmmo(weapon,current,ammoId);
  const ammo=rlAmmo(actor,selected);
  const available=selected?rlAvailable(weapon,selected,current):0;
  if(!ammo||available<count){
   const diag=rlAmmoDiagnostic(weapon);
   console.warn('[PF1FR][Reload] Insufficient compatible ammunition',diag);
   throw Error(rlL('Insufficient')+' — '+rlL('AmmoGuidance'));
  }
  const slots=[...current.slots,...Array.from({length:count},()=>({ammoId:selected}))];
  // Keep native default ammo aligned with the loaded cartridge.
  // Mixed ammo remains unsupported in the initial integration.
  if(new Set(slots.map(x=>x.ammoId)).size!==1)
   throw Error('Mixed ammunition is not supported in this version.');
  const previousDefault=weapon.system?.ammo?.default;
  const next={...current,slots};
  await weapon.setFlag(RL_NS,RL_KEY,next);
  try{
   if(previousDefault!==selected)await weapon.update({'system.ammo.default':selected});
  }catch(error){
   try{await weapon.setFlag(RL_NS,RL_KEY,current)}catch(rollbackError){
    console.error('[PF1FR][Reload] Rollback failed',rollbackError);
   }
   throw error;
  }
  // Action economy and AoOs are managed by the user-defined native Action.
  if(globalThis.ChatMessage?.create){
   const msg=rlL('Reloaded',{loaded:slots.length,capacity:current.capacity});
   void ChatMessage.create({speaker:ChatMessage.getSpeaker({actor}),
     content:foundry.utils.escapeHTML?.(msg)??msg}).catch(err=>console.warn('[PF1FR][Reload] Chat',err));
  }
  rlEvent('pf1frReload','pf1aeReload', {actorUuid:actor.uuid,weaponUuid:weapon.uuid,
    ammoId:selected,count,loaded:slots.length,capacity:current.capacity});
  return rlClone(next);
 });
}
async function rlUnload(weapon,{count=1}={}){
 const actor=rlActor(weapon);
 if(!rlOwner(actor))throw Error('Actor OWNER permission required.');
 if(!rlAllowed())throw Error('Automatic reload is disabled.');
 return rlLock(weapon,async()=>{
  const state=rlState(weapon);
  if(!state||!Number.isSafeInteger(count)||count<1||count>state.slots.length)
   throw Error('Invalid unload count.');
  const slots=state.slots.slice(0,-count),next={...state,slots};
  await weapon.setFlag(RL_NS,RL_KEY,next);
  rlEvent('pf1frReloadUnload','pf1aeUnload',{actorUuid:actor.uuid,weaponUuid:weapon.uuid,
    count,loaded:slots.length});
  return rlClone(next);
 });
}
function rlDeny(use,result){
 RL_DENIED.add(use);
 ui.notifications?.warn?.(rlL('Blocked',{
  loaded:result.loaded??0,needed:result.needed??'?'}));
 RL_LAST={status:'blocked',actor:use.actor?.name??null,weapon:use.item?.name??null,
  action:use.action?.name??null,...result};
 console.warn('[PF1FR][Reload] Attack blocked before dice',result);
 rlEvent('pf1frReloadFireDenied','pf1aeReloadFireDenied',{
  actorUuid:use.actor?.uuid,weaponUuid:use.item?.uuid,
  actionId:use.action?.id,loaded:result.loaded??0,
  needed:result.needed??null,reason:result.reason??null});
}
/**
 * Misfire phase 1: fail-closed detection. Rolls are inspected only when PF1
 * provides the actual natural d20 result; attack TOTALS are never inferred
 * as die faces. No broken flag, weapon deletion or explosion in this phase.
 */
const RL_MISFIRE_SEEN=new WeakSet();
const RL_MISFIRE_ROLLS=new Map();
let RL_MISFIRE_LAST=null;
function rlMisfireProfile(weapon){
 if(weapon?.type!=='weapon')return null;
 const name=String(weapon.name??'').toLowerCase();
 if(!/(?:pistolet|pistol|mousquet|musket|tromblon|blunderbuss|arquebuse|arquebus|revolver|rifle|fusil|shotgun)/i.test(name))
  return null;
 const source=[
  weapon.system?.description?.value,
  weapon.system?.description?.unidentified,
  weapon.system?.description?.summary,
  weapon.system?.source?.text
 ].map(rlPlain).join(' ');
 // Standard compendium format: Misfire 1–2 (5 ft.) or Long feu 1–2 (1,5 m).
 const match=source.match(/(?:misfire|long[ -]?feu|enrayement)\s*:?\s*(1)(?:\s*[-–—]\s*(\d))?/i);
 if(!match)return {supported:true,known:false,reason:'no explicit misfire range in firearm description'};
 const low=Number(match[1]),high=Number(match[2]??match[1]);
 if(low!==1||high<1||high>10)
  return {supported:true,known:false,reason:'invalid misfire range'};
 const advanced=/(?:revolver|rifle|shotgun|fusil à pompe)/i.test(name);
 const radiusMatch=source.match(/(?:misfire|long[ -]?feu|enrayement)\s*:?\s*1(?:\s*[-–—]\s*\d)?\s*\(\s*(\d+(?:[.,]\d+)?)\s*(ft\.?|feet|m|meters?|mètres?)\s*\)/i);
 const radius=radiusMatch?Number(radiusMatch[1].replace(',','.')):null;
 const unit=radiusMatch?.[2]?.toLowerCase().startsWith('f')?'ft':
  radiusMatch?'m':null;
 return {supported:true,known:true,base:high,category:advanced?'advanced':'early',
  burstRadius:radius,burstUnit:unit,source:'description'};
}
function rlNaturalD20(roll){
 if(!roll||typeof roll!=='object')return null;
 // Foundry Roll.terms is the authoritative source, not roll.total.
 const dice=roll.dice??roll.terms?.filter?.(t=>t?.faces===20);
 if(!Array.isArray(dice))return null;
 const d20=dice.filter(d=>d?.faces===20);
 if(d20.length!==1)return null; // complex or multiple d20 dice
 const results=d20[0]?.results;
 if(!Array.isArray(results))return null;
 const active=results.filter(r=>r?.active!==false&&r?.discarded!==true&&r?.hidden!==true);
 if(active.length!==1||!Number.isSafeInteger(active[0].result)||
    active[0].result<1||active[0].result>20)return null;
 return active[0].result;
}
function rlMisfireRolls(use){
 // PF1's pf1AttackRoll hook supplies the evaluated d20 at roll time,
 // independent of chat-card layout. Collect all attacks for this firing.
 const tracked=RL_MISFIRE_ROLLS.get(use?.item?.uuid);
 if(Array.isArray(tracked)&&tracked.length){
  // A single unrecognizable roll must fail closed: no partial conclusions.
  return tracked.slice();
 }
 const entries=use?.shared?.chatAttacks;
 if(!Array.isArray(entries))return null;
 return entries.map(entry=>{
  const candidates=[
   entry?.attack?.roll,entry?.attackRoll,entry?.attack?.attackRoll,
   entry?.roll,entry?.attack?.rolls?.[0]
  ].filter(Boolean);
  const naturals=candidates.map(rlNaturalD20).filter(x=>x!==null);
  return naturals.length===1?naturals[0]:null;
 });
}
function rlInspectMisfire(use){
 const profile=rlMisfireProfile(use?.item);
 if(!profile?.supported||use?.action?.hasAttack!==true||
    use?.action?.actionType!=='rwak')return {status:'not-firearm'};
 if(!profile.known)return {status:'unconfigured',reason:profile.reason};
 const rolls=rlMisfireRolls(use);
 if(!rolls?.length||rolls.some(r=>r===null))
  return {status:'unresolved',reason:'native PF1 natural d20 result not verified',
   profile,rolls};
 // PF1: broken misfire +4, or +2 with firearm training in this
 // particular weapon. A GM can explicitly record +2 on the weapon.
 // Never infer weapon-specific class training from a generic class name.
 const increase=use.item?.getFlag?.(RL_NS,'brokenMisfireIncrease')===2?2:4;
 let broken=use.item?.isBroken===true||use.item?.system?.broken===true||
  rlMisfireFlag(use.item);
 const threshold=profile.base+(broken?increase:0);
 const scatter=use.action?.scatter===true||
  /(?:scatter|grapeshot|mitraille|grenaille|dispersion)/i.test(
   String(use.action?.name??''));
 // PF1 scatter: all target attack rolls must misfire; no premature
 // explosion when one target is low. The first phase does not prove
 // which individual dice are part of a single scatter volley.
 if(scatter&&rolls.length>1)return {
  status:'unresolved',reason:'scatter volley requires grouped attack adjudication',
  profile,threshold,rolls};
 const misfires=rolls.map((natural,index)=>{
  const beforeBroken=broken,limit=Math.min(20,profile.base+(broken?increase:0));
  const misfire=natural<=limit;
  const explodes=misfire&&beforeBroken&&profile.category==='early';
  if(misfire)broken=true;
  return {index,natural,threshold:limit,misfire,alreadyBroken:beforeBroken,
   explodes};
 });
 return {status:misfires.some(r=>r.explodes)?'explosion':
  misfires.some(r=>r.misfire)?'misfire':'clear',
  profile,threshold,brokenIncrease:increase,misfires};
}
function rlOnNativeAttackRoll(action,roll){
 if(!rlAllowed())return;
 const item=action?.parent?.type==='weapon'?action.parent:
  (action?.item?.type==='weapon'?action.item:null);
 const id=item?.uuid;
 if(!id||!RL_FIRING.has(id))return;
 if(!rlMisfireProfile(item)?.supported)return;
 const result=rlNaturalD20(roll);
 const existing=RL_MISFIRE_ROLLS.get(id)??[];
 existing.push(result);
 RL_MISFIRE_ROLLS.set(id,existing);
 console.debug('[PF1FR][Misfire] Native PF1 attack roll captured',
  {weapon:item.name,natural:result,rolls:existing.length});
}
const rlMisfireFlag=weapon=>weapon?.getFlag?.(RL_NS,'misfire')===true;
const rlExploded=weapon=>weapon?.getFlag?.(RL_NS,'exploded')===true;
/**
 * Broken by a FIRST verified misfire: use PF1's actual system.broken
 * condition and a separate item flag recording the cause.
 * A later ability script can check the flag and clear BOTH explicitly.
 * Never label ordinary physical damage as a misfire; never clear either
 * value here, and never auto-resolve the subsequent explosion.
 */
async function rlMarkMisfireBroken(weapon){
 if(weapon?.type!=='weapon')return false;
 if(!rlOwner(rlActor(weapon)))throw Error('Weapon OWNER permission required.');
 if(rlMisfireFlag(weapon))return false; // already recorded, no duplicate
 if(weapon.isBroken===true||weapon.system?.broken===true)return false;
 await weapon.update({
  'system.broken':true,
  ['flags.'+RL_NS+'.misfire']:true
 });
 return true;
}
/**
 * Preserve the Item and its content in Foundry instead of deleting it.
 * Explosion damage, burst square selection, Reflex saves and the magical
 * wrecked-vs-destroyed distinction require adjudication; the item is marked
 * unusable and can no longer shoot or reload through this module.
 */
async function rlMarkExplosion(weapon,details){
 if(rlExploded(weapon))return false;
 if(!rlOwner(rlActor(weapon)))throw Error('Weapon OWNER permission required.');
 await weapon.update({
  'system.broken':true,
  ['flags.'+RL_NS+'.exploded']:true,
  ['flags.'+RL_NS+'.explosionPending']:true
 });
 Hooks.callAll('pf1frFirearmExplosion',{weapon,...details});
 return true;
}
async function rlAnnounceExplosion(weapon,result,details){
 if(typeof ChatMessage?.create!=='function')return;
 const radius=result.profile?.burstRadius;
 const radiusLabel=radius!=null
  ?radius+' '+(result.profile.burstUnit==='m'?'m':'ft')
  :'rayon à vérifier dans la description de l’arme';
 const escape=globalThis.foundry?.utils?.escapeHTML??(x=>String(x));
 const message='<p><strong>Explosion d’arme à feu : '+
  escape(weapon.name)+'</strong></p>'+
  '<p>Rayon : '+escape(radiusLabel)+
  '. Choisir un coin de la case du porteur comme origine.</p>'+
  '<p>Chaque créature dans la zone subit les dégâts normaux de l’arme.'+
  ' <strong>Réflexes DD 12 : moitié des dégâts.</strong></p>'+
  '<p>Arme rudimentaire non magique : détruite ; magique : hors service'+
  ' jusqu’à réparation complète. Résolution MJ requise.</p>';
 try{await ChatMessage.create({
  speaker:ChatMessage.getSpeaker?.({actor:rlActor(weapon)})??{},
  content:message
 })}catch(error){console.warn('[PF1FR][Misfire] Explosion chat notice failed',error)}
}
async function rlTrackMisfire(use){
 if(!rlAllowed()||RL_MISFIRE_SEEN.has(use))return;
 RL_MISFIRE_SEEN.add(use);
 const result=rlInspectMisfire(use);
 if(result.status==='not-firearm')return;
 RL_MISFIRE_LAST={weapon:use?.item?.name??null,actor:use?.actor?.name??null,
  action:use?.action?.name??null,...result};
 if(result.status==='misfire'||result.status==='explosion'){
  const weapon=use.item;
  const wasBroken=weapon.isBroken===true||weapon.system?.broken===true;
  const alreadyMarked=rlMisfireFlag(weapon);
  let applied=false,exploded=false;
  try{
   // One ActionUse may contain sequential shots from separate barrels.
   // Their natural d20 results were adjudicated in order by the inspector.
   if(!wasBroken&&!alreadyMarked){
    applied=await rlMarkMisfireBroken(weapon);
   }
   if(result.status==='explosion'){
    exploded=await rlMarkExplosion(weapon,{
     use,result,reflexDC:12,burstRadius:result.profile.burstRadius,
     burstUnit:result.profile.burstUnit
    });
    if(exploded)await rlAnnounceExplosion(weapon,result);
   }
  }catch(error){
   RL_MISFIRE_LAST={...RL_MISFIRE_LAST,brokenApplied:applied,
    reason:String(error?.message??error)};
   console.error('[PF1FR][Misfire] Could not update broken/exploded weapon',error);
   ui.notifications?.error?.('PF1FR: Échec de mise à jour de l’arme après long feu.');
  }
  RL_MISFIRE_LAST={...RL_MISFIRE_LAST,brokenApplied:applied,
   explosionApplied:exploded,exploded:rlExploded(weapon),
   misfireFlag:rlMisfireFlag(weapon)};
  Hooks.callAll('pf1frMisfireDetected',{use,weapon,...result,
   brokenApplied:applied,alreadyBroken:wasBroken,misfireFlag:rlMisfireFlag(weapon),
   exploded:rlExploded(weapon)});
  if(exploded)ui.notifications?.error?.(
   'PF1FR : '+weapon.name+' explose ! Résoudre les dégâts et Réflexes DD 12.');
  else if(applied)ui.notifications?.warn?.(
   'PF1FR: Long feu — '+weapon.name+' est brisé (misfire).');
  else if(wasBroken||alreadyMarked)ui.notifications?.warn?.(
   'PF1FR: Nouveau long feu sur une arme déjà brisée.');
 }else if(result.status==='unresolved'){
  console.debug('[PF1FR][Misfire] PF1 natural d20 data not established',RL_MISFIRE_LAST);
 }
}
async function rlCommitShot(use){
 const actor=use.actor,weapon=use.item;
 const result=RL_SHOTS.get(use);
 if(!result)return;
 // Avoid carrying a snapshot across asynchronous updates. Reserve the
 // local weapon for the entire native use and read latest slots under lock.
 try{
  await rlLock(weapon,async()=>{
   const state=rlState(weapon);
   if(!state||state.slots.length<result.needed)
    throw Error('Loaded state changed during a native shot; manual reconciliation required.');
   const selected=state.slots.slice(0,result.needed);
   if(selected.some(slot=>slot.ammoId!==result.selected))
    throw Error('Loaded ammunition changed during a native shot; manual reconciliation required.');
   const after=state.slots.slice(result.needed);
   // PF1 has already consumed native ammunition exactly once. We only
   // update the separate chamber state; never consume or refund inventory.
   await weapon.setFlag(RL_NS,RL_KEY,{...state,slots:after});
   rlEvent('pf1frReloadShot','pf1aeReloadShot',{actorUuid:actor?.uuid,weaponUuid:weapon.uuid,
     actionId:use.action?.id,spent:result.needed,loaded:after.length});
  },{allowFiring:true});
 }catch(error){
  RL_LAST={status:'shot-reconciliation-required',weapon:weapon?.name??null,
   reason:String(error?.message??error)};
  console.error('[PF1FR][Reload] Shot state update failed; inspect weapon and inventory',error);
  ui.notifications?.error?.('Reload tracking requires manual reconciliation for '+(weapon?.name??'weapon')+'.');
 }finally{
  RL_SHOTS.delete(use);
  RL_FIRING.delete(weapon?.uuid);
  RL_MISFIRE_ROLLS.delete(weapon?.uuid);
 }
}
// Automatic but conservative PF1 weapon inference. Capacity is generally
// printed in the compendium description, not in a universal WeaponModel field.
const rlItems=actor=>[...(actor?.items?.contents??actor?.items?.values?.()??actor?.items??[])];
const rlAttackActions=weapon=>[...(weapon?.actions?.contents??weapon?.actions?.values?.()??weapon?.actions??[])].filter(action=>
  action?.actionType==='rwak'&&action?.hasAttack===true&&action?.ammo?.type&&
  Number(action?.ammo?.cost)>0);
const rlPlain=html=>String(html??'').replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/gi,' ')
  .replace(/\s+/g,' ').trim();
function rlInfer(weapon){
 if(weapon?.type!=='weapon'||!rlActor(weapon))return {ok:false,reason:'not a weapon'};
 const actions=rlAttackActions(weapon);
 if(!actions.length)return {ok:false,reason:'no native ranged ammunition action'};
 const types=[...new Set(actions.map(a=>a.ammo.type))];
 if(types.length!==1)return {ok:false,reason:'ambiguous native ammunition types'};
 const ammoType=types[0];
 const name=String(weapon.name??'').toLowerCase();
 const descriptions=[
  weapon.system?.description?.value,weapon.system?.description?.unidentified,
  weapon.system?.description?.summary,weapon.system?.description?.notes,
  weapon.system?.source?.text
 ].map(rlPlain).join(' ');
 const capMatch=descriptions.match(/(?:capacity|capacite|capacité)\s*:?\s*(\d{1,3})\b/i);
 let capacity=capMatch?Number(capMatch[1]):null;
 let source=capMatch?'description':null;
 if(!capacity){
  if(/double[-\s]barrel(?:ed)?\s+(?:pistol|musket)|(?:pistolet|mousquet)\s+(?:à\s+)?double\s+canon/i.test(name)){
   capacity=2;source='recognized double-barrel weapon';
  }else if(/(?:crossbow|arbalète|arbalete|pistol|pistolet|musket|mousquet)/i.test(name)&&
           !/(?:repeating|répétition|repetition|multiple|multi)/i.test(name)){
   capacity=1;source='recognized single-load weapon';
  }
 }
 if(!Number.isSafeInteger(capacity)||capacity<1||capacity>100)
  return {ok:false,reason:'capacity not structurally available; requires explicit GM override'};
 const actor=rlActor(weapon);
 const candidates=rlItems(actor).filter(item=>!item.inContainer&&
   rlIsWeaponAmmo(weapon,item,ammoType));
 const defaultId=weapon.system?.ammo?.default;
 const ammo=candidates.find(x=>x.id===defaultId)??candidates[0];
 if(!ammo)return {ok:false,capacity,ammoType,reason:'no matching native PF1 ammunition Item'};
 const kind=/arbalète lourde|arbalete lourde|heavy crossbow|mousquet|musket/i.test(name)?'full':
  /arbalète légère|arbalete legere|light crossbow|hand crossbow|arbalète de poing/i.test(name)?'move':
  'standard';
 return {ok:true,capacity,ammoType,ammoId:ammo.id,base:kind,source};
}
// Conservative automatic action creation: do not guess specialist weapons
// (repeating crossbows, pepperboxes, advanced firearms or unusual magazines).
// Native PF1 Action data is used; no independent feat is added to the actor.
const RL_ACTION_BUILDING=new Set();
function rlReloadProfile(weapon){
 if(weapon?.type!=='weapon'||!rlActor(weapon))return null;
 const name=String(weapon.name??'').toLowerCase().trim();
 // Compendium weapons can contain a perfectly valid native "Attack" action
 // with ammo.type=null, ammo.cost=0, or no generated action at all until
 // edited. These are NOT grounds to omit a weapon-owned Reload action.
 // Determine reloading from a recognized weapon identity, not ammo config.
 // Never guess unusual magazine/repeating mechanisms.
 if(/(?:repeating|répétition|repetition|pepperbox|pepper-box|revolver|rifle|fusil à répétition)/i.test(name))
  return null;
 if(/(?:arbalète|arbalete|crossbow)/i.test(name)){
  if(/(?:lourde|heavy)/i.test(name))return {base:'full',kind:'heavy-crossbow'};
  if(/(?:légère|legere|light|de poing|hand)/i.test(name))
   return {base:'move',kind:'light-or-hand-crossbow'};
  return null;
 }
 if(/(?:mousquet|musket|blunderbuss|tromblon)/i.test(name))
  return {base:'full',kind:'early-two-handed-firearm'};
 if(/(?:pistolet|pistol)/i.test(name))
  return {base:'standard',kind:'early-one-handed-firearm'};
 return null;
}
async function rlEnsureReloadAction(weapon){
 if(!rlAllowed()||!game.user?.isGM||!rlOwner(rlActor(weapon)))return false;
 const profile=rlReloadProfile(weapon);
 if(!profile||rlActions(weapon).some(a=>rlReloadName(a?.name)))return false;
 const key=weapon.uuid;
 if(!key||RL_ACTION_BUILDING.has(key))return false;
 const Action=globalThis.pf1?.models?.components?.Action??
  globalThis.pf1?.components?.Action??globalThis.pf1?.components?.ItemAction;
 if(typeof Action?.create!=='function'){
  console.warn('[PF1FR][Reload] Native PF1 Action.create unavailable; cannot generate action.',
   {weapon:weapon.name,uuid:weapon.uuid,apiAvailable:!!globalThis.pf1?.models?.components});
  return false;
 }
 RL_ACTION_BUILDING.add(key);
 try{
  if(rlActions(weapon).some(a=>rlReloadName(a?.name)))return false;
  // PF1 v11.11 Action.create expects an ARRAY of action data.
  // Passing an object throws "e.map is not a function" (action.mjs).
  const created=await Action.create([{
   name:'Reload',
   actionType:'other',
   hasAttack:false,
   activation:{type:profile.base},
   ammo:{type:null,cost:0}
  }],{parent:weapon});
  const action=Array.isArray(created)?created[0]:created;
  if(!action)throw Error('PF1 Action.create returned no created Action.');
  console.info('[PF1FR][Reload] Created native Reload action',weapon.name,
   profile.kind,profile.base,action?.id);
  return !!action;
 }catch(error){
  console.error('[PF1FR][Reload] Native Reload action creation failed',weapon?.name,error);
  return false;
 }finally{RL_ACTION_BUILDING.delete(key);}
}
async function rlScanReloadActions(){
 if(!game.user?.isGM||!rlAllowed())return;
 const actors=[...(game.actors?.contents??[])];
 for(const scene of game.scenes?.contents??[]){
  for(const token of scene.tokens?.contents??[]){
   if(token?.actor&&!actors.includes(token.actor))actors.push(token.actor);
  }
 }
 for(const actor of actors){
  for(const item of rlItems(actor)){
   if(item?.type==='weapon')await rlEnsureReloadAction(item);
  }
 }
}
async function rlAutoConfigure(weapon){
 const existing=rlState(weapon);if(existing)return existing;
 const inferred=rlInfer(weapon);
 if(!inferred.ok)throw Error(rlL('AutoUnavailable')+': '+inferred.reason);
 const configured=await rlConfigure(weapon,{
  capacity:inferred.capacity,ammoType:inferred.ammoType,
  base:inferred.base,actionCosts:{}
 });
 if(weapon.system?.ammo?.default!==inferred.ammoId)
  await weapon.update({'system.ammo.default':inferred.ammoId});
 return configured;
}
// PF1 11.11 weapon sheets expose a persistent .sidebar. Insert the reload
// status immediately AFTER the native Hardness (Solidité) descriptor, not
// into the header or into the grid containing the sheet's tabs.
function rlSheetWidget(sheet,html){
 if(!rlAllowed())return;
 const weapon=sheet?.document??sheet?.item??sheet?.object;
 if(weapon?.type!=='weapon'||!rlActor(weapon)||!rlOwner(rlActor(weapon)))return;
 if(!rlAttackActions(weapon).length&&!rlState(weapon))return;
 const root=html?.[0]??html??sheet?.element?.[0]??sheet?.element;
 if(!root?.querySelector)return;
 const sidebar=root.matches?.('.sidebar')?root:root.querySelector('.sidebar');
 if(!sidebar||sidebar.querySelector('[data-pf1fr-reload-widget]'))return;
 const state=rlState(weapon),inferred=rlInfer(weapon);
 const container=document.createElement('section');
 container.dataset.pf1frReloadWidget='true';
 container.className='pf1fr-reload-sidebar';
 container.style.cssText='display:flex;flex-direction:column;flex:0 0 auto;gap:3px;'+
  'padding:4px 3px 5px;margin:4px 0 6px;min-height:0;max-width:100%;'+
  'border-top:1px solid var(--color-border,#888);'+
  'border-bottom:1px solid var(--color-border,#888);';
 const heading=document.createElement('h5');
 heading.textContent=rlL('Loading');
 heading.style.cssText='margin:0 0 2px;line-height:1.3;';
 container.append(heading);
 const content=document.createElement('div');
 content.style.cssText='display:flex;align-items:center;justify-content:space-between;'+
  'gap:5px;min-width:0;flex-wrap:wrap;';
 const status=document.createElement('span');
 status.textContent=state?state.slots.length+' / '+state.capacity:
  inferred.ok?'0 / '+inferred.capacity:'— / ?';
 status.title=state?rlL('Loaded',{loaded:state.slots.length,capacity:state.capacity}):
  inferred.ok?rlL('InitialStatus'):rlL('AutoUnavailable');
 status.style.cssText='font-weight:600;white-space:nowrap;flex:1 1 auto;';
 content.append(status);
 const actions=document.createElement('div');
 actions.style.cssText='display:flex;gap:3px;flex:0 0 auto;align-items:center;';
 const button=(label,tooltip,fn)=>{
  const element=document.createElement('button');
  element.type='button';element.textContent=label;element.title=tooltip;
  element.style.cssText='font:inherit;font-size:12px;line-height:1;min-width:24px;'+
   'width:auto;min-height:22px;height:22px;margin:0;padding:2px 5px;flex:0 0 auto;';
  element.addEventListener('click',event=>{
   event.preventDefault();event.stopPropagation();
   void Promise.resolve().then(fn).then(()=>sheet.render?.(true))
    .catch(error=>ui.notifications?.warn?.(error.message));
  });
  actions.append(element);
 };
 if(state?.slots.length)button('−',rlL('Unload'),()=>rlUnload(weapon,{count:1}));
 if(game.user?.isGM)button('⚙',rlL('Capacity'),async()=>{
  const current=rlState(weapon),guess=rlInfer(weapon);
  const chosen=await Dialog.prompt({
   title:rlL('Capacity'),
   content:'<label>'+rlL('Capacity')+
    ' <input name="capacity" type="number" min="1" max="100" value="'+
    (current?.capacity??guess.capacity??1)+'"></label>',
   callback:html=>Number(html.find?.('[name="capacity"]')?.val?.()??
    html.querySelector?.('[name="capacity"]')?.value)
  });
  if(chosen==null)return;
  const ammoType=current?.ammoType??guess.ammoType;
  if(!ammoType)throw Error(rlL('AutoUnavailable'));
  await rlConfigure(weapon,{capacity:chosen,ammoType,
   base:current?.base??guess.base??'standard',actionCosts:current?.actionCosts??{}});
 });
 content.append(actions);container.append(content);
 // PF1 physical item sidebar adds its hardness row with a protected input
 // named system.hardness. Using that stable field is language-independent.
 const hardness=sidebar.querySelector('input[name="system.hardness"]');
 const hp=sidebar.querySelector('input[name="system.hp.value"]');
 const anchor=hardness?.closest('.descriptor')??hardness?.closest('label')??
  hp?.closest('.descriptor')??hp?.closest('.range-value');
 if(anchor?.parentElement===sidebar)anchor.insertAdjacentElement('afterend',container);
 else{
  // Future sheet variations: remain in the sidebar, never spill into the tabs.
  const firstCheckbox=sidebar.querySelector('.descriptor.checkbox');
  if(firstCheckbox?.parentElement===sidebar)sidebar.insertBefore(container,firstCheckbox);
  else sidebar.append(container);
 }
}
/**
 * PF1 ItemPF.use({ actionId, skipDialog }) is the native entry point used by
 * action buttons. Only a resolved, non-attack Reload action is sent directly
 * to PF1 with skipDialog=true; native ActionUse still executes its normal
 * hooks, scripts, permissions and post-use reload bookkeeping.
 *
 * No replacement ActionUse, no custom ammo deduction, no click bubbling,
 * and no changes to normal attacks or ambiguous feat-based Reload actions.
 */
/**
 * PF1 11.11 ActionSelector is a separate form application. Selecting an
 * entry is handled by its DOM click listener, NOT by ItemAction.use().
 * The chooser entries expose .action[data-action="click"] and an image alt
 * with the action's label; they do not expose data-action-id.
 *
 * Intercept only a uniquely identifiable non-attack Reload entry, resolve
 * its owning weapon from the chooser's Actor/Item document identifiers,
 * and invoke the EXACT native Item.use({actionId,skipDialog:true}) call
 * already tested by the user. Leave Attack and ambiguous entries alone.
 */
function rlInstallSelectorReload(){
 if(typeof document==='undefined'||typeof document.addEventListener!=='function')return false;
 const handler=event=>{
  if(!rlAllowed()||event?.defaultPrevented)return;
  const row=event?.target?.closest?.('.action[data-action="click"]');
  const form=row?.closest?.('form[id^="ActionSelector-"]');
  if(!form||!row)return;
  const label=String(row.querySelector?.('img[alt]')?.getAttribute?.('alt')??
   row.textContent??'').trim();
  if(!rlReloadName(label))return;
  // The chooser form ID includes the owning Item ID, even though the
  // clicked action row itself lacks data-item-id and data-action-id.
  const id=String(form.id??'');
  const match=id.match(/-Item-([A-Za-z0-9]+)(?:-|$)/);
  if(!match)return;
  const itemId=match[1];
  const actors=[...(game.actors?.contents??[])];
  for(const scene of game.scenes?.contents??[]){
   for(const token of scene.tokens?.contents??[])
    if(token?.actor)actors.push(token.actor);
  }
  const weapons=[];
  for(const actor of actors){
   const item=actor?.items?.get?.(itemId);
   if(item?.type!=='weapon'||!id.includes('-Actor-'+actor.id+'-Item-'))continue;
   if(!weapons.some(x=>x.uuid===item.uuid))weapons.push(item);
  }
  if(weapons.length!==1)return;
  const weapon=weapons[0];
  const candidates=rlActions(weapon).filter(action=>
   String(action?.name??'').trim()===label&&
   action.hasAttack!==true&&rlReloadName(action.name));
  if(candidates.length!==1||typeof weapon.use!=='function')return;
  event.preventDefault();
  event.stopImmediatePropagation?.();
  event.stopPropagation?.();
  const action=candidates[0];
  // Foundry v13 ActionSelector is an ApplicationV2, registered in
  // foundry.applications.instances (NOT ui.windows, which tracks V1).
  // Match the actual clicked form against the application's rendered DOM.
  // Keep the V1 fallback for older sheet integrations.
  const appV2=globalThis.foundry?.applications?.instances;
  const registeredApps=[
   ...(appV2 instanceof Map?appV2.values():[]),
   ...Object.values(ui.windows??{})
  ];
  const chooser=registeredApps.find(app=>{
   const root=app?.element?.[0]??app?.element;
   return typeof app?.close==='function'&&
    (root===form||root?.contains?.(form)||app?.form===form);
  });
  if(chooser){
   void Promise.resolve().then(()=>chooser.close()).catch(error=>
    console.warn('[PF1FR][Reload] Could not close action chooser',error));
  }else{
   console.warn('[PF1FR][Reload] No matching ActionSelector application found to close',
    form.id);
  }
  console.debug('[PF1FR][Reload] ActionSelector selected Reload directly',
   weapon.name,action.id);
  void Promise.resolve().then(()=>weapon.use({
   actionId:action.id,skipDialog:true
  })).catch(error=>{
   console.error('[PF1FR][Reload] Direct ActionSelector Reload failed',error);
   ui.notifications?.error?.(String(error?.message??error));
  });
 };
 document.addEventListener('click',handler,true);
 return true;
}
function rlInstallInstantUse(){
 const ensureSkip=(item,action,options)=>{
  if(!rlAllowed()||!options||typeof options!=='object'||options.skipDialog===true)
   return options;
  if(!action||action.hasAttack===true)return options;
  const request=rlReloadRequest({item,actor:rlActor(item),action});
  return request.candidate&&request.weapon
   ?{...options,skipDialog:true}:options;
 };
 let installed=0;
 // PF1 11.11: the actual character-sheet action belongs to
 // pf1.components.ItemAction (module/components/action.mjs).
 // The earlier wrapper targeted the newer pf1.models.components.Action,
 // leaving the real Reload button untouched. Patch both variants.
 const actionClasses=new Set([
  globalThis.pf1?.components?.ItemAction,
  globalThis.pf1?.components?.Action,
  globalThis.pf1?.models?.components?.Action
 ]);
 for(const cls of actionClasses){
  let proto=cls?.prototype;
  while(proto && !Object.prototype.hasOwnProperty.call(proto,'use'))
   proto=Object.getPrototypeOf(proto);
  if(!proto||typeof proto.use!=='function')continue;
  const original=proto.use;
  if(original.pf1frInstantReloadWrapped){installed++;continue;}
  const wrapped=function(options={}){
   // The PF1 v11.11 ItemAction is a pseudo-document owned by this.parent.
   // Route Reload *directly* through the native ItemPF.use entry point
   // demonstrated to work in-world (actionId + skipDialog). This also
   // avoids implicit action selection and the Action.use popup pathway.
   const weapon=this.parent?.type==='weapon'
    ?this.parent:(this.item?.type==='weapon'?this.item:null);
   if(rlAllowed()&&weapon&&rlReloadName(this.name)&&this.hasAttack!==true&&
      typeof weapon.use==='function'){
    const supplied=options&&typeof options==='object'?options:{};
    return weapon.use({...supplied,actionId:this.id,skipDialog:true});
   }
   const item=this.parent??this.item;
   return original.call(this,ensureSkip(item,this,options));
  };
  wrapped.pf1frInstantReloadWrapped=true;
  proto.use=wrapped;
  installed++;
 }
 // Also cover direct item.use() calls. PF1 subclasses may override the
 // base implementation, so locate the concrete document class in addition
 // to the inherited owner of use().
 const itemClasses=new Set([
  globalThis.CONFIG?.Item?.documentClass,
  globalThis.pf1?.documents?.item?.ItemPF,
  globalThis.pf1?.documents?.ItemPF
 ]);
 for(const cls of itemClasses){
  let proto=cls?.prototype;
  while(proto && !Object.prototype.hasOwnProperty.call(proto,'use'))
   proto=Object.getPrototypeOf(proto);
  if(!proto||typeof proto.use!=='function')continue;
  const original=proto.use;
  if(original.pf1frInstantReloadWrapped){installed++;continue;}
  const wrapped=function(options={}){
   const actions=rlActions(this);
   const action=options?.actionId!=null?
    actions.find(a=>a?.id===options.actionId):actions[0];
   return original.call(this,ensureSkip(this,action,options));
  };
  wrapped.pf1frInstantReloadWrapped=true;
  proto.use=wrapped;
  installed++;
 }
 if(!installed)
  console.warn('[PF1FR][Reload] Neither PF1 Action.use nor Item.use could be wrapped; native dialogs remain.');
 else
  console.info('[PF1FR][Reload] Instant native Reload active:',installed,'entry points.');
 return installed>0;
}
function rlInstall(){
 Hooks.on('pf1AttackRoll',rlOnNativeAttackRoll);
 // The actual PF1 dialog is created by ActionUse.process({skipDialog}).
 // PF1 constructs the ActionUse before processing and exposes that instance
 // through pf1CreateActionUse, independent of the sheet click handler.
 Hooks.on('pf1CreateActionUse',use=>{
  if(!rlAllowed()||typeof use?.process!=='function')return;
  const request=rlReloadRequest(use);
  if(!request.candidate||!request.weapon||use.action?.hasAttack)return;
  if(use.shared && typeof use.shared==='object') use.shared.skipDialog=true;
  const original=use.process;
  if(original.pf1frInstantProcessWrapped)return;
  const wrapped=function(options={}){
   // Respect all native options, notably chatMessage and rollMode.
   const overrides=options&&typeof options==='object'
    ?{...options,skipDialog:true}:{skipDialog:true};
   return original.call(this,overrides);
  };
  wrapped.pf1frInstantProcessWrapped=true;
  use.process=wrapped;
 });
 // Works with private as well as public PF1 ActionUse classes. No prototype
 // monkey-patching or dependency on undocumented global exports.
 Hooks.on('pf1CreateActionUse',use=>{
  if(!rlAllowed()||use?.item?.type!=='weapon'||
     rlNativeAction(use)||typeof use.generateChatAttacks!=='function')return;
  if(use.generateChatAttacks.pf1frReloadWrapped)return;
  // PF1 ActionUse.getAmmo() normally only includes actor.itemTypes.ammo.
  // Add the already-linked loot/ammo to THIS instance's native choices.
  const ammoType=use.action?.ammo?.type;
  const defaultId=use.item?.system?.ammo?.default;
  const linked=rlAmmo(use.actor,defaultId);
  if(rlIsLinkedLegacyAmmo(use.item,linked,ammoType)&&
     !linked.inContainer&&typeof use.getAmmo==='function'){
   const originalGetAmmo=use.getAmmo;
   use.getAmmo=function(...args){
    const choices=originalGetAmmo.apply(this,args);
    if(!Array.isArray(choices)||choices.some(x=>x.id===linked.id))return choices;
    const cost=Math.max(1,Number(this.action?.ammo?.cost)||1);
    if(!linked.system?.abundant&&rlQuantity(linked)<cost)return choices;
    return [...choices,{id:linked.id,quantity:rlQuantity(linked),
     abundant:linked.system?.abundant===true,
     data:linked.toObject?.()??foundry.utils.deepClone(linked),
     document:linked,isDefault:true}];
   };
  }
  const original=use.generateChatAttacks;
  const guarded=async function(...args){
   const check=rlCheck(this);
   RL_LAST={status:check.managed?(check.ok?'authorized':'blocked'):'unmanaged',
    actor:this.actor?.name??null,weapon:this.item?.name??null,
    action:this.action?.name??null,...check};
   if(check.managed){
    if(!check.ok){rlDeny(this,check);return;}
    RL_SHOTS.set(this,check);
    RL_MISFIRE_ROLLS.delete(this.item.uuid);
    RL_FIRING.add(this.item.uuid);
   }
   try{return await original.apply(this,args)}
   catch(error){
    RL_SHOTS.delete(this);
    RL_FIRING.delete(this.item?.uuid);
    RL_MISFIRE_ROLLS.delete(this.item?.uuid);
    throw error;
   }
  };
  guarded.pf1frReloadWrapped=true;
  use.generateChatAttacks=guarded;
 });
 // Called after attack generation but before native inventory/charge
 // deductions. Return false to stop normal PF1 processing.
 Hooks.on('pf1PreActionUse',use=>{
  if(RL_DENIED.has(use)){
   RL_DENIED.delete(use);
   RL_FIRING.delete(use?.item?.uuid);
   RL_MISFIRE_ROLLS.delete(use?.item?.uuid);
   return false;
  }
 });
 Hooks.on('pf1PostActionUse',use=>{
  if(!rlAllowed())return;
  const request=rlReloadRequest(use);
  if(request.candidate){
   if(RL_RELOAD_SEEN.has(use))return;
   RL_RELOAD_SEEN.add(use);
   if(!request.weapon){
    RL_LAST={status:'reload-unresolved',action:use.action?.name??null,
     item:use.item?.name??null,reason:request.reason??'unknown weapon'};
    ui.notifications?.warn?.(rlL('ReloadFailed')+': '+RL_LAST.reason);
    return;
   }
   const weapon=request.weapon;
   RL_LAST={status:'reload-started',weapon:weapon.name??null,
    action:use.action?.name??null};
   void (async()=>{
    try{
     await rlAutoConfigure(weapon);
     const next=await rlReload(weapon,{count:1});
     RL_LAST={status:'reloaded',weapon:weapon.name??null,
      loaded:next.slots.length,capacity:next.capacity};
    }catch(error){
     RL_LAST={status:'reload-failed',weapon:weapon.name??null,
      reason:String(error?.message??error),ammo:rlAmmoDiagnostic(weapon)};
     console.warn('[PF1FR][Reload] Native Reload action failed',RL_LAST);
     ui.notifications?.warn?.(rlL('ReloadFailed')+': '+RL_LAST.reason);
    }
   })();
   return;
  }
  if(use?.item?.type==='weapon'&&RL_SHOTS.has(use)){
   void rlTrackMisfire(use);
   void rlCommitShot(use);
  }
 });;
}
Hooks.once('ready',async()=>{
 if(game.user?.isGM) await migrateLegacyReload();
 const mod=game.modules.get(RL_NS);
 if(!mod)return;
 mod.api??={};
 mod.api.reload=Object.freeze({
  getState:weapon=>rlState(weapon),
  canFire:(weapon,action,attacks=1)=>{
   const state=rlState(weapon);
   const needed=state?.actionCosts?.[action?.id]??Math.max(1,attacks)*(action?.ammo?.cost??1);
   return {ok:!!state&&state.slots.length>=needed,needed,loaded:state?.slots.length??0};
  },
  configure:rlConfigure,reload:rlReload,unload:rlUnload,
  infer:rlInfer,initialize:rlAutoConfigure,
   ensureReloadAction:rlEnsureReloadAction,reloadProfile:rlReloadProfile,
   diagnoseAutoAction:weapon=>({
    name:weapon?.name??null,uuid:weapon?.uuid??null,
    actor:rlActor(weapon)?.name??null,profile:rlReloadProfile(weapon),
    actions:rlActions(weapon).map(a=>({
     id:a?.id,name:a?.name,actionType:a?.actionType,hasAttack:a?.hasAttack,
     ammoType:a?.ammo?.type,ammoCost:a?.ammo?.cost
    })),
    alreadyHasReload:rlActions(weapon).some(a=>rlReloadName(a?.name)),
    gm:!!game.user?.isGM,allowed:rlAllowed(),
    nativeActionApi:typeof (globalThis.pf1?.models?.components?.Action??
     globalThis.pf1?.components?.Action??globalThis.pf1?.components?.ItemAction)?.create
   }),
  misfire:Object.freeze({
   profile:rlMisfireProfile,inspect:rlInspectMisfire,
   isMarked:rlMisfireFlag,flagPath:'flags.'+RL_NS+'.misfire',
   isExploded:rlExploded,explodedFlagPath:'flags.'+RL_NS+'.exploded',
   lastDiagnostic:()=>RL_MISFIRE_LAST?{...RL_MISFIRE_LAST}:null
  }),
  lastDiagnostic:()=>RL_LAST?{...RL_LAST}:null,
  ammoDiagnostic:rlAmmoDiagnostic
 });
 if(!rlAllowed()){
  const old=game.modules.get('pf1-automation-engine');
  if(old?.active){
   const message='PF1 Firearms & Reload: PF1 Automation Engine still owns the old reload hooks. Update PF1AE to the version that delegates reloading; do not use both reload engines.';
   console.error(message);
   if(game.user?.isGM) ui.notifications?.error?.(message,{permanent:true});
  }
  return;
 }
 rlInstall();
 rlInstallInstantUse();
 rlInstallSelectorReload();
 if(game.user?.isGM){
  Hooks.on('createItem',item=>{
   if(item?.type==='weapon')void rlEnsureReloadAction(item);
  });
  Hooks.on('updateItem',item=>{
   if(item?.type==='weapon')void rlEnsureReloadAction(item);
  });
  void rlScanReloadActions();
 }
 Hooks.on('renderItemSheet',rlSheetWidget);
 Hooks.on('renderItemSheetV2',rlSheetWidget);
});
