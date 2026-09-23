"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { signOut } from "@/app/actions";
import { AppIcon, type IconName } from "@/components/AppIcons";

export type TabItem = {
  href: string;
  label: string;
  icon: IconName;
  count?: number;
  /** Set by pages that know their own tab; otherwise matched on the path. */
  active?: boolean;
  exact?: boolean;
};

function isActive(item: TabItem, pathname: string) {
  if (item.active !== undefined) return item.active;
  return item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
}

/**
 * The phone navigation: four tabs and a "More" sheet, fixed to the bottom
 * like a native app. Hidden above 760px, where the regular navigation shows.
 */
export function MobileTabBar({ tabs, more, email }: { tabs: TabItem[]; more: TabItem[]; email?: string }) {
  const pathname = usePathname();
  const sheet = useRef<HTMLDialogElement>(null);
  const moreActive = more.some((m) => isActive(m, pathname));

  // A tapped link navigates; close the sheet behind it.
  useEffect(() => {
    sheet.current?.close();
  }, [pathname]);

  return (
    <>
      <nav className="tabbar" aria-label="Main">
        {tabs.map((t) => {
          const active = isActive(t, pathname);
          return (
            <Link key={t.href} href={t.href} className="tabbar-item" aria-current={active ? "page" : undefined}>
              <span className="tabbar-icon">
                <AppIcon name={t.icon} />
                {!!t.count && <span className="tabbar-badge" aria-label={`${t.count} need you`}>{t.count > 9 ? "9+" : t.count}</span>}
              </span>
              <span className="tabbar-label">{t.label}</span>
            </Link>
          );
        })}
        <button
          type="button"
          className="tabbar-item"
          aria-haspopup="dialog"
          aria-current={moreActive ? "page" : undefined}
          onClick={() => sheet.current?.showModal()}
        >
          <span className="tabbar-icon">
            <AppIcon name="more" />
            {more.some((m) => m.count) && <span className="tabbar-dot" aria-hidden="true" />}
          </span>
          <span className="tabbar-label">More</span>
        </button>
      </nav>

      <dialog
        ref={sheet}
        className="sheet"
        aria-label="More"
        onClick={(e) => {
          if (e.target === e.currentTarget) e.currentTarget.close();
        }}
      >
        <div className="sheet-panel">
          <span className="sheet-grabber" aria-hidden="true" />
          <ul className="sheet-list">
            {more.map((m) => (
              <li key={m.href}>
                <Link href={m.href} aria-current={isActive(m, pathname) ? "page" : undefined} onClick={() => sheet.current?.close()}>
                  <AppIcon name={m.icon} size={22} />
                  <span>{m.label}</span>
                  {!!m.count && <span className="sheet-count">{m.count}</span>}
                </Link>
              </li>
            ))}
          </ul>
          <form action={signOut} className="sheet-foot">
            {email && <span className="sheet-email">{email}</span>}
            <button className="sheet-signout">
              <AppIcon name="signout" size={20} />
              Sign out
            </button>
          </form>
        </div>
      </dialog>
    </>
  );
}
