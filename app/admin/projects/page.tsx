import { AdminDirectory } from "@/components/AdminDirectory";
export const metadata = { title: "Projects" };
export default function Page(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <AdminDirectory section="projects" searchParams={props.searchParams} />;
}
