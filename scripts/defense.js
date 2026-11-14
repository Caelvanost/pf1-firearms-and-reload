/**
 * PF1 Firearms & Reload — independent firearm defense selection engine.
 * Foundry 13 / PF1 11.11. NEVER rolls attacks, computes attack penalties,
 * compares AC, or alters native PF1 ItemAction.touch.
 */
export function createFirearmDefenseAPI({namespace="pf1-firearms-and-reload",now=()=>Date.now()}={}){
 const overrides=new Map();
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
  overrides.set(key,{defense:context.defense,reason:str(context.reason)||"special-ability",
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
  const key=identity(context);
  const special=key?overrides.get(key):null;
  if(special&&context?.consumeOverride!==false)overrides.delete(key);
  const type=special?.defense??(increment<=profile.contactIncrements?"touch":"normal");
  const reason=special?.reason??(profile.category==="early"?
   (type==="touch"?"early-firearm-first-increment":"early-firearm-beyond-first-increment"):
   (type==="touch"?"advanced-firearm-first-five-increments":"advanced-firearm-beyond-fifth-increment"));
  last={...partial,type,reason,overrideApplied:!!special};
  return {...last};
 }
 const lastDiagnostic=()=>last?{...last}:null;
 return Object.freeze({getWeaponProfile,resolveForAttack,lastDiagnostic,
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
   const sceneUnit=scene.grid?.units;
   const result=defense.resolveForAttack({
    actor:context.actor,weapon,action,
    actorUuid:context.actor?.uuid,itemUuid:weapon.uuid,
    actionId:action.id,attackIndex:context.attackIndex,
    // Attack IDs cannot be guessed: use the real message + native index,
    // only when BOTH are supplied. Prevents a Deadeye override leak.
    attackId:context.sourceMessageId&&Number.isSafeInteger(context.attackIndex)
     ?context.sourceMessageId+":"+context.attackIndex:null,
    distance:raw,distanceUnits:sceneUnit,sceneUnits:sceneUnit,
    scatter:action.scatter===true
   });
   if(!result||result.status==="not-firearm")return null;
   if(result.status!=="ok")return {type:"manual",
    reason:"PF1FR: "+(result.reason??result.status)};
   return {type:result.type,reason:result.reason};
  }
 });
}
