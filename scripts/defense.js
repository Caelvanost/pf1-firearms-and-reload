/**
 * PF1 Firearms & Reload — independent firearm defense selection engine.
 * Foundry 13 / PF1 11.11. NEVER rolls attacks, computes attack penalties,
 * compares AC, or alters native PF1 ItemAction.touch.
 */
export function createFirearmDefenseAPI({namespace="pf1-firearms-and-reload",now=()=>Date.now()}={}){
 const overrides=new Map();
 const prepared=new WeakMap();
 const currentUses=new Set();
 function captureNativeActionUse(use){
  const identity=nativeIdentity(use);
  if(!identity)return false;
  const existing=[...currentUses].find(x=>x.use===use);
  if(existing)return true;
  const record={use,...identity,createdAt:now()};
  currentUses.add(record);
  return true;
 }
 function releaseNativeActionUse(use){
  for(const x of currentUses)if(x.use===use){
   currentUses.delete(x);return true;
  }
  return false;
 }
 function findCurrentActionUse({item,action}={}){
  prunePrepared();
  const actor=item?.actor;
  if(item?.type!=="weapon"||!actor?.uuid||!item?.uuid||
     !action?.id||!permitted(actor))return null;
  const candidates=[...currentUses].filter(x=>x.itemUuid===item.uuid&&
   x.actorUuid===actor.uuid&&x.actionId===action.id&&
   now()-x.createdAt<=PREPARED_TTL);
  // Never guess the ActionUse if two same-weapon shots overlap.
  return candidates.length===1?candidates[0].use:null;
 }
 function prepareForCurrentUse({item,action,attackIndex=0,defense,reason}={}){
  const actionUse=findCurrentActionUse({item,action});
  if(!actionUse)throw Error("No unique active native ActionUse for item and action");
  return prepareAttackOverride({actionUse,attackIndex,defense,reason});
 }

 const activePrepared=new Set();
 const PREPARED_TTL=120000;
 let preparedDiagnostic=null;
 function nativeIdentity(use){
  if(!use||typeof use!=="object")return null;
  const action=use.action??use.shared?.action;
  const item=use.item??action?.item??action?.parent;
  const actor=use.actor??item?.actor;
  if(item?.type!=="weapon"||!item?.uuid||!actor?.uuid||!action?.id)return null;
  if(item.actor?.uuid&&item.actor.uuid!==actor.uuid)return null;
  if(action.item?.uuid&&action.item.uuid!==item.uuid)return null;
  if(action.parent?.uuid&&action.parent.uuid!==item.uuid)return null;
  return {item,actor,action,actorUuid:actor.uuid,itemUuid:item.uuid,actionId:action.id};
 }
 function permitted(actor){
  if(typeof game==="undefined"||!game.user)return false;
  return game.user.isGM===true||actor?.testUserPermission?.(game.user,"OWNER")===true;
 }
 function dropPrepared(entry,reason){
  if(!entry||entry.closed)return false;
  entry.closed=true;
  activePrepared.delete(entry);
  prepared.delete(entry.use);
  releaseNativeActionUse(entry.use);
  if(entry.timer)clearTimeout(entry.timer);
  entry.entries.clear();
  preparedDiagnostic={status:"cleared",reason,actorUuid:entry.actorUuid,
   itemUuid:entry.itemUuid,actionId:entry.actionId,messageId:entry.messageId??null};
  return true;
 }
 function prunePrepared(){
  const stamp=now();
  for(const x of currentUses)if(stamp-x.createdAt>PREPARED_TTL)currentUses.delete(x);
  for(const entry of activePrepared)
   if(stamp-entry.createdAt>PREPARED_TTL)dropPrepared(entry,"expired");
 }
 function prepareAttackOverride({actionUse,attackIndex=0,defense,reason="external-script"}={}){
  prunePrepared();
  const identity=nativeIdentity(actionUse);
  if(!identity)throw Error("A real PF1 weapon ActionUse with actor/item/action is required");
  if(!permitted(identity.actor))throw Error("Actor OWNER permission required");
  if(!Number.isSafeInteger(attackIndex)||attackIndex<0||attackIndex>99)
   throw Error("Invalid native attackIndex (0..99)");
  if(defense!=="touch"&&defense!=="normal")throw Error("Invalid defense override");
  if(identity.action.hasAttack!==true||identity.action.actionType!=="rwak")
   throw Error("Action must be a ranged native weapon attack");
  // If preparation is attempted after native attacks exist, fail closed.
  if((actionUse?.shared?.chatAttacks?.length??0)>0)
   throw Error("Override must be prepared before native attack rolls");
  let entry=prepared.get(actionUse);
  if(!entry){
   entry={use:actionUse,...identity,entries:new Map(),createdAt:now(),
    messageId:null,closed:false};
   prepared.set(actionUse,entry);activePrepared.add(entry);
   if(typeof setTimeout==="function"){
    entry.timer=setTimeout(()=>dropPrepared(entry,"expired"),PREPARED_TTL);
    entry.timer?.unref?.();
   }
  }else if(entry.closed||entry.actorUuid!==identity.actorUuid||
    entry.itemUuid!==identity.itemUuid||entry.actionId!==identity.actionId)
   throw Error("ActionUse identity mismatch or already completed");
  if(entry.entries.has(attackIndex))throw Error("Override for native attack index already prepared");
  entry.entries.set(attackIndex,{defense,reason:str(reason).slice(0,200)||"external-script"});
  preparedDiagnostic={status:"prepared",actorUuid:entry.actorUuid,itemUuid:entry.itemUuid,
   actionId:entry.actionId,attackIndex,defense,messageId:null};
  return true;
 }
 function cancelPreparedAttackOverride({actionUse,attackIndex}={}){
  const entry=prepared.get(actionUse);
  if(!entry||entry.closed)return false;
  if(attackIndex===undefined)return dropPrepared(entry,"cancelled");
  if(!Number.isSafeInteger(attackIndex)||attackIndex<0)return false;
  const removed=entry.entries.delete(attackIndex);
  if(!entry.entries.size)dropPrepared(entry,"cancelled");
  else if(removed)preparedDiagnostic={status:"cancelled",actorUuid:entry.actorUuid,
   itemUuid:entry.itemUuid,actionId:entry.actionId,attackIndex};
  return removed;
 }
 function preparedFor(context){
  const entry=prepared.get(context?.actionUse);
  if(!entry||entry.closed)return null;
  const idx=context.attackIndex;
  const actorUuid=context?.actorUuid??context?.actor?.uuid;
  const itemUuid=context?.itemUuid??context?.weapon?.uuid??context?.item?.uuid;
  const actionId=context?.actionId??context?.action?.id;
  if(!Number.isSafeInteger(idx)||idx<0||actorUuid!==entry.actorUuid||
     itemUuid!==entry.itemUuid||actionId!==entry.actionId)return null;
  return entry.entries.get(idx)??null;
 }
 function bindActionUseMessage(actionUse,message){
  const entry=prepared.get(actionUse);
  if(!entry||entry.closed)return false;
  const messageId=message?.id;
  if(typeof messageId!=="string"||!messageId)return false;
  entry.messageId=messageId;
  return true;
 }
 function finishResolvedAttack(event){
  // PF1AE's pf1aeAttackResolution fires AFTER all target comparisons for
  // one native roll. Unlike the provider, it is safe to clean an index here.
  prunePrepared();
  if(!event?.sourceMessageId||!Number.isSafeInteger(event?.attackIndex))return false;
  const matches=[...activePrepared].filter(entry=>entry.messageId===event.sourceMessageId&&
   entry.actorUuid===event.actorUuid&&entry.itemUuid===event.itemUuid&&
   entry.actionId===event.actionId);
  if(matches.length!==1)return false; // never confuse concurrent actions
  const entry=matches[0];
  const removed=entry.entries.delete(event.attackIndex);
  if(removed)preparedDiagnostic={status:"consumed",actorUuid:entry.actorUuid,
   itemUuid:entry.itemUuid,actionId:entry.actionId,attackIndex:event.attackIndex,
   messageId:entry.messageId,defense:event.defense?.type??null,
   provider:event.defense?.provider??null};
  // All indices on this ActionUse may have been evaluated at this point.
  // Retain other prepared indices for later rolls in the same ActionUse.
  if(!entry.entries.size)dropPrepared(entry,"resolved");
  return removed;
 }

 const MAX_OVERRIDE_AGE=120000;
 let last=null;
 const integer=n=>Number.isSafeInteger(n)&&n>=1&&n<=100;
 const finitePositive=n=>typeof n==='number'&&Number.isFinite(n)&&n>0;
 const str=v=>typeof v==='string'?v.trim():'';
 const fromFlag=(weapon,key)=>weapon?.getFlag?.(namespace,key);
 const obj=x=>x&&typeof x==='object'&&!Array.isArray(x);
 const plain=x=>String(x??'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
 function typeFromNative(weapon){
  const sys=weapon?.system??{};
  const tokens=[
   sys.weaponType,sys.weaponSubtype,sys.weaponCategory,sys.category,
   sys.weaponData?.type,sys.weaponData?.subType,sys.tags?.category
  ].map(x=>str(x).toLowerCase());
  if(tokens.some(s=>/^(?:firearm|firearms|gun|guns|arme.?a.?feu)$/.test(s)))
   return "firearm";
  if(tokens.some(s=>/^(?:bow|crossbow|arbalete|arbalète|melee|meleeweapon|thrown)$/.test(s)))
   return "other";
  const properties=sys.properties??{};
  if(properties.firearm===true||properties.gun===true)return "firearm";
  if(properties.firearm?.value===true||properties.gun?.value===true)return "firearm";
  return null;
 }
 function classify(weapon){
  if(weapon?.type!=='weapon')return {status:"not-firearm",reason:"not a weapon"};
  const configured=str(fromFlag(weapon,"firearmCategory")).toLowerCase();
  if(configured==="other")return {status:"not-firearm",reason:"manual exclusion"};
  if(configured==="early"||configured==="advanced")
   return {status:"ok",category:configured,source:"manual"};
  const native=typeFromNative(weapon);
  if(native==="other")return {status:"not-firearm",reason:"native non-firearm"};
  const sys=weapon.system??{};
  const tags=[sys.firearmCategory,sys.weaponData?.firearmCategory,
   sys.firearmType,sys.weaponData?.firearmType];
  const cat=tags.map(x=>str(x).toLowerCase()).find(x=>
   /^(?:early|advanced|primitive|primitif|primit ive|evolved|evoluee|évoluée)$/.test(x));
  if(cat)return {status:"ok",category:/advanced|evolved|evolu|évolu/.test(cat)?
   "advanced":"early",source:"native"};
  // A verified native firearm without a category is ambiguous.
  if(native==="firearm")return {status:"unknown",reason:"native firearm lacks early/advanced category"};
  // Label fallback is intentionally lower confidence, not a substitute for native metadata.
  const name=str(weapon.name).toLowerCase();
  if(/(?:crossbow|arbal[eè]te|bow|arc long|arc court)/i.test(name))
   return {status:"not-firearm",reason:"non-firearm name"};
  if(/(?:revolver|rifle|shotgun|fusil à pompe)/i.test(name))
   return {status:"ok",category:"advanced",source:"name-fallback"};
  if(/(?:pistol|pistolet|mousquet|musket|blunderbuss|tromblon|arquebuse|arquebus)/i.test(name))
   return {status:"ok",category:"early",source:"name-fallback"};
  return {status:"unknown",reason:"weapon lacks recognized firearm metadata"};
 }
 function rangeInfo(weapon,action){
  const explicit=fromFlag(weapon,"rangeIncrement");
  const sys=weapon?.system??{};
  const candidates=[
   {v:explicit,units:fromFlag(weapon,"rangeUnits"),source:"manual"},
   {v:action?.range?.value,units:action?.range?.units,source:"native-action"},
   {v:action?.range?.increment,units:action?.range?.units,source:"native-action"},
   {v:sys.range?.value,units:sys.range?.units,source:"native-weapon"},
   {v:sys.rangeIncrement,units:sys.rangeUnits,source:"native-weapon"}
  ];
  for(const c of candidates){
   const number=Number(c.v);
   if(c.v===null||c.v===undefined||c.v===""||!finitePositive(number))continue;
   const unit=str(c.units).toLowerCase();
   // Foundry scene units may be used only if the source explicitly says scene.
   if(["ft","feet","foot","pieds"].includes(unit))
    return {value:number,unit:"ft",source:c.source};
   if(["m","meter","meters","mètre","mètres"].includes(unit))
    return {value:number,unit:"m",source:c.source};
   if(["scene","grid","distance"].includes(unit))
    return {value:number,unit:"scene",source:c.source};
   // PF1's standard weapon range value is in feet, but custom world
   // data can be metric: do not silently assume its unit.
  }
  return null;
 }
 function limits(weapon,category){
  const defaults=category==="early"?{touch:1,max:5}:{touch:5,max:10};
  const touch=fromFlag(weapon,"touchIncrements");
  const max=fromFlag(weapon,"maxIncrements");
  const contact=touch==null?defaults.touch:Number(touch);
  const maximum=max==null?defaults.max:Number(max);
  if(!integer(contact)||!integer(maximum)||contact>maximum)
   return null;
  return {touch:contact,max:maximum};
 }
 function getWeaponProfile(weapon,action=null){
  const cls=classify(weapon);
  if(cls.status!=="ok")return cls;
  const range=rangeInfo(weapon,action);
  const limit=limits(weapon,cls.category);
  if(!limit)return {status:"unknown",category:cls.category,
   reason:"invalid maximum/touch increment configuration"};
  return {status:range?"ok":"unknown",category:cls.category,
   classificationSource:cls.source,range,contactIncrements:limit.touch,
   maxIncrements:limit.max,reason:range?null:"native increment or units unavailable"};
 }
 function distanceMeters(value,units,sceneUnits){
  if(typeof value!=="number"||!Number.isFinite(value)||value<0)return null;
  let u=str(units).toLowerCase();
  if(u==="scene")u=str(sceneUnits).toLowerCase();
  if(["m","meter","meters","mètre","mètres"].includes(u))return value;
  if(["ft","feet","foot","pieds"].includes(u))return value*0.3;
  return null;
 }
 function identity(context){
  const actorUuid=str(context?.actorUuid??context?.actor?.uuid);
  const itemUuid=str(context?.itemUuid??context?.weapon?.uuid??context?.item?.uuid);
  const actionId=str(context?.actionId??context?.action?.id);
  const attackId=str(context?.attackId);
  if(!actorUuid||!itemUuid||!actionId||!attackId)return null;
  return [actorUuid,itemUuid,actionId,attackId].join("|");
 }
 function clean(){
  const stamp=now();
  for(const [key,x] of overrides)
   if(stamp-x.createdAt>MAX_OVERRIDE_AGE)overrides.delete(key);
 }
 function setAttackOverride(context){
  clean();
  const key=identity(context);
  if(!key)throw Error("Exact actorUuid, itemUuid, actionId and attackId required");
  if(context.defense!=="touch"&&context.defense!=="normal")
   throw Error("Invalid defense override");
  if(context.validated!==true)throw Error("Override requires validated=true after ability costs and conditions");
  if(overrides.has(key))throw Error("Attack override already registered");
  overrides.set(key,{defense:context.defense,reason:str(context.reason)||"external-script",
   createdAt:now()});
  return true;
 }
 function cancelAttackOverride(context){const key=identity(context);return key?overrides.delete(key):false}
 function resolveForAttack(context){
  clean();
  const weapon=context?.weapon??context?.item;
  const action=context?.action;
  const profile=getWeaponProfile(weapon,action);
  const base={provider:namespace,weaponUuid:weapon?.uuid??null,
   actorUuid:context?.actorUuid??context?.actor?.uuid??null,
   actionId:context?.actionId??action?.id??null,
   attackId:context?.attackId??null,attackIndex:context?.attackIndex??null,
   category:profile.category??null,classificationSource:profile.classificationSource??null};
  if(profile.status==="not-firearm"){last={...base,status:"not-firearm",reason:profile.reason};return null}
  if(profile.status!=="ok"){
   last={...base,status:"unresolved",reason:profile.reason};return {...last};
  }
  if(action?.hasAttack!==true||action?.actionType!=="rwak"){
   last={...base,status:"not-firearm",reason:"action is not a ranged weapon attack"};return null;
  }
  if(context?.scatter===true||action?.scatter===true){
   last={...base,status:"unresolved",reason:"scatter requires per-target distance and grouped attacks"};
   return {...last};
  }
  const dist=distanceMeters(context?.distance,context?.distanceUnits,context?.sceneUnits);
  const unit=profile.range.unit==="scene"?"scene":profile.range.unit;
  const inc=distanceMeters(profile.range.value,unit,context?.sceneUnits);
  if(dist===null||inc===null||inc<=0){
   last={...base,status:"unresolved",reason:"measured distance or units unavailable",
    distance:context?.distance??null,rangeIncrement:profile.range};
   return {...last};
  }
  const ratio=dist/inc,epsilon=1e-8;
  const increment=Math.max(1,Math.ceil(ratio-epsilon));
  const partial={...base,status:"ok",distance:context.distance,
   distanceUnits:context.distanceUnits??null,increment,
   rangeIncrement:profile.range,contactIncrements:profile.contactIncrements,
   maxIncrements:profile.maxIncrements};
  if(increment>profile.maxIncrements){
   last={...partial,status:"out-of-range",type:null,reason:"beyond-maximum-range"};
   return {...last};
  }
  const preparedSpecial=preparedFor(context);
  const key=identity(context);
  const legacySpecial=key?overrides.get(key):null;
  if(legacySpecial&&context?.consumeOverride!==false)overrides.delete(key);
  const special=preparedSpecial??legacySpecial;
  const type=special?.defense??(increment<=profile.contactIncrements?"touch":"normal");
  const reason=special?.reason??(profile.category==="early"?
   (type==="touch"?"early-firearm-first-increment":"early-firearm-beyond-first-increment"):
   (type==="touch"?"advanced-firearm-first-five-increments":"advanced-firearm-beyond-fifth-increment"));
  last={...partial,type,reason,overrideApplied:!!special,
   overrideSource:preparedSpecial?"actionUse":legacySpecial?"legacy-id":null};
  return {...last};
 }
 const lastDiagnostic=()=>last?{...last}:null;
 return Object.freeze({getWeaponProfile,resolveForAttack,lastDiagnostic,
  prepareAttackOverride,cancelPreparedAttackOverride,prepareForCurrentUse,
  captureNativeActionUse,releaseNativeActionUse,findCurrentActionUse,
  bindActionUseMessage,finishResolvedAttack,
  lastPreparedDiagnostic:()=>preparedDiagnostic?{...preparedDiagnostic}:null,
  pendingPreparedOverrides:()=>{prunePrepared();return [...activePrepared].reduce((n,e)=>n+e.entries.size,0)},
  clearAllPrepared:()=>{for(const e of [...activePrepared])dropPrepared(e,"shutdown");currentUses.clear()},
  setAttackOverride,cancelAttackOverride,pendingOverrides:()=>{clean();return overrides.size},
  integrationStatus:()=>({available:typeof game!=="undefined"&&
   !!game.modules?.get?.("pf1-automation-engine")?.api?.attackResolution?.registerDefenseProvider,
   reason:"Requires published PF1AE v1.25+ attackResolution provider and native range measurement"})});
}

/**
 * Adapter for the REAL PF1AE v1.25.0 public contract:
 * registerDefenseProvider({id,priority,resolve(context)}).
 * Uses PF1AE range.measure() (occupied token cells) and range.convert()
 * (table scale: 5 ft = 1.5 m). No second range penalty is ever applied.
 */
export function createPF1AEDefenseProvider({defense,gameRef,canvasRef,fromUuidRef}={}){
 const providerId="pf1-firearms-and-reload";
 return Object.freeze({
  id:providerId,priority:100,
  async resolve(context){
   const weapon=context?.item??context?.action?.item??context?.actionUse?.item;
   const action=context?.action??context?.actionUse?.action;
   if(weapon?.type!=="weapon"||!action||action.hasAttack!==true||
      action.actionType!=="rwak")return null;
   const profile=defense.getWeaponProfile(weapon,action);
   if(profile.status==="not-firearm")return null;
   // Unknown ranged weapons (bows, slings, custom throwing weapons) must
   // remain entirely outside PF1FR. Only an identifiable firearm can
   // request a manual ruling because its firearm-specific data are missing.
   if(profile.status==="unknown"&&!profile.category){
    const nativeType=String(weapon.system?.weaponType??"").toLowerCase();
    const recognized=/(?:pistol|pistolet|musket|mousquet|blunderbuss|tromblon|arquebus|revolver|rifle|shotgun)/i
     .test(String(weapon.name??""));
    const explicit=weapon.getFlag?.("pf1-firearms-and-reload","firearmCategory");
    if(nativeType!=="firearm"&&nativeType!=="gun"&&!recognized&&!explicit)
     return null;
   }
   if(profile.status!=="ok")return {
    type:"manual",reason:"PF1FR: "+(profile.reason??"unknown firearm profile")};
   const module=gameRef?.modules?.get?.("pf1-automation-engine");
   const rangeApi=module?.active?module.api?.range:null;
   const scene=canvasRef?.scene,grid=canvasRef?.grid;
   if(!rangeApi?.measure||!rangeApi?.convert||!scene||!grid)return {
    type:"manual",reason:"PF1FR: native PF1AE range measurement unavailable"};
   const target=context?.targetToken;
   const tokenUuid=context?.attackerToken;
   let origin=null;
   if(tokenUuid&&typeof fromUuidRef==="function"){
    try{origin=await fromUuidRef(tokenUuid)}catch(_){}
   }
   // If the Actor has exactly one token on the displayed scene, it is
   // unambiguous even when the hook omitted attackerToken.
   if(!origin){
    const tokens=context?.actor?.getActiveTokens?.()??[];
    if(tokens.length===1)origin=tokens[0];
   }
   if(!origin||!target)return {
    type:"manual",reason:"PF1FR: attacker or target token not uniquely available"};
   const tokenScene=token=>(token?.document??token)?.parent?.id??
    token?.scene?.id??null;
   if(tokenScene(origin)!==scene.id||tokenScene(target)!==scene.id)return {
    type:"manual",reason:"PF1FR: tokens are not on the measured scene"};
   const raw=rangeApi.measure(origin,target,grid);
   if(typeof raw!=="number"||!Number.isFinite(raw)||raw<0)return {
    type:"manual",reason:"PF1FR: occupied-cell distance unavailable"};
   const unit=String(scene.grid?.units??"").toLowerCase();
   const sceneUnit=["m","meter","meters","metre","metres","mètre","mètres"]
    .includes(unit)?"m":["ft","feet","foot","pied","pieds"]
    .includes(unit)?"ft":null;
   const destination=profile.range.unit==="scene"?sceneUnit:profile.range.unit;
   const measured=sceneUnit&&destination?
    rangeApi.convert(raw,sceneUnit,destination):null;
   if(typeof measured!=="number"||!Number.isFinite(measured)||measured<0)
    return {type:"manual",reason:"PF1FR: PF1AE range unit conversion unavailable"};
   const result=defense.resolveForAttack({
    actor:context.actor,weapon,action,actionUse:context.actionUse,
    actorUuid:context.actor?.uuid,itemUuid:weapon.uuid,
    actionId:action.id,attackIndex:context.attackIndex,
    // Legacy message-bound IDs remain optional; ActionUse overrides do not
    // need an ID before PF1 creates a chat message.
    attackId:context.sourceMessageId&&Number.isSafeInteger(context.attackIndex)
     ?context.sourceMessageId+":"+context.attackIndex:null,
    distance:measured,distanceUnits:destination,sceneUnits:sceneUnit,
    scatter:action.scatter===true
   });
   if(!result||result.status==="not-firearm")return null;
   if(result.status!=="ok")return {type:"manual",
    reason:"PF1FR: "+(result.reason??result.status)};
   return {type:result.type,reason:result.reason};
  }
 });
}
