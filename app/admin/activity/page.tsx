import { AdminDirectory } from "@/components/AdminDirectory";
export const metadata = { title: "Activity" };
export default function Page(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <AdminDirectory section="activity" searchParams={props.searchParams} />;
}
