/**
 * The sales funnel for a period: how many deals entered each stage, what
 * they're worth and how many went on to the next. Pure, so it can be tested
 * alone; lib/finance-data.ts reads the stage moves from the audit trail.
 */

export const FUNNEL_STAGES = ["lead", "initial_outreach", "proposal_sent", "negotiation", "won"] as const;
export type FunnelStage = (typeof FUNNEL_STAGES)[number];

export type StageEntry = { dealId: string; stage: string; valueCents: number | null };
export type FunnelRow = { stage: FunnelStage; count: number; valueCents: number; conversion: number | null };

/**
 * Counts each deal once per stage it entered, however often it bounced in
 * and out. `conversion` is the next stage's count over this one's (null for
 * Won, or when nobody entered this stage).
 */
export function funnelRows(entries: StageEntry[]): FunnelRow[] {
  const seen = new Map<FunnelStage, Map<string, number>>(FUNNEL_STAGES.map((s) => [s, new Map()]));
  for (const e of entries) {
    const bucket = seen.get(e.stage as FunnelStage);
    if (bucket && !bucket.has(e.dealId)) bucket.set(e.dealId, e.valueCents ?? 0);
  }
  const rows = FUNNEL_STAGES.map((stage) => {
    const deals = seen.get(stage)!;
    return { stage, count: deals.size, valueCents: [...deals.values()].reduce((s, v) => s + v, 0), conversion: null as number | null };
  });
  rows.forEach((r, i) => {
    const next = rows[i + 1];
    r.conversion = next && r.count > 0 ? next.count / r.count : null;
  });
  return rows;
}
