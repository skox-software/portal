import type { Metadata } from "next";
import { SalesBoardPage } from "@/app/admin/pipeline/board";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Outreach" };

/** Outreach: imported and scanned leads, worked by call and cold email until one shows interest. */
export default async function LeadsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <SalesBoardPage track="outreach" sp={await searchParams} />;
}
