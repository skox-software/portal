import Link from "next/link";

export function BillingContacts({ clientId, emails }: { clientId: string; emails: string[] }) {
  return emails.length ? <p className="small muted" style={{ marginTop: 10, overflowWrap: "anywhere" }}><strong>Invoice recipients:</strong> {emails.join(", ")} · <Link href={`/admin/clients/${clientId}#people-title`}>Manage contacts</Link></p> : <div className="notice notice-error" style={{ marginTop: 12 }}><strong>No invoice recipient added.</strong> Add a client contact before sending this invoice. <Link href={`/admin/clients/${clientId}#invite-title`}>Add contact →</Link></div>;
}
