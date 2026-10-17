/**
 * A short two-note chime for a payment, synthesised with WebAudio: no audio
 * file to load. The context is created on the click that turns sound on,
 * because browsers keep audio locked until a user gesture.
 */

let ctx: AudioContext | null = null;

export function primeChime() {
  if (typeof window === "undefined" || !("AudioContext" in window)) return;
  ctx ??= new AudioContext();
  if (ctx.state === "suspended") void ctx.resume();
}

export function playChime() {
  primeChime();
  if (!ctx || ctx.state !== "running") return;
  const t = ctx.currentTime;
  // A rising fifth: E6 then B6, each a quick bell-like decay.
  [
    { f: 1318.5, at: 0 },
    { f: 1975.5, at: 0.11 },
  ].forEach(({ f, at }) => {
    const osc = ctx!.createOscillator();
    const gain = ctx!.createGain();
    osc.type = "sine";
    osc.frequency.value = f;
    gain.gain.setValueAtTime(0, t + at);
    gain.gain.linearRampToValueAtTime(0.12, t + at + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + at + 0.55);
    osc.connect(gain).connect(ctx!.destination);
    osc.start(t + at);
    osc.stop(t + at + 0.6);
  });
}
