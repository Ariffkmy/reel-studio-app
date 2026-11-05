/**
 * RSMotion: opencut-motion's motion-graphics engine (render.ts, unchanged) running inside
 * HyperFrames. Each layer is one full-frame canvas; a single GSAP tween drives a setter
 * that redraws every active overlay at the timeline's time. Setters run on every seek
 * (HyperFrames seeks with suppressEvents=true, which skips onUpdate callbacks), so the
 * render is frame-accurate and seek-safe.
 */
import { drawMotion } from "./render";
import { ensureMotionFonts } from "./fonts";
import { ensureLottiePlayer } from "./lottie";
import { MOTION_PRESETS, getMotionPreset, DEFAULT_MOTION_ACCENT } from "./presets";
import { buildMotionCaptionChunks } from "./words";

export interface Overlay {
  preset: string;
  content?: string;
  start: number;            // seconds on the timeline it is mounted on
  duration: number;
  x?: number;               // horizontal anchor, fraction of width from centre (-0.5 left edge)
  y?: number;               // vertical anchor, fraction of height from centre (-0.5 top edge)
  fontSize?: number;        // editor font-size units (7 = default preset size)
  color?: string;
  accent?: string;
  entrance?: "rise" | "pop";
  words?: Array<[string, number, number]>; // captions: [word, start, end] relative to overlay start
  assetId?: string;         // lottie id (starter name) or URL
  playback?: string;
  font?: string;
}

const W = 1080, H = 1920;

function drawAll(ctx: CanvasRenderingContext2D, overlays: Overlay[], t: number, w: number, h: number) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  for (const o of overlays) {
    const local = t - o.start;
    if (local < 0 || local >= o.duration) continue;
    const def = getMotionPreset({ id: o.preset });
    const ax = o.x ?? def?.anchorX ?? 0;
    const ay = o.y ?? def?.anchorY ?? 0;
    ctx.save();
    ctx.translate(w / 2 + ax * w, h / 2 + ay * h);
    try {
      drawMotion({
        ctx, preset: o.preset as any, content: o.content ?? def?.content ?? "",
        wordsParam: o.words ? JSON.stringify(o.words) : undefined,
        localTime: local, duration: o.duration, canvasWidth: w, canvasHeight: h,
        fontSize: o.fontSize ?? def?.fontSize ?? 7, textColor: o.color ?? "#ffffff",
        accentColor: o.accent ?? def?.accent ?? DEFAULT_MOTION_ACCENT, entrance: o.entrance ?? "rise",
        fontFamily: o.font, assetId: o.assetId, playback: o.playback,
      });
    } catch (e) { console.warn("[RSMotion] draw failed", o.preset, e); }
    ctx.restore();
  }
}

/** Load fonts and any Lottie files the overlays use. Call before building the timeline. */
function ready(overlays: Overlay[] = []): Promise<void> {
  const ids = [...new Set(overlays.filter((o) => o.preset === "lottie" && o.assetId).map((o) => o.assetId as string))];
  return Promise.all([ensureMotionFonts(), ...ids.map((id) => ensureLottiePlayer({ id }))]).then(() => undefined);
}

/**
 * Mount a full-frame canvas layer into `root` and drive it from `tl`.
 * opts.total = how long the driver runs (defaults to the last overlay end).
 */
function layer(root: HTMLElement, tl: any, overlays: Overlay[], opts: { total?: number; z?: number; id?: string; width?: number; height?: number } = {}) {
  const w = opts.width ?? W, h = opts.height ?? H;
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  if (opts.id) c.id = opts.id;
  c.style.cssText = `position:absolute;left:0;top:0;width:${w}px;height:${h}px;pointer-events:none;${opts.z !== undefined ? `z-index:${opts.z};` : ""}`;
  root.appendChild(c);
  const ctx = c.getContext("2d") as CanvasRenderingContext2D;
  const total = opts.total ?? Math.max(0.1, ...overlays.map((o) => o.start + o.duration));
  let cur = -1;
  const driver = {
    get t() { return cur; },
    set t(v: number) { cur = v; drawAll(ctx, overlays, v, w, h); },
  };
  tl.fromTo(driver, { t: 0 }, { t: total, duration: total, ease: "none", immediateRender: true }, 0);
  return c;
}

/** Word-by-word caption overlays from absolute word timings ([[word, start, end], ...]). */
function captions(words: Array<[string, number, number]>, opts: { style?: "box" | "pop"; maxWords?: number; maxChars?: number; y?: number; fontSize?: number; accent?: string; color?: string } = {}): Overlay[] {
  const chunks = buildMotionCaptionChunks({
    words: words.map(([text, start, end]) => ({ text, start, end })),
    maxWords: opts.maxWords ?? 3, maxChars: opts.maxChars ?? 20,
  });
  return chunks.map((c) => ({
    preset: opts.style === "pop" ? "captions-pop" : "captions-box",
    content: c.text, start: c.startTime, duration: c.duration,
    words: c.words.map((w) => [w.w, w.s, w.e] as [string, number, number]),
    y: opts.y, fontSize: opts.fontSize, accent: opts.accent, color: opts.color,
  }));
}

/** Draw one frame of one overlay into a canvas (for previews/thumbnails). */
function still(canvas: HTMLCanvasElement, o: Overlay, t: number) {
  drawAll(canvas.getContext("2d") as CanvasRenderingContext2D, [{ ...o, start: 0 }], t, canvas.width, canvas.height);
}

const presets = MOTION_PRESETS.map((p) => ({ id: p.id, label: p.label, category: p.category, description: p.description, content: p.content, durationSeconds: p.durationSeconds, anchorY: p.anchorY, help: p.help }));

(window as any).RSMotion = { ready, layer, captions, still, presets, drawMotion };
