import { AdminDirectory } from "@/components/AdminDirectory";
export const metadata = { title: "Requests · SKOX" };
export default function Page(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <AdminDirectory section="requests" searchParams={props.searchParams} />;
}
