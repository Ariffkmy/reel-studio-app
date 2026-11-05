/**
 * Reel Studio shim for opencut-motion's fonts.ts: same exports, but the font files are
 * loaded from the folder next to the bundled script (assets/motion-fonts/).
 */
export const MOTION_SANS = '"Motion Sans", "Inter", system-ui, sans-serif';
export const MOTION_MONO = '"Motion Mono", ui-monospace, monospace';
export const MOTION_SERIF = '"Motion Serif", Georgia, serif';

const FACES = [
  { family: "Motion Sans", file: "motion-sans-900.woff2", weight: "900", style: "normal" },
  { family: "Motion Sans", file: "motion-sans-800.woff2", weight: "800", style: "normal" },
  { family: "Motion Sans", file: "motion-sans-900-italic.woff2", weight: "900", style: "italic" },
  { family: "Motion Mono", file: "motion-mono-700.woff2", weight: "700", style: "normal" },
  { family: "Motion Mono", file: "motion-mono-500.woff2", weight: "500", style: "normal" },
  { family: "Motion Serif", file: "motion-serif-italic.woff2", weight: "400", style: "italic" },
];

function scriptBase(): string {
  try {
    const s = typeof document !== "undefined" ? (document.currentScript as HTMLScriptElement | null) : null;
    if (s && s.src) return s.src.replace(/[^/]*$/, "");
  } catch { /* ignore */ }
  return "assets/";
}
export const ASSET_BASE = scriptBase();

let loading: Promise<void> | null = null;
export function ensureMotionFonts(): Promise<void> {
  if (loading) return loading;
  if (typeof document === "undefined" || typeof FontFace === "undefined") return Promise.resolve();
  loading = Promise.all(
    FACES.map(async (face) => {
      try {
        const ff = new FontFace(face.family, `url(${ASSET_BASE}motion-fonts/${face.file}) format("woff2")`, {
          weight: face.weight, style: face.style, display: "block",
        });
        await ff.load();
        document.fonts.add(ff);
      } catch (error) {
        console.warn(`[motion] failed to load font ${face.file}`, error);
      }
    }),
  ).then(() => undefined);
  return loading;
}
