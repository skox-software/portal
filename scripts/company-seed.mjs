// Posts the first cards from the November 2026 strategy to /api/company/runs.
//   PORTAL_URL=https://gounbusy.com/portal COMPANY_SERVICE_SECRET=... node scripts/company-seed.mjs
const base = process.env.PORTAL_URL;
const secret = process.env.COMPANY_SERVICE_SECRET;
if (!base || !secret) throw new Error("Set PORTAL_URL and COMPANY_SERVICE_SECRET.");
const strategy = "https://claude.ai/artifact/GD8NLD7tKVEo9QBVE5WxGn";

const runs = [
  {
    seat: "claude",
    summary: "November strategy written from the masterclass, pipeline check, channels plan and survey-firm list",
    proposals: [
      { kind: "decision", impact: "high", confidence: 85, title: "Approve the 15 strategy decisions", why: "Pat's terms, Tembo's deadline, the floor, the three-jobs offer, $0 ads for 30 days. Each has a default in the doc.", wrongIf: "Pat or Tembo say no to the structure, not just the price.", links: [{ label: "Strategy doc", url: strategy }] },
      { kind: "decision", impact: "medium", confidence: 80, title: "Reiss calls six warm leads this week and logs every call", why: "The pipeline has been idle since Oct 29 and 17 follow-ups are overdue.", body: "Target Surveying, Leading Edge Title, Erickson, Smith Management, Advantage Osborne, Acorn Properties.\nOpener: \"When a new order comes in, who pulls the records for it, and how many a month is that?\"\nHold the 31 Florida surveyor calls until Pat answers the competitor question." },
      { kind: "spend", impact: "medium", confidence: 90, title: "Order a virtual mailbox for cold email", why: "Cold email legally needs a postal address, and the site has none by choice. Survey outreach is blocked until this exists." },
    ],
  },
  {
    seat: "outreach-writer",
    summary: "Drafted the Tembo findings email",
    proposals: [
      { kind: "message", impact: "high", confidence: 75, title: "Send Tembo the findings email", why: "They sent their 1099 SOP asking for automation. January busy season means a decision by Nov 20 or the start moves to May.", wrongIf: "They already rotated the login and handle the threshold change.", body: "Hi [name], I went through your 1099 SOP line by line. Two things to fix before January whether or not we work together: the SOP prints a live Tax1099 login (worth rotating today), and the 1099 threshold changes for tax year 2026; your reviewer should confirm the new figure on IRS.gov. I'd like to show you how the W-9 chase and the QuickBooks sort would run without your team clicking through them. Do you have 30 minutes this week with whoever signs off? January doesn't leave room after mid-November." },
    ],
  },
  {
    seat: "deal-desk",
    summary: "Outlined Pat's founding-client proposal; prices are Josh's",
    proposals: [
      { kind: "proposal", impact: "high", confidence: 65, title: "Pat Ireland: three-option founding proposal", why: "The records collector has run unpaid since Oct 23. Free period ends Nov 30; the running collector is credited against setup.", wrongIf: "The ten-job timing shows less than about 195 office hours a month replaced.", body: "Before sending: time 10 jobs by hand and with the desk, and get Pat's four permissions in writing.\nOption A: records + quote drafts with comps.\nOption B: records only.\nOption C: records, quote drafts and the intake form.\nEach option: a yes/no list of jobs, setup (the collector credited), monthly fee at about 25% of the loaded cost Pat confirms, 12-month term, 90-day out, founding 20% off for naming and timing numbers.\nPrices: Josh fills in." },
    ],
  },
  {
    seat: "prospector",
    summary: "Checked the lead engine against the new target list",
    proposals: [
      { kind: "change", impact: "medium", confidence: 85, title: "Re-aim the nightly engine at desk industries and pause website pushes", why: "It still adds about 21 small-business website leads a night (pizzerias, quilt shops). Desk buyers are 5–50 person surveying, title, property management and CPA firms.", wrongIf: "Reiss closes website work worth more than his desk calls this month." },
    ],
  },
];

for (const run of runs) {
  const res = await fetch(`${base}/api/company/runs`, { method: "POST", headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" }, body: JSON.stringify(run) });
  console.log(run.seat, res.status, await res.text());
}
