/**
 * Reel Studio shim for opencut-motion's lottie.ts: same player (lottie-web canvas renderer,
 * fixed render size, no container), but animations load from assets/motion-lottie/<id>.json
 * instead of the browser's IndexedDB library.
 */
import lottie from "lottie-web/build/player/lottie_canvas";
import { ASSET_BASE } from "./fonts";

export type LottiePlayback = "loop" | "once" | "stretch";
export interface LottieAssetMeta {
  id: string; name: string; width: number; height: number; frameRate: number; inPoint: number; outPoint: number;
}

export class LottiePlayer {
  readonly meta: LottieAssetMeta;
  private readonly canvas: HTMLCanvasElement;
  private readonly anim: any;
  readonly ready: Promise<void>;
  constructor({ meta, data, maxSide = 1280 }: { meta: LottieAssetMeta; data: unknown; maxSide?: number }) {
    this.meta = meta;
    const fit = Math.min(2, maxSide / Math.max(meta.width, meta.height));
    this.canvas = document.createElement("canvas");
    this.canvas.width = Math.max(1, Math.round(meta.width * fit));
    this.canvas.height = Math.max(1, Math.round(meta.height * fit));
    const context = this.canvas.getContext("2d");
    this.anim = (lottie as any).loadAnimation({
      container: undefined, renderer: "canvas", loop: false, autoplay: false, animationData: data,
      rendererSettings: { context, clearCanvas: true, dpr: 1, preserveAspectRatio: "xMidYMid meet" },
    });
    const anim = this.anim;
    this.ready = anim.isLoaded ? Promise.resolve() : new Promise<void>((resolve) => {
      anim.addEventListener("DOMLoaded", () => resolve());
      anim.addEventListener("data_failed", () => resolve());
      setTimeout(resolve, 5000);
    });
  }
  get totalFrames() { return Math.max(1, this.meta.outPoint - this.meta.inPoint); }
  frameAt({ seconds, clipDuration, playback }: { seconds: number; clipDuration: number; playback: LottiePlayback }): number {
    const total = this.totalFrames;
    const raw = playback === "stretch" ? (seconds / Math.max(0.001, clipDuration)) * total : seconds * this.meta.frameRate;
    const local = playback === "loop" ? ((raw % total) + total) % total : Math.min(raw, total - 0.001);
    return Math.max(0, local);
  }
  render({ frame }: { frame: number }): HTMLCanvasElement {
    this.anim.goToAndStop(frame, true);
    return this.canvas;
  }
}

const players = new Map<string, LottiePlayer | null>();
export const getLottiePlayer = ({ id }: { id: string }) => players.get(id) ?? null;
export const isLottieMissing = ({ id }: { id: string }) => players.has(id) && players.get(id) === null;
export function readLottiePlayback(value: unknown): LottiePlayback {
  return value === "loop" || value === "stretch" ? value : "once";
}
export async function ensureLottiePlayer({ id }: { id: string }): Promise<LottiePlayer | null> {
  if (players.has(id)) return players.get(id) ?? null;
  try {
    const url = /[/.]/.test(id) ? id : `${ASSET_BASE}motion-lottie/${id}.json`;
    const data = await (await fetch(url)).json();
    const meta: LottieAssetMeta = {
      id, name: data.nm || id, width: data.w || 512, height: data.h || 512,
      frameRate: data.fr || 30, inPoint: data.ip || 0, outPoint: data.op || 60,
    };
    const p = new LottiePlayer({ meta, data });
    await p.ready;
    players.set(id, p);
    return p;
  } catch (e) {
    console.warn(`[lottie] failed to load ${id}`, e);
    players.set(id, null);
    return null;
  }
}
