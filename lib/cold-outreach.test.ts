import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { leadEmailPayload } from "./lead-email.ts";
import { unsubscribeUrl, verifyUnsubscribeToken } from "./unsubscribe.ts";

function setup(overrides: Record<string,string | undefined> = {}) {
  const recipients = new Map<string,{id:string;email:string;suppressed:boolean}>();
  const sent: ReturnType<typeof leadEmailPayload>[] = [];
  let selected = "";
  const table = {email:"email"};
  const db = {
    insert: () => ({values: (v: {email:string;suppressed?:boolean}) => ({
      onConflictDoNothing: async () => { if (!recipients.has(v.email)) recipients.set(v.email,{id:"4e9de8c6-50f1-47cf-a564-4cafbf382c22",email:v.email,suppressed:!!v.suppressed}); },
      onConflictDoUpdate: async () => { recipients.set(v.email,{id:recipients.get(v.email)?.id ?? "4e9de8c6-50f1-47cf-a564-4cafbf382c22",email:v.email,suppressed:true}); },
    })}),
    select: () => ({from: (t: unknown) => ({where: (w: {value:string}) => {selected=w.value;return {limit: async () => t===table ? [recipients.get(selected)].filter(Boolean):[]};}})}),
    update: () => ({set: () => ({where: async () => {}})}),
  };
  const env = {NODE_ENV:"production",SKOX_POSTAL_ADDRESS:"123 Registered St, Orlando, FL 32801",UNSUBSCRIBE_SECRET:"test-secret",COLD_OUTREACH_ENABLED:"true",OUTREACH_RESEND_API_KEY:"test-outreach",...overrides};
  const mocks: Record<string,unknown> = {
    "drizzle-orm":{eq: (_:unknown,value:string)=>({value}),sql:()=>({})},
    "@/lib/db":{getDb:()=>db},"@/lib/db/schema":{deals:{},outreachRecipients:table},
    "@/lib/lead-email":{leadEmailPayload},"@/lib/unsubscribe":{unsubscribeUrl},
    resend:{Resend:class{emails={send:async(p:ReturnType<typeof leadEmailPayload>)=>{sent.push(p);return {data:{id:"provider"}};}};}},
  };
  const exports = {} as {sendColdOutreach:(x:unknown)=>Promise<unknown>;suppressOutreach:(email:string)=>Promise<void>};
  const source = ts.transpileModule(fs.readFileSync(new URL('./cold-outreach.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
  vm.runInNewContext(source,{exports,Error,process:{env},require:(id:string)=>mocks[id]});
  const send = () => exports.sendColdOutreach({to:" Lead@Example.com ",subject:"Website concept",body:"Our design",idempotencyKey:"test"});
  return {send,sent,recipients,suppress:exports.suppressOutreach};
}

test("missing address, secret, dedicated key, enable switch or production blocks provider",async()=>{
  for (const overrides of [{SKOX_POSTAL_ADDRESS:""},{SKOX_POSTAL_ADDRESS:"   "},{UNSUBSCRIBE_SECRET:""},{OUTREACH_RESEND_API_KEY:""},{COLD_OUTREACH_ENABLED:"false"},{NODE_ENV:"development"}]) {
    const h=setup(overrides);await assert.rejects(h.send);assert.equal(h.sent.length,0);assert.equal(h.recipients.size,0);
  }
});
test("normalized suppression persists independently of any deal and blocks new sends",async()=>{
  const h=setup();await h.suppress(" LEAD@EXAMPLE.COM ");await assert.rejects(h.send,/asked not/);assert.equal(h.sent.length,0);
});
test("gateway sends advertising disclosure, address and stable signed opt-out using outreach identity",async()=>{
  const h=setup();await h.send();const mail=h.sent[0];assert.equal(mail.from,"Reiss Skeen <reiss@outreach.skoxsoftware.com>");assert.match(mail.text,/Advertisement from UnBusy \(formerly SKOX Software\)/);assert.match(mail.html,/123 Registered St/);
  const token=mail.headers['List-Unsubscribe'].slice(1,-1).split('/').pop()!;
  assert.ok(verifyUnsubscribeToken(token,["lead@example.com"],"test-secret"));
  await h.suppress("lead@example.com");await assert.rejects(h.send);assert.equal(h.sent.length,1);
});
