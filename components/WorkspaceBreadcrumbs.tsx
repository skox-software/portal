"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { workspaceLocation } from "@/lib/workspace-navigation";

export function WorkspaceBreadcrumbs({ staff = false }: { staff?: boolean }) {
  const location = workspaceLocation(usePathname(), staff);
  return <nav className="workspace-breadcrumbs shell" aria-label="Page location">
    {location.back && <Link href={location.back.href}><span aria-hidden="true">←</span> {location.back.label}</Link>}
    <span aria-current="page">{location.title}</span>
  </nav>;
}
