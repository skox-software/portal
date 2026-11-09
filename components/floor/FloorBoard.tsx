"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { AppStats, FloorApp } from "@/lib/floor";

export type TileView = { app: FloorApp; reporting: boolean; stats: AppStats };
export type FeedLine = { at: string; text: string; ok: boolean };

const MOTION = "(prefers-reduced-motion: reduce)";
function subscribeMotion(on: () => void) {
  const mq = window.matchMedia(MOTION);
  mq.addEventListener("change", on);
  return () => mq.removeEventListener("change", on);
}

const ago = (iso: string | null, now: number) => {
  if (!iso) return "never";
  const m = Math.round((now - new Date(iso).getTime()) / 60_000);
  if (m < 60) return `${Math.max(m, 1)} min ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
};
const dur = (s: number | null) => (s === null ? "—" : s < 90 ? `${Math.round(s)}s` : `${Math.round(s / 60)} min`);

/**
 * Refresh every 2 minutes while the tab is visible and someone has touched the page in the last 30 minutes, so a
 * forgotten tab never keeps the database awake.
 */
function useLiveRefresh() {
  const router = useRouter();
  useEffect(() => {
    let last = Date.now();
    const touch = () => { last = Date.now(); };
    const events = ["pointermove", "keydown", "scroll", "visibilitychange"] as const;
    events.forEach((e) => window.addEventListener(e, touch, { passive: true }));
    const id = setInterval(() => {
      if (document.visibilityState === "visible" && Date.now() - last < 30 * 60_000) router.refresh();
    }, 120_000);
    return () => { clearInterval(id); events.forEach((e) => window.removeEventListener(e, touch)); };
  }, [router]);
}

export function FloorBoard({ tiles, feed, now }: { tiles: TileView[]; feed: FeedLine[]; now: string }) {
  useLiveRefresh();
  const reduce = useSyncExternalStore(subscribeMotion, () => window.matchMedia(MOTION).matches, () => false);
  const nowMs = new Date(now).getTime();
  const live = tiles.filter((t) => t.reporting);
  const desks = tiles.filter((t) => t.app.kind === "desk" && t.reporting);
  const healthy = desks.filter((t) => t.stats.selftest?.ok !== false && t.stats.failedMonth <= t.stats.month).length;
  const [line, setLine] = useState(0);
  useEffect(() => {
    if (feed.length < 2 || reduce) return;
    const id = setInterval(() => setLine((l) => (l + 1) % feed.length), 3200);
    return () => clearInterval(id);
  }, [feed.length, reduce]);

  return (
    <div className="fl">
      <section className="fl-stage">
        <dl className="fl-strip">
          <div><dt>Jobs today</dt><dd>{live.reduce((s, t) => s + (t.app.kind === "website" ? 0 : t.stats.today), 0)}</dd></div>
          <div><dt>Jobs this month</dt><dd>{live.reduce((s, t) => s + (t.app.kind === "website" ? 0 : t.stats.month), 0)}</dd></div>
          <div><dt>Desks healthy</dt><dd>{desks.length ? `${healthy} of ${desks.length}` : "—"}</dd></div>
        </dl>
        <div className="fl-feed" aria-live="off">
          <span className="fl-feed-tag">LIVE</span>
          {feed.length ? (
            <span key={line} className="fl-feed-line" data-ok={feed[line].ok || undefined}>{feed[line].text}</span>
          ) : (
            <span className="fl-feed-line">Waiting for the first event</span>
          )}
        </div>
      </section>

      <div className="fl-grid">
        {tiles.map((t, i) => <Tile key={t.app.key} tile={t} nowMs={nowMs} index={i} />)}
      </div>
    </div>
  );
}

function Spark({ data }: { data: number[] }) {
  const max = Math.max(1, ...data);
  const w = 168;
  const h = 40;
  const step = w / (data.length - 1 || 1);
  const pts = data.map((v, i) => [i * step, h - 4 - (v / max) * (h - 8)] as const);
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"} ${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="fl-spark" aria-hidden="true" preserveAspectRatio="none">
      <path d={`${d} L ${w} ${h} L 0 ${h} Z`} className="fl-spark-fill" />
      <path d={d} className="fl-spark-line" pathLength={1} />
      <circle cx={pts.at(-1)![0]} cy={pts.at(-1)![1]} r="3" className="fl-spark-dot" />
    </svg>
  );
}

function SiteTile({ tile, nowMs, index }: { tile: TileView; nowMs: number; index: number }) {
  const { app, stats } = tile;
  const site = stats.site;
  const status = !site ? "silent" : site.up ? "ok" : "down";
  return (
    <article className="fl-tile fl-site" data-status={status} data-kind="website" style={{ animationDelay: `${index * 70}ms` }}>
      <header>
        <span className="fl-led" aria-label={site ? (site.up ? "Live" : "Down") : "Not checked yet"} />
        <div>
          <h2>{app.name}</h2>
          <p>{app.client} · Website</p>
        </div>
      </header>
      {!site ? (
        <p className="fl-silent">Not checked yet.</p>
      ) : (
        <>
          <div className="fl-big fl-live">
            <strong>{site.up ? "Live" : "Down"}</strong>
            <span>{site.status ? `${site.status} · ${site.ms} ms` : "no answer"}</span>
          </div>
          <dl className="fl-nums">
            <div><dt>Uptime (30d)</dt><dd>{site.uptime}%</dd></div>
            <div><dt>Checks</dt><dd>{site.checks}</dd></div>
            <div><dt>Checked</dt><dd>{ago(site.at, nowMs)}</dd></div>
          </dl>
          {app.siteUrl && <a className="fl-more fl-visit" href={app.siteUrl} target="_blank" rel="noreferrer">Visit {app.siteUrl.replace(/^https?:\/\//, "")}</a>}
        </>
      )}
    </article>
  );
}

function Tile({ tile, nowMs, index }: { tile: TileView; nowMs: number; index: number }) {
  const { app, stats, reporting } = tile;
  const [open, setOpen] = useState(false);
  if (app.kind === "website") return <SiteTile tile={tile} nowMs={nowMs} index={index} />;
  const status = !reporting ? "silent" : stats.selftest && !stats.selftest.ok ? "down" : stats.failedMonth > 0 && stats.failedMonth >= stats.month ? "warn" : "ok";
  return (
    <article className="fl-tile" data-status={status} data-kind={app.kind} data-active={stats.activeNow || undefined} style={{ animationDelay: `${index * 70}ms` }}>
      <header>
        <span className="fl-led" aria-label={{ ok: "Healthy", warn: "Needs a look", down: "Failing", silent: "Not reporting" }[status]} />
        <div>
          <h2>{app.url ? <Link href={app.url}>{app.name}</Link> : app.name}</h2>
          <p>{app.client} · {app.kind === "desk" ? "Desk" : app.kind === "app" ? "App" : "Internal"}</p>
        </div>
        {stats.activeNow && <span className="fl-now">In use now</span>}
      </header>

      {!reporting ? (
        <p className="fl-silent">Not reporting yet. {app.source === "Not reporting yet" ? "Connect this app to see it here." : app.source}</p>
      ) : (
        <>
          <div className="fl-big">
            <strong>{stats.today}</strong><span>{app.unit}s today</span>
          </div>
          <Spark data={stats.spark} />
          <dl className="fl-nums">
            <div><dt>This week</dt><dd>{stats.week}</dd></div>
            <div><dt>30 days</dt><dd>{stats.month}</dd></div>
            <div><dt>All time</dt><dd>{stats.total}</dd></div>
            {app.kind !== "internal" && <div><dt>Typical time</dt><dd>{dur(stats.medianSeconds)}</dd></div>}
          </dl>
          <button type="button" className="fl-more" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{open ? "Less" : "More"}</button>
          {open && (
            <dl className="fl-detail">
              <div><dt>Last {app.unit}</dt><dd>{ago(stats.lastAt, nowMs)}</dd></div>
              {app.kind !== "internal" && <div><dt>Failed, 30 days</dt><dd>{stats.failedMonth}{stats.stoppedMonth ? ` (plus ${stats.stoppedMonth} stopped on purpose)` : ""}</dd></div>}
              {stats.users.length > 0 && <div><dt>Who uses it</dt><dd className="fl-users">{stats.users.map((u) => <span key={u}>{u}</span>)}</dd></div>}
              {stats.selftest && <div><dt>Morning self-test</dt><dd>{stats.selftest.ok ? "Passed" : `Failed: ${stats.selftest.failed.join(", ") || "see logs"}`} · {ago(stats.selftest.at, nowMs)}</dd></div>}
              {stats.troubleCounties.length > 0 && <div><dt>Most missed documents</dt><dd>{stats.troubleCounties.map((c) => `${c.county} (${c.failed})`).join(", ")}</dd></div>}
              {app.kind === "desk" && <div><dt>Staff hours given back</dt><dd>{stats.hoursSavedMonth === null ? "Not measured yet: needs a timing study" : `${stats.hoursSavedMonth} h this month`}</dd></div>}
              <div><dt>Running cost</dt><dd>{app.monthlyCost === null ? "Not entered" : `$${app.monthlyCost}/month`}</dd></div>
              <div><dt>Source</dt><dd>{app.source}</dd></div>
            </dl>
          )}
        </>
      )}
    </article>
  );
}
