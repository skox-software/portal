import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { readTrack } from "@/lib/pipeline";
import { SalesBoardPage } from "./board";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Pipeline · SKOX" };

/** The Pipeline: real opportunities, from Interested to Won. Outreach lives at /admin/leads. */
export default async function PipelinePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  // Old links: ?track=outreach (or no track, with a bulk import open) belonged to the outreach board.
  if (readTrack(typeof sp.track === "string" ? sp.track : null) === "outreach" || sp.import === "1") {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (typeof v === "string" && k !== "track") p.set(k, v);
    const q = p.toString();
    redirect(`/admin/leads${q ? `?${q}` : ""}`);
  }
  return <SalesBoardPage track="active" sp={sp} />;
}
