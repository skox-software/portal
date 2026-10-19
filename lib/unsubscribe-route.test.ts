import {test} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import {tokenDealId,unsubscribeToken,verifyUnsubscribeToken} from "./unsubscribe.ts";

test("public GET and POST suppress the stable recipient without loading a deal or requiring send enablement",async()=>{
 const recipient={id:"4e9de8c6-50f1-47cf-a564-4cafbf382c22",email:"old@example.com",suppressed:false};
 const token=unsubscribeToken(recipient.id,recipient.email,"secret");
 const mocks:Record<string,unknown>={
  "drizzle-orm":{eq:()=>({})},
  "@/lib/db":{getDb:()=>({select:()=>({from:()=>({where:()=>({limit:async()=>[recipient]})})})})},
  "@/lib/db/schema":{outreachRecipients:{}},
  "@/lib/cold-outreach":{suppressOutreach:async(email:string)=>{assert.equal(email,recipient.email);recipient.suppressed=true;}},
  "@/lib/unsubscribe":{tokenDealId,verifyUnsubscribeToken},
 };
 const exports={} as Record<string,(r:Request,c:{params:Promise<{token:string}>})=>Promise<Response>>;
 const source=ts.transpileModule(fs.readFileSync(new URL('../app/u/[token]/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
 vm.runInNewContext(source,{exports,Response,process:{env:{UNSUBSCRIBE_SECRET:"secret"}},require:(id:string)=>{assert.ok(id in mocks);return mocks[id];}});
 for(const method of ['GET','POST']){
  recipient.suppressed=false;
  const result=await exports[method](new Request('https://example.com'),{params:Promise.resolve({token})});
  assert.equal(result.status,200);assert.equal(recipient.suppressed,true);
 }
 recipient.suppressed=false;
 assert.equal((await exports.POST(new Request('https://example.com'),{params:Promise.resolve({token:token+'tampered'})})).status,404);
 assert.equal(recipient.suppressed,false);
});
