import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";

/**
 * The preview image for shared portal links. Served as a route rather than
 * the opengraph-image file convention, because that convention drops the
 * /portal base path from the URL it puts in the page.
 */
const size = { width: 1200, height: 630 };

export async function GET() {
  // The lockup is 886×214; drawn at 330 wide.
  const logo = await readFile(path.join(process.cwd(), "public/brand/lockup-light.png"));
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        backgroundColor: "#fafaf8",
        padding: 72,
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- ImageResponse renders plain img only */}
      <img src={`data:image/png;base64,${logo.toString("base64")}`} width={330} height={80} alt="UnBusy" />

      <div style={{ display: "flex", flexDirection: "column" }}>
        <div
          style={{
            display: "flex",
            fontSize: 72,
            fontWeight: 700,
            color: "#15181d",
            lineHeight: 1.02,
            letterSpacing: -2,
            maxWidth: 940,
          }}
        >
          Your work, in one place.
        </div>
        <div style={{ display: "flex", marginTop: 28, fontSize: 28, color: "#5b6168" }}>The UnBusy Client Portal</div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 24, color: "#15181d" }}>
        <div style={{ display: "flex", width: 12, height: 12, borderRadius: 6, background: "#0b5cff" }} />
        Follow the work, approve, sign, pay
      </div>
    </div>,
    size,
  );
}
