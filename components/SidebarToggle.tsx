"use client";

import { SIDEBAR_COOKIE } from "@/lib/sidebar";

/** Collapses the admin sidebar to icons and remembers the choice. */
export function SidebarToggle() {
  return (
    <button
      type="button"
      className="admin-collapse"
      aria-controls="admin-sidebar"
      title="Collapse or expand the sidebar"
      onClick={() => {
        const root = document.documentElement;
        const collapsed = root.getAttribute("data-admin-sidebar") !== "collapsed";
        if (collapsed) root.setAttribute("data-admin-sidebar", "collapsed");
        else root.removeAttribute("data-admin-sidebar");
        document.cookie = `${SIDEBAR_COOKIE}=${collapsed ? "collapsed" : "open"}; path=/; max-age=31536000; samesite=lax`;
      }}
    >
      <span aria-hidden="true" className="admin-collapse-icon" />
      <span className="admin-collapse-label" />
      <span className="sr-only">Toggle sidebar</span>
    </button>
  );
}
