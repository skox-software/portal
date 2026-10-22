import { z } from "zod";
import { recordPreviewOpen } from "@/lib/preview-open";
import { deviceLabel } from "@/lib/preview-tracking";
import { allow } from "@/lib/rate-limit";

const body = z.object({ dealId: z.uuid(), device: z.string().max(20).optional() });

/**
 * The preview site's beacon: someone opened a lead's preview. Public on
 * purpose (the page runs on the lead's phone), so it only ever records a view
 * of a deal whose preview was sent, and is throttled per visitor.
 */
export async function POST(request: Request) {
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return new Response(null, { status: 400 });
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!(await allow(`preview-open:${ip}:${parsed.data.dealId}`, 30, 60 * 60 * 1000))) return new Response(null, { status: 429 });
  await recordPreviewOpen(parsed.data.dealId, deviceLabel(parsed.data.device, request.headers.get("user-agent")));
  // The same answer whatever happened, so the endpoint reveals nothing about deals.
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
