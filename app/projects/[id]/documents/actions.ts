"use server";

import { and, eq, inArray, ne, or, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { clients, documents, documentSigners, invoices, memberships, projects } from "@/lib/db/schema";
import { eventInsert } from "@/lib/events";
import { DOCUMENT_KIND_LABEL, formatDate, formatMoney } from "@/lib/format";
import { notifyLater, portalLink, staffRecipients } from "@/lib/notify";
import { canSign, normalizeEmail } from "@/lib/permissions";
import { projectForAction, requestFingerprint } from "@/lib/project-access";
import { buildSignedPdf, CONSENT_TEXT } from "@/lib/signing";
import { projectPrefix, putPrivate, readPrivateBytes, sha256, statPrivate } from "@/lib/storage";
import { staffRow } from "@/lib/staff-filter";

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
    .where(
      and(
        eq(memberships.workspaceId, project.workspaceId),
        inArray(memberships.email, input.signers),
        // This project's client, or SKOX staff: people from another client could never open it.
        or(eq(memberships.clientId, project.clientId), staffRow()),
      ),
    );
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

  // During onboarding the welcome email introduces the agreement, so the
  // client gets one clear email instead of two competing ones.
  const silent = formData.get("silent") === "1";
  if (!silent) notifyLater(() => signers.filter((s) => s !== viewer.email), {
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
  // Identity comes from the address SKOX invited (the membership), never from
  // the account's current email, which a user might be able to change.
  const invitedAs = new Set(viewer.memberships.filter((m) => m.workspaceId === doc.workspaceId).map((m) => m.email));
  const mine = signers.find((s) => invitedAs.has(s.email));
  if (!mine || !canSign(mine.email, doc, mine)) {
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
    .where(
      and(
        eq(documentSigners.id, mine!.id),
        ne(documentSigners.status, "signed"),
        // Still out for signature at the moment of signing (not cancelled meanwhile).
        sql`exists (select 1 from ${documents} where ${documents.id} = ${doc.id} and ${documents.status} = 'out_for_signature')`,
      ),
    )
    .returning({ id: documentSigners.id });
  if (updated.length === 0) {
    const [now] = await db.select({ status: documents.status }).from(documents).where(eq(documents.id, doc.id)).limit(1);
    if (now?.status === "void") return { status: "error", message: "SKOX cancelled this document, so there's nothing to sign." };
    // Already signed: if an earlier finish was interrupted, complete it now.
    const result = now?.status === "out_for_signature" ? await finalizeDocument(doc.id, viewer.userId) : null;
    return { status: "signed", complete: Boolean(result), next: result?.next };
  }

  await eventInsert({
    workspaceId: doc.workspaceId,
    projectId: doc.projectId,
    actorId: viewer.userId,
    verb: "document.signed",
    subjectType: "document",
    subjectId: doc.id,
    payload: { title: doc.title, email: viewer.email, consent: CONSENT_TEXT },
  });

  const result = await finalizeDocument(doc.id, viewer.userId);
  const complete = Boolean(result);

  if (result) {
    revalidatePath(`/projects/${project.id}/documents/${doc.id}`);
    return { status: "signed", complete: true, next: result.next };
  } else {
    const fresh = await db.select().from(documentSigners).where(eq(documentSigners.documentId, doc.id));
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

/**
 * Completes a document once every signer has signed. Safe to call repeatedly
 * and concurrently: only the caller that claims the out_for_signature →
 * completed transition builds the certificate and sends email. If building or
 * storing the signed copy fails, the claim is released so a retry can finish it.
 */
async function finalizeDocument(documentId: string, actorId: string) {
  const db = getDb();
  const [claimed] = await db
    .update(documents)
    .set({ status: "completed", completedAt: new Date() })
    .where(
      and(
        eq(documents.id, documentId),
        eq(documents.status, "out_for_signature"),
        sql`not exists (select 1 from ${documentSigners} where ${documentSigners.documentId} = ${documentId} and ${documentSigners.status} <> 'signed')`,
      ),
    )
    .returning();
  if (!claimed) return null;
  const doc = claimed;
  const completedAt = doc.completedAt ?? new Date();

  const [row] = await db
    .select({ project: projects, client: clients })
    .from(projects)
    .innerJoin(clients, eq(clients.id, projects.clientId))
    .where(eq(projects.id, doc.projectId))
    .limit(1);
  const signers = await db.select().from(documentSigners).where(eq(documentSigners.documentId, doc.id));

  try {
    const original = await readPrivateBytes(doc.storageKey);
    if (!original || !row) throw new Error("original document or project missing");
    const signedPdf = await buildSignedPdf({
      original,
      documentId: doc.id,
      title: doc.title,
      originalSha256: doc.sha256,
      projectName: row.project.name,
      clientName: row.client.name,
      completedAt,
      signatures: signers.map((s) => ({
        email: s.email,
        typedName: s.typedName ?? s.email,
        signedAt: s.signedAt ?? completedAt,
        ip: s.ip,
        userAgent: s.userAgent,
        viewedAt: s.viewedAt,
      })),
    });
    const stored = await putPrivate(
      `${projectPrefix(doc.projectId)}signed/${doc.fileName.replace(/\.pdf$/i, "")}-signed.pdf`,
      signedPdf,
      "application/pdf",
    );
    await db.batch([
      db.update(documents).set({ signedStorageKey: stored.pathname, signedSha256: sha256(signedPdf) }).where(eq(documents.id, doc.id)),
      eventInsert({
        workspaceId: doc.workspaceId,
        projectId: doc.projectId,
        actorId,
        verb: "document.completed",
        subjectType: "document",
        subjectId: doc.id,
        payload: { title: doc.title },
      }),
    ]);
  } catch (error) {
    console.error("[documents] could not finish signed copy", { documentId, error });
    await db.update(documents).set({ status: "out_for_signature", completedAt: null }).where(eq(documents.id, doc.id));
    notifyLater(() => staffRecipients(doc.workspaceId), {
      subject: `Action needed: ${doc.title} is signed but the certificate failed`,
      preheader: "Every signer has signed. The signed copy couldn't be generated.",
      heading: "A signed copy needs a retry",
      paragraphs: [
        `Everyone signed ${doc.title}, but building the signed PDF failed. The signatures are safe.`,
        "Open the document and use Finish signed copy to try again. If it keeps failing, the original PDF may be encrypted.",
      ],
      cta: { label: "Open the document", href: portalLink(`/projects/${doc.projectId}/documents/${doc.id}`) },
    });
    return null;
  }

  const [deposit] = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.documentId, doc.id), eq(invoices.status, "open")))
    .limit(1);
  const projectName = row!.project.name;
  const clientContent = {
    subject: `Signed: ${doc.title}`,
    preheader: deposit
      ? `Next step: the ${formatMoney(deposit.amountCents, deposit.currency)} deposit, then we start building.`
      : "Everyone has signed. Your copy with the signature certificate is in the portal.",
    heading: `${doc.title} is fully signed`,
    paragraphs: [
      `Everyone has signed ${doc.title} for ${projectName}.`,
      deposit
        ? `Deposit invoice ${deposit.number} for ${formatMoney(deposit.amountCents, deposit.currency)} is now available for payment. Work can begin once the deposit has been received.`
        : "Download the signed copy, with its signature certificate, any time from your portal.",
    ],
    cta: deposit
      ? { label: "Pay the deposit", href: portalLink(`/projects/${doc.projectId}/billing`) }
      : { label: "View signed document", href: portalLink(`/projects/${doc.projectId}/documents/${doc.id}`) },
    footnote: deposit ? `Due ${formatDate(deposit.dueOn)}` : undefined,
  };
  notifyLater(() => signers.map((s) => s.email), clientContent);
  notifyLater(() => staffRecipients(doc.workspaceId), {
    subject: `Fully signed: ${doc.title} (${row!.client.name})`,
    preheader: deposit ? `Deposit ${deposit.number} is now unlocked for payment.` : "The signed copy is in the portal.",
    heading: `${doc.title} is fully signed`,
    paragraphs: [
      `Every signer has signed ${doc.title} for ${projectName}.`,
      deposit ? `Deposit ${deposit.number} (${formatMoney(deposit.amountCents, deposit.currency)}) is now payable.` : "No deposit is linked to it.",
    ],
    cta: { label: "See the document", href: portalLink(`/projects/${doc.projectId}/documents/${doc.id}`) },
  });
  revalidatePath(`/projects/${doc.projectId}/billing`);
  revalidatePath(`/projects/${doc.projectId}/documents`);
  revalidatePath(`/projects/${doc.projectId}`);
  return {
    next: deposit
      ? { label: `Pay the deposit (${formatMoney(deposit.amountCents, deposit.currency)})`, href: `/projects/${doc.projectId}/billing` }
      : undefined,
  };
}

/** Staff: retry finishing a document whose signed copy failed to generate. */
export async function retryFinalize(formData: FormData) {
  const found = await staffDocument(formData);
  if (!found || found.doc.status !== "out_for_signature") return;
  await finalizeDocument(found.doc.id, found.ctx.viewer.userId);
  revalidatePath(`/projects/${found.doc.projectId}/documents/${found.doc.id}`);
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
    preheader: "Please review and sign your document in the client portal.",
    heading: `${doc.title} is still waiting for your signature`,
    paragraphs: [`This is a reminder to review and sign ${doc.title} for ${ctx.project.name}. Please contact us if you have any questions before signing.`],
    cta: { label: "Review and sign", href: portalLink(`/projects/${doc.projectId}/documents/${doc.id}`) },
  });
  revalidatePath(`/projects/${doc.projectId}/documents/${doc.id}`);
}
