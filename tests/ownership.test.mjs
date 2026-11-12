import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source=fs.readFileSync(new URL("../scripts/reload-core.js",import.meta.url),"utf8")
 .replace(/^import .*\n/gm,"");

test("the new reload engine refuses ownership while unmodified PF1AE is active",()=>{
 const mods=new Map([
  ["pf1-firearms-and-reload",{active:true,api:{}}],
  ["pf1-automation-engine",{active:true,api:{},esmodules:["scripts/reload-core.js"]}]
 ]);
 const context={
  game:{modules:mods},
  Hooks:{once(){}},console,
  Set,WeakMap,WeakSet
 };
 vm.createContext(context);
 vm.runInContext(source,context);
 assert.equal(vm.runInContext("rlAllowed()",context),false,
  "No duplicate manager even if both modules are enabled");
 mods.get("pf1-automation-engine").esmodules=["scripts/reload-adapter.js"];
 assert.equal(vm.runInContext("rlAllowed()",context),true,
  "Only an adapter-only PF1AE manifest unlocks ownership");
 mods.get("pf1-automation-engine").api.reloadDelegated=true;
 mods.get("pf1-automation-engine").esmodules=["scripts/reload-core.js"];
 assert.equal(vm.runInContext("rlAllowed()",context),false,"legacy hooks defeat a forged delegation marker");
 delete mods.get("pf1-automation-engine").api.reloadDelegated;
 mods.get("pf1-automation-engine").active=false;
 assert.equal(vm.runInContext("rlAllowed()",context),true,
  "Standalone PF1FR works without PF1AE");
 mods.get("pf1-firearms-and-reload").active=false;
 assert.equal(vm.runInContext("rlAllowed()",context),false);
});
test("Foundry manifest includes only the new core and migration is imported",()=>{
 const manifest=JSON.parse(fs.readFileSync(new URL("../module.json",import.meta.url),"utf8"));
 assert.equal(manifest.id,"pf1-firearms-and-reload");
 assert.deepEqual(manifest.esmodules,["scripts/reload-core.js"]);
 assert.match(fs.readFileSync(new URL("../scripts/reload-core.js",import.meta.url),"utf8"),
  /import \{ migrateLegacyReload \} from "\.\/migration\.js"/);
});
