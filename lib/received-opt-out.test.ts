import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { parseAddress } from "./inbox.ts";
import { isOptOutReply } from "./reply-opt-out.ts";

function setup(mail: Record<string, unknown>, fail = false) {
  const suppressed: string[] = [];
  const output = {} as {receiveOptOut: (id: string) => Promise<unknown>};
  const source = ts.transpileModule(fs.readFileSync(new URL('./received-opt-out.ts', import.meta.url), 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
  const mocks: Record<string, unknown> = {
    resend: {Resend: class { emails = {receiving: {get: async () => ({data: mail})}}; }},
    '@/lib/inbox': {parseAddress}, '@/lib/reply-opt-out': {isOptOutReply},
    '@/lib/cold-outreach': {suppressOutreach: async (email: string) => { if (fail) throw new Error('database unavailable'); suppressed.push(email); }},
  };
  vm.runInNewContext(source, {exports:output, require:(id: string) => mocks[id], process:{env:{RESEND_API_KEY:'test',OUTREACH_REPLY_COPY_ADDRESS:'optouts@ontoinarer.resend.app'}}});
  return {run:()=>output.receiveOptOut('received-id'),suppressed};
}
const base = {from:'Lead <LEAD@example.com>',to:['optouts@ontoinarer.resend.app'],subject:'Re: Website concept',text:'No thanks'};
test('forwarded replies from either work inbox suppress the original sender', async () => {
  for (const mailbox of ['reiss@skoxsoftware.com','founders@skoxsoftware.com']) {
    const h = setup({...base, to:[mailbox,...base.to]}); await h.run(); assert.deepEqual(h.suppressed,['lead@example.com']);
  }
});
test('HTML-only positive reply ignores the quoted marketing footer', async () => {
  const h=setup({...base,text:null,html:'<div>Looks good!</div><div class="gmail_quote">No thanks or unsubscribe</div>'});await h.run();assert.deepEqual(h.suppressed,[]);
  const opt=setup({...base,text:null,html:'<div>Please don&#8217;t email me</div><blockquote>old message</blockquote>'});await opt.run();assert.deepEqual(opt.suppressed,['lead@example.com']);
});
test('unrelated receiving addresses and internal senders never suppress',async()=>{
  for (const overrides of [{to:['other@ontoinarer.resend.app']},{from:'reiss@skoxsoftware.com'},{from:'josh@outreach.skoxsoftware.com'},{text:'Yes please\n> No thanks or unsubscribe'}]) {
    const h=setup({...base,...overrides});await h.run();assert.deepEqual(h.suppressed,[]);
  }
});
test('failed suppression rejects for webhook retry; replay is safe',async()=>{
  await assert.rejects(setup(base,true).run,/database unavailable/);
  const h=setup(base);await h.run();await h.run();assert.deepEqual(h.suppressed,['lead@example.com','lead@example.com']);
});
