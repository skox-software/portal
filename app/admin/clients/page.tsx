import { AdminDirectory } from "@/components/AdminDirectory";
export const metadata = { title: "Clients · SKOX" };
export default function Page(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <AdminDirectory section="clients" searchParams={props.searchParams} />;
}
