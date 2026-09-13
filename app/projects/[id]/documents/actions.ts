"use server";

import { and, eq, inArray, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { documents, documentSigners, invoices, memberships } from "@/lib/db/schema";
import { eventInsert } from "@/lib/events";
import { DOCUMENT_KIND_LABEL, formatDate, formatMoney } from "@/lib/format";
import { notifyLater, portalLink, staffRecipients } from "@/lib/notify";
import { canSign, normalizeEmail } from "@/lib/permissions";
import { projectForAction, requestFingerprint } from "@/lib/project-access";
import { buildSignedPdf, CONSENT_TEXT } from "@/lib/signing";
import { projectPrefix, putPrivate, readPrivateBytes, sha256, statPrivate } from "@/lib/storage";

export type ActionResult = { ok: boolean; message: string };

const KINDS = Object.keys(DOCUMENT_KIND_LABEL) as [keyof typeof DOCUMENT_KIND_LABEL, ...(keyof typeof DOCUMENT_KIND_LABEL)[]];

/** SKOX uploads a PDF and sends it to the chosen people for signature. */
export async function sendDocument(formData: FormData): Promise<ActionResult> {
  const ctx = await projectForAction(formData.get("projectId"));
  if (!ctx.ok) return ctx;
  if (!ctx.access.isStaff) return { ok: false, message: "Only SKOX can send documents." };
  const { project, client, viewer } = ctx;

  const parsed = z
    .object({
      pathname: z.string().min(1),
      fileName: z.string().min(1).max(200),
      title: z.string().trim().min(1).max(160),
      kind: z.enum(KINDS),
      message: z.string().trim().max(2000),
      signers: z.array(z.email()).min(1).max(10),
    })
    .safeParse({
      pathname: formData.get("pathname"),
      fileName: formData.get("fileName"),
      title: formData.get("title"),
      kind: formData.get("kind"),
      message: formData.get("message") ?? "",
      signers: formData.getAll("signers").map((s) => normalizeEmail(String(s))),
    });
  if (!parsed.success) return { ok: false, message: "Add a title and choose at least one signer." };
  const input = parsed.data;

  if (!input.pathname.startsWith(`${projectPrefix(project.id)}document/`)) {
    return { ok: false, message: "That upload doesn't belong to this project." };
  }
  const stat = await statPrivate(input.pathname);
  if (!stat || stat.contentType !== "application/pdf") return { ok: false, message: "Upload a PDF." };

  // Signers must be people with access to this project (client people or SKOX).
  const allowed = await getDb()
    .select({ email: memberships.email })
    .from(memberships)
    .where(and(eq(memberships.workspaceId, project.workspaceId), inArray(memberships.email, input.signers)));
  const allowedEmails = new Set(allowed.map((a) => a.email));
  if (input.signers.some((s) => !allowedEmails.has(s))) {
    return { ok: false, message: "Every signer needs access to the portal first. Invite them on the client page." };
  }

  const bytes = await readPrivateBytes(input.pathname);
  if (!bytes) return { ok: false, message: "The upload couldn't be read. Try again." };
  const hash = sha256(bytes);

  const db = getDb();
  const id = crypto.randomUUID();
  const signers = [...new Set(input.signers)];
  await db.batch([
    db.insert(documents).values({
      id,
      workspaceId: project.workspaceId,
      projectId: project.id,
      title: input.title,
      kind: input.kind,
      message: input.message || null,
      storageKey: stat.pathname,
      fileName: input.fileName,
      sha256: hash,
      createdBy: viewer.userId,
    }),
    db.insert(documentSigners).values(
      signers.map((email) => ({ workspaceId: project.workspaceId, documentId: id, email })),
    ),
    eventInsert({
      workspaceId: project.workspaceId,
      projectId: project.id,
      actorId: viewer.userId,
      verb: "document.sent",
      subjectType: "document",
      subjectId: id,
      payload: { title: input.title, signers },
    }),
  ]);

  notifyLater(() => signers.filter((s) => s !== viewer.email), {
    subject: `Please sign: ${input.title}`,
    preheader: `${client.name} · ${DOCUMENT_KIND_LABEL[input.kind]} ready for your signature`,
    heading: `${input.title} is ready for your signature`,
    paragraphs: [
      input.message || `SKOX sent a ${DOCUMENT_KIND_LABEL[input.kind].toLowerCase()} for ${project.name}.`,
      "Open it in your portal, read it through, and sign in under a minute. No printing, no scanning.",
    ],
    cta: { label: "Review and sign", href: portalLink(`/projects/${project.id}/documents/${id}`) },
  });

  revalidatePath(`/projects/${project.id}/documents`);
  return { ok: true, message: `Sent to ${signers.length} ${signers.length === 1 ? "person" : "people"}.` };
}

export type SignState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "signed"; complete: boolean; next?: { label: string; href: string } };

/** A named signer signs. Completes the document when the last signature lands. */
export async function signDocument(_prev: SignState, formData: FormData): Promise<SignState> {
  const documentId = String(formData.get("documentId") ?? "");
  if (!z.uuid().safeParse(documentId).success) return { status: "error", message: "Unknown document." };
  const db = getDb();
  const [doc] = await db.select().from(documents).where(eq(documents.id, documentId)).limit(1);
  if (!doc) return { status: "error", message: "Unknown document." };

  const ctx = await projectForAction(doc.projectId);
  if (!ctx.ok) return { status: "error", message: ctx.message };
  const { viewer, project, client } = ctx;

  const signers = await db.select().from(documentSigners).where(eq(documentSigners.documentId, doc.id));
  const mine = signers.find((s) => s.email === viewer.email);
  if (!canSign(viewer.email, doc, mine)) {
    return { status: "error", message: "This document isn't waiting for your signature." };
  }

  const typedName = String(formData.get("typedName") ?? "").trim().replace(/\s+/g, " ");
  if (typedName.length < 2 || typedName.length > 120) {
    return { status: "error", message: "Type your full name to sign." };
  }
  if (formData.get("consent") !== "on") {
    return { status: "error", message: "Tick the box to agree to sign electronically." };
  }

  // The file must still be exactly what was sent.
  const bytes = await readPrivateBytes(doc.storageKey);
  if (!bytes || sha256(bytes) !== doc.sha256) {
    return { status: "error", message: "This document changed after it was sent, so it can't be signed. SKOX has been told." };
  }

  const { ip, userAgent } = await requestFingerprint();
  const signedAt = new Date();
  const updated = await db
    .update(documentSigners)
    .set({
      status: "signed",
      typedName,
      ip,
      userAgent,
      userId: viewer.userId,
      signedAt,
      signedSha256: doc.sha256,
      viewedAt: mine!.viewedAt ?? signedAt,
    })
    .where(and(eq(documentSigners.id, mine!.id), ne(documentSigners.status, "signed")))
    .returning({ id: documentSigners.id });
  if (updated.length === 0) return { status: "signed", complete: false };

  await eventInsert({
    workspaceId: doc.workspaceId,
    projectId: doc.projectId,
    actorId: viewer.userId,
    verb: "document.signed",
    subjectType: "document",
    subjectId: doc.id,
    payload: { title: doc.title, email: viewer.email, consent: CONSENT_TEXT },
  });

  const fresh = await db.select().from(documentSigners).where(eq(documentSigners.documentId, doc.id));
  const complete = fresh.every((s) => s.status === "signed");

  if (complete) {
    const completedAt = new Date();
    const signedPdf = await buildSignedPdf({
      original: bytes,
      documentId: doc.id,
      title: doc.title,
      originalSha256: doc.sha256,
      projectName: project.name,
      clientName: client.name,
      completedAt,
      signatures: fresh.map((s) => ({
        email: s.email,
        typedName: s.typedName ?? s.email,
        signedAt: s.signedAt ?? completedAt,
        ip: s.ip,
        userAgent: s.userAgent,
        viewedAt: s.viewedAt,
      })),
    });
    const stored = await putPrivate(
      `${projectPrefix(project.id)}signed/${doc.fileName.replace(/\.pdf$/i, "")}-signed.pdf`,
      signedPdf,
      "application/pdf",
    );
    await db.batch([
      db
        .update(documents)
        .set({ status: "completed", completedAt, signedStorageKey: stored.pathname, signedSha256: sha256(signedPdf) })
        .where(eq(documents.id, doc.id)),
      eventInsert({
        workspaceId: doc.workspaceId,
        projectId: doc.projectId,
        actorId: viewer.userId,
        verb: "document.completed",
        subjectType: "document",
        subjectId: doc.id,
        payload: { title: doc.title },
      }),
    ]);

    const link = portalLink(`/projects/${project.id}/documents/${doc.id}`);
    const [deposit] = await db
      .select()
      .from(invoices)
      .where(and(eq(invoices.documentId, doc.id), eq(invoices.status, "open")))
      .limit(1);
    notifyLater(async () => [...fresh.map((s) => s.email), ...(await staffRecipients(doc.workspaceId))], {
      subject: `Signed: ${doc.title}`,
      preheader: deposit
        ? `Next step: the ${formatMoney(deposit.amountCents, deposit.currency)} deposit, then we start building.`
        : "Everyone has signed. Your copy with the signature certificate is in the portal.",
      heading: `${doc.title} is fully signed`,
      paragraphs: [
        `Everyone has signed ${doc.title} for ${project.name}.`,
        deposit
          ? `One step left: invoice ${deposit.number} for ${formatMoney(deposit.amountCents, deposit.currency)} is now ready to pay. As soon as it's in, we start building.`
          : "Download the signed copy, with its signature certificate, any time from your portal.",
      ],
      cta: deposit
        ? { label: "Pay the deposit", href: portalLink(`/projects/${project.id}/billing`) }
        : { label: "Get the signed copy", href: link },
      footnote: deposit ? `Due ${formatDate(deposit.dueOn)}` : undefined,
    });
    revalidatePath(`/projects/${project.id}/billing`);
    revalidatePath(`/projects/${project.id}/documents`);
    revalidatePath(`/projects/${project.id}`);
    return {
      status: "signed",
      complete: true,
      next: deposit ? { label: `Pay the deposit (${formatMoney(deposit.amountCents, deposit.currency)})`, href: `/projects/${project.id}/billing` } : undefined,
    };
  } else {
    notifyLater(() => staffRecipients(doc.workspaceId), {
      subject: `${typedName} signed ${doc.title}`,
      preheader: `${fresh.filter((s) => s.status !== "signed").length} signature(s) still to go`,
      heading: `${typedName} signed`,
      paragraphs: [`${typedName} (${viewer.email}) signed ${doc.title} for ${client.name}. Waiting on the others.`],
      cta: { label: "See the document", href: portalLink(`/projects/${project.id}/documents/${doc.id}`) },
    });
  }

  revalidatePath(`/projects/${project.id}/documents`);
  revalidatePath(`/projects/${project.id}/documents/${doc.id}`);
  revalidatePath(`/projects/${project.id}`);
  return { status: "signed", complete };
}

async function staffDocument(formData: FormData) {
  const documentId = String(formData.get("documentId") ?? "");
  if (!z.uuid().safeParse(documentId).success) return null;
  const [doc] = await getDb().select().from(documents).where(eq(documents.id, documentId)).limit(1);
  if (!doc) return null;
  const ctx = await projectForAction(doc.projectId);
  if (!ctx.ok || !ctx.access.isStaff) return null;
  return { doc, ctx };
}

export async function voidDocument(formData: FormData) {
  const found = await staffDocument(formData);
  if (!found || found.doc.status !== "out_for_signature") return;
  const { doc, ctx } = found;
  await getDb().batch([
    getDb().update(documents).set({ status: "void", voidedAt: new Date() }).where(eq(documents.id, doc.id)),
    eventInsert({
      workspaceId: doc.workspaceId,
      projectId: doc.projectId,
      actorId: ctx.viewer.userId,
      verb: "document.voided",
      subjectType: "document",
      subjectId: doc.id,
      payload: { title: doc.title },
    }),
  ]);
  revalidatePath(`/projects/${doc.projectId}/documents`);
  revalidatePath(`/projects/${doc.projectId}/documents/${doc.id}`);
}

export async function remindSigners(formData: FormData) {
  const found = await staffDocument(formData);
  if (!found || found.doc.status !== "out_for_signature") return;
  const { doc, ctx } = found;
  const db = getDb();
  const pending = await db
    .select()
    .from(documentSigners)
    .where(and(eq(documentSigners.documentId, doc.id), ne(documentSigners.status, "signed")));
  if (pending.length === 0) return;
  await db
    .update(documentSigners)
    .set({ lastRemindedAt: new Date() })
    .where(inArray(documentSigners.id, pending.map((p) => p.id)));
  notifyLater(() => pending.map((p) => p.email), {
    subject: `Reminder: please sign ${doc.title}`,
    preheader: "It takes under a minute in your portal.",
    heading: `${doc.title} is still waiting for your signature`,
    paragraphs: [`A quick nudge: ${doc.title} for ${ctx.project.name} is ready to sign. It takes under a minute.`],
    cta: { label: "Review and sign", href: portalLink(`/projects/${doc.projectId}/documents/${doc.id}`) },
  });
  revalidatePath(`/projects/${doc.projectId}/documents/${doc.id}`);
}
