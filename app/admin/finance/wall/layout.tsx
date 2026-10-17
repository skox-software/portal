import { requireStaff } from "@/lib/access";
import "../finance.css";

/**
 * Wall mode's frame. It still sits inside the admin layout (Next nests
 * layouts), so it covers the whole window and finance.css hides the
 * sidebar, toolbar and tab bar behind it. Staff only, checked here too.
 */
export default async function WallLayout({ children }: { children: React.ReactNode }) {
  await requireStaff();
  return <div className="fwall-root">{children}</div>;
}
