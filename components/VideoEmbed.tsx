/**
 * Plays Loom, YouTube and Vimeo walkthroughs inline instead of sending clients
 * off-site. Anything else falls back to a plain link.
 */
export function embedUrl(url: string) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    if (host === "loom.com" && u.pathname.startsWith("/share/")) {
      return `https://www.loom.com/embed/${u.pathname.split("/")[2]}`;
    }
    if (host === "youtube.com" && u.searchParams.get("v")) {
      return `https://www.youtube-nocookie.com/embed/${u.searchParams.get("v")}`;
    }
    if (host === "youtu.be") return `https://www.youtube-nocookie.com/embed${u.pathname}`;
    if (host === "vimeo.com" && /^\/\d+/.test(u.pathname)) {
      return `https://player.vimeo.com/video/${u.pathname.split("/")[1]}`;
    }
  } catch {
    return null;
  }
  return null;
}

export function VideoEmbed({ url, title }: { url: string; title: string }) {
  const src = embedUrl(url);
  if (!src) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer">
        Watch the walkthrough ↗
      </a>
    );
  }
  return (
    <div className="video-embed">
      <iframe src={src} title={title} loading="lazy" allow="fullscreen; picture-in-picture" allowFullScreen />
    </div>
  );
}
