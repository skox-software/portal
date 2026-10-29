import Link from "next/link";
import { SUPPORT_EMAIL } from "@/lib/brand";

export default function NotFound() {
  return (
    <main className="shell page" style={{ maxWidth: 560 }}>
      <p className="eyebrow">Not found</p>
      <h1 style={{ fontSize: 44, margin: "8px 0 14px" }}>We couldn&apos;t find that page.</h1>
      <p className="muted">
        It may not exist, or your account may not have access to it. If you think you should see
        it, email <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
      </p>
      <p style={{ marginTop: 20 }}>
        <Link className="btn btn-primary" href="/">
          Back to your projects
        </Link>
      </p>
    </main>
  );
}
