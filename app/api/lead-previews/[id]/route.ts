import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { deals } from "@/lib/db/schema";
import { eventInsert } from "@/lib/events";
import { PREVIEW_SERVICE_ACTOR, previewServiceAuthorized, SERVICE_STATUSES, serviceTransition } from "@/lib/preview-service";

const update = z
  .object({
    status: z.enum(SERVICE_STATUSES).optional(),
    url: z.union([z.url({ protocol: /^https$/ }).max(500), z.null()]).optional(),
    brief: z.union([z.string().trim().min(1).max(20_000), z.null()]).optional(),
    sentAt: z.union([z.iso.datetime({ offset: true }), z.null()]).optional(),
    firstOpenAt: z.iso.datetime({ offset: true }).optional(),
  })
  .strict()
  .refine((u) => Object.keys(u).length > 0, "Send at least one field.");

/**
 * The builder reports progress on a deal's preview: status, link, research
 * brief, when it was sent and first opened. Only the first open is kept.
 * Every change lands in the deal's history.
 */
export async function PATCH(request: Request, ctx: RouteContext<"/api/lead-previews/[id]">) {
  if (!previewServiceAuthorized(request)) return new Response("Unauthorized", { status: 401 });
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return Response.json({ error: "Unknown deal." }, { status: 404 });
  const body = update.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: body.error.issues[0]?.message ?? "Invalid update." }, { status: 400 });
  const input = body.data;

  const db = getDb();
  const [deal] = await db.select().from(deals).where(eq(deals.id, id)).limit(1);
  if (!deal) return Response.json({ error: "Unknown deal." }, { status: 404 });
  const next = serviceTransition(deal.previewStatus, deal.previewDecision, input);
  if (!next.ok) return Response.json({ error: next.error }, { status: 409 });

  const firstOpen = input.firstOpenAt && !deal.previewFirstOpenAt ? new Date(input.firstOpenAt) : undefined;
  const changes = {
    ...(next.status !== deal.previewStatus ? { previewStatus: next.status } : {}),
    ...(input.url !== undefined ? { previewUrl: input.url } : {}),
    ...(input.brief !== undefined ? { previewBrief: input.brief } : {}),
    ...(input.sentAt !== undefined ? { previewSentAt: input.sentAt ? new Date(input.sentAt) : null } : {}),
    ...(firstOpen ? { previewFirstOpenAt: firstOpen } : {}),
  };
  if (!Object.keys(changes).length) return Response.json({ ok: true, changed: false, status: deal.previewStatus });

  // Only if nobody changed the status in between (a Gate A tap, another update).
  const rows = await db
    .update(deals)
    .set(changes)
    .where(and(eq(deals.id, deal.id), eq(deals.previewStatus, deal.previewStatus)))
    .returning({ id: deals.id });
  if (!rows.length) return Response.json({ error: "The preview changed in the meantime. Read the queue again." }, { status: 409 });
  await eventInsert({
    workspaceId: deal.workspaceId,
    projectId: deal.projectId,
    actorId: PREVIEW_SERVICE_ACTOR,
    verb: "deal.preview_updated",
    subjectType: "deal",
    subjectId: deal.id,
    payload: {
      company: deal.company,
      from: deal.previewStatus,
      to: next.status,
      ...(input.url !== undefined ? { url: input.url } : {}),
      ...(input.brief !== undefined ? { brief: input.brief ? "updated" : "cleared" } : {}),
      ...(input.sentAt ? { sentAt: input.sentAt } : {}),
      ...(firstOpen ? { firstOpenAt: firstOpen.toISOString() } : {}),
    },
  });
  revalidatePath("/admin/leads");
  revalidatePath("/admin/pipeline");
  return Response.json({ ok: true, changed: true, status: next.status });
}
