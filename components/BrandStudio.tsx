"use client";

import { useState } from "react";

/**
 * Colour pickers, fonts and tone words with a live preview of the client's
 * product in their own brand. Inputs are named so the surrounding server form
 * submits them.
 */
export function BrandStudio({
  companyName,
  logoUrl,
  toneWords,
  initial,
}: {
  companyName: string;
  logoUrl: string | null;
  toneWords: string[];
  initial: { primary?: string; secondary?: string; accent?: string; fonts?: string; tone?: string[]; noBrand?: boolean };
}) {
  const [primary, setPrimary] = useState(initial.primary || "#1c201d");
  const [secondary, setSecondary] = useState(initial.secondary || "#faf9f6");
  const [accent, setAccent] = useState(initial.accent || "#e4a907");
  const [fonts, setFonts] = useState(initial.fonts || "");
  const [tone, setTone] = useState<string[]>(initial.tone ?? []);
  const [noBrand, setNoBrand] = useState(Boolean(initial.noBrand));

  const toggleTone = (word: string) =>
    setTone((t) => (t.includes(word) ? t.filter((w) => w !== word) : t.length >= 3 ? [...t.slice(1), word] : [...t, word]));
  const fontFamily = fonts.split(",")[0]?.trim();

  return (
    <div className="brand-studio">
      <div className="stack">
        <label className="check nobrand">
          <input type="checkbox" name="brand_none" checked={noBrand} onChange={(e) => setNoBrand(e.target.checked)} />
          <span>
            <strong style={{ fontWeight: 500 }}>We don&apos;t have a brand yet.</strong>{" "}
            <span className="muted small">No problem. Pick colours you like and we&apos;ll take it from there.</span>
          </span>
        </label>

        <fieldset className="swatches">
          <legend>Your colours</legend>
          {[
            { name: "brand_primary", label: "Main", value: primary, set: setPrimary },
            { name: "brand_secondary", label: "Background", value: secondary, set: setSecondary },
            { name: "brand_accent", label: "Highlight", value: accent, set: setAccent },
          ].map((c) => (
            <label key={c.name} className="swatch">
              <input type="color" name={c.name} value={c.value} onChange={(e) => c.set(e.target.value)} />
              <span>
                {c.label}
                <span className="muted small num"> {c.value.toUpperCase()}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <div className="field">
          <label htmlFor="brand_fonts">Fonts you use (if you know)</label>
          <input id="brand_fonts" name="brand_fonts" maxLength={200} value={fonts} onChange={(e) => setFonts(e.target.value)} placeholder="e.g. Montserrat, Georgia" />
        </div>

        <fieldset className="tone">
          <legend>Pick up to 3 words for how your brand should feel</legend>
          <div className="tag-choice">
            {toneWords.map((w) => (
              <label key={w} className="tag-option">
                <input type="checkbox" name="brand_tone" value={w} checked={tone.includes(w)} onChange={() => toggleTone(w)} />
                <span>{w}</span>
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      <div className="brand-preview" aria-label="Live preview in your brand" style={{ background: secondary, color: primary }}>
        <p className="preview-tag">Live preview</p>
        <div className="preview-nav" style={{ borderColor: `${primary}22` }}>
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="" className="preview-logo" />
          ) : (
            <span className="preview-wordmark" style={{ fontFamily: fontFamily || undefined }}>
              {companyName}
            </span>
          )}
          <span className="preview-links">
            <span>Services</span>
            <span>About</span>
          </span>
        </div>
        <div className="preview-hero">
          <p className="preview-eyebrow" style={{ color: accent }}>
            {tone.length ? tone.join(" · ") : "Welcome"}
          </p>
          <p className="preview-title" style={{ fontFamily: fontFamily || undefined }}>
            {companyName}, built for your customers.
          </p>
          <span className="preview-button" style={{ background: accent, color: secondary }}>
            Book now
          </span>
        </div>
        <div className="preview-cards">
          {[0, 1, 2].map((i) => (
            <span key={i} className="preview-card" style={{ borderColor: `${primary}22`, background: i === 1 ? `${accent}22` : "transparent" }} />
          ))}
        </div>
      </div>
    </div>
  );
}
