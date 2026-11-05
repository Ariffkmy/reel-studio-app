/* eslint-disable opencut/prefer-object-params -- tight drawing helpers, called thousands of times per frame */
/**
 * Motion-graphics renderer. Every preset is a pure function of (content, local time),
 * drawn with Canvas2D in "design units": a headline is 150 units tall, and units are
 * scaled to pixels from the element's font size and the canvas height. That keeps the
 * look identical between the preview and the exported MP4, at any resolution.
 */
import { MOTION_MONO, MOTION_SANS, MOTION_SERIF, ensureMotionFonts } from "./fonts";
import { DEFAULT_MOTION_ACCENT, DEFAULT_MOTION_INK, type MotionPresetId } from "./presets";
import { getLottiePlayer, isLottieMissing, readLottiePlayback } from "./lottie";
import { decodeMotionWords, spreadWordsEvenly, type MotionWord } from "./words";

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface MotionDrawInput {
	ctx: Ctx;
	preset: MotionPresetId;
	content: string;
	wordsParam?: unknown;
	/** Seconds since the element started. */
	localTime: number;
	/** Element duration in seconds. */
	duration: number;
	canvasWidth: number;
	canvasHeight: number;
	/** Editor font size (text element units). */
	fontSize: number;
	textColor: string;
	accentColor: string;
	entrance: string;
	fontFamily?: string;
	/** Lottie asset id (preset "lottie"). */
	assetId?: string;
	/** Lottie playback mode. */
	playback?: string;
}

/** Headline size in design units; fontSize 7 on a 1920-tall canvas ≈ 150px. */
const UNIT_REFERENCE = 150;
const FONT_SIZE_SCALE_REFERENCE = 90;
const EXIT = 0.3;

// ---------------------------------------------------------------- easing
const clamp = (x: number, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const prog = (t: number, a: number, b: number) => (b > a ? clamp((t - a) / (b - a)) : t >= a ? 1 : 0);
const eo3 = (x: number) => 1 - (1 - x) ** 3;
const ei3 = (x: number) => x ** 3;
const eio = (x: number) => 3 * x * x - 2 * x * x * x;
const eback = (x: number, s = 1.70158) => {
	const y = x - 1;
	return y * y * ((s + 1) * y + s) + 1;
};

// ---------------------------------------------------------------- fonts & text
interface Style {
	family: string;
	size: number;
	weight?: string;
	italic?: boolean;
}
const sans = (size: number, weight = "900", family = MOTION_SANS): Style => ({ family, size, weight });
const mono = (size: number, weight = "700"): Style => ({ family: MOTION_MONO, size, weight });
const serif = (size: number): Style => ({ family: MOTION_SERIF, size, weight: "400", italic: true });

function setFont(ctx: Ctx, style: Style) {
	ctx.font = `${style.italic ? "italic " : ""}${style.weight ?? "400"} ${style.size}px ${style.family}`;
}

function measure(ctx: Ctx, text: string, style: Style): number {
	setFont(ctx, style);
	return ctx.measureText(text).width;
}

interface TextOpts {
	fill: string;
	stroke?: number;
	strokeColor?: string;
	shadow?: number;
	alpha?: number;
	scale?: number;
	align?: CanvasTextAlign;
	rotate?: number;
}

function text(ctx: Ctx, value: string, x: number, y: number, style: Style, opts: TextOpts) {
	const alpha = opts.alpha ?? 1;
	if (alpha <= 0.003 || !value) return;
	ctx.save();
	ctx.globalAlpha *= alpha;
	ctx.translate(x, y);
	if (opts.rotate) ctx.rotate((opts.rotate * Math.PI) / 180);
	const scale = opts.scale ?? 1;
	if (scale !== 1) ctx.scale(scale, scale);
	setFont(ctx, style);
	ctx.textAlign = opts.align ?? "center";
	ctx.textBaseline = "middle";
	if (opts.shadow) {
		ctx.shadowColor = `rgba(0,0,0,${0.55 * opts.shadow})`;
		ctx.shadowBlur = style.size * 0.14;
		ctx.shadowOffsetY = style.size * 0.04;
	}
	if (opts.stroke) {
		ctx.lineJoin = "round";
		ctx.lineWidth = opts.stroke * 2;
		ctx.strokeStyle = opts.strokeColor ?? DEFAULT_MOTION_INK;
		ctx.strokeText(value, 0, 0);
		ctx.shadowColor = "transparent";
	}
	ctx.fillStyle = opts.fill;
	ctx.fillText(value, 0, 0);
	ctx.restore();
}

function roundRect(ctx: Ctx, cx: number, cy: number, w: number, h: number, r: number, fill: string, opts: { alpha?: number; shadow?: number; stroke?: string; lineWidth?: number; scale?: number; rotate?: number } = {}) {
	const alpha = opts.alpha ?? 1;
	if (alpha <= 0.003) return;
	ctx.save();
	ctx.globalAlpha *= alpha;
	ctx.translate(cx, cy);
	if (opts.rotate) ctx.rotate((opts.rotate * Math.PI) / 180);
	if (opts.scale && opts.scale !== 1) ctx.scale(opts.scale, opts.scale);
	ctx.beginPath();
	ctx.roundRect(-w / 2, -h / 2, w, h, Math.min(r, h / 2, w / 2));
	if (opts.shadow) {
		ctx.shadowColor = `rgba(0,0,0,${0.4 * opts.shadow})`;
		ctx.shadowBlur = 24;
		ctx.shadowOffsetY = 8;
	}
	if (fill !== "transparent") {
		ctx.fillStyle = fill;
		ctx.fill();
	}
	if (opts.stroke) {
		ctx.shadowColor = "transparent";
		ctx.strokeStyle = opts.stroke;
		ctx.lineWidth = opts.lineWidth ?? 4;
		ctx.stroke();
	}
	ctx.restore();
}

function arrow(ctx: Ctx, cx: number, cy: number, size: number, color: string, alpha = 1) {
	if (alpha <= 0.003) return;
	ctx.save();
	ctx.globalAlpha *= alpha;
	ctx.strokeStyle = color;
	ctx.lineWidth = size * 0.16;
	ctx.lineCap = "round";
	ctx.lineJoin = "round";
	ctx.beginPath();
	ctx.moveTo(cx - size / 2, cy);
	ctx.lineTo(cx + size / 2, cy);
	ctx.moveTo(cx + size * 0.12, cy - size * 0.36);
	ctx.lineTo(cx + size / 2, cy);
	ctx.lineTo(cx + size * 0.12, cy + size * 0.36);
	ctx.stroke();
	ctx.restore();
}

function check(ctx: Ctx, cx: number, cy: number, size: number, color: string, p: number, alpha = 1) {
	if (p <= 0 || alpha <= 0.003) return;
	const p1 = [cx - size * 0.35, cy + size * 0.02];
	const p2 = [cx - size * 0.1, cy + size * 0.28];
	const p3 = [cx + size * 0.42, cy - size * 0.32];
	const q = eo3(p);
	ctx.save();
	ctx.globalAlpha *= alpha;
	ctx.strokeStyle = color;
	ctx.lineWidth = size * 0.16;
	ctx.lineCap = "round";
	ctx.lineJoin = "round";
	ctx.beginPath();
	ctx.moveTo(p1[0], p1[1]);
	if (q < 0.4) {
		const k = q / 0.4;
		ctx.lineTo(p1[0] + (p2[0] - p1[0]) * k, p1[1] + (p2[1] - p1[1]) * k);
	} else {
		const k = (q - 0.4) / 0.6;
		ctx.lineTo(p2[0], p2[1]);
		ctx.lineTo(p2[0] + (p3[0] - p2[0]) * k, p2[1] + (p3[1] - p2[1]) * k);
	}
	ctx.stroke();
	ctx.restore();
}

// ---------------------------------------------------------------- content parsing
interface Line {
	text: string;
	kind: "kicker" | "accent" | "title" | "strong" | "plain";
	at: number | null;
}

function parseLines(content: string): Line[] {
	return content
		.replace(/\r\n/g, "\n")
		.split("\n")
		.map((raw) => raw.trim())
		.filter(Boolean)
		.map((raw) => {
			let value = raw;
			let at: number | null = null;
			const timing = /^@(\d+(?:\.\d+)?)\s+/.exec(value);
			if (timing) {
				at = Number(timing[1]);
				value = value.slice(timing[0].length);
			}
			let kind: Line["kind"] = "plain";
			if (value.startsWith("//")) kind = "kicker";
			else if (value.startsWith("~")) {
				kind = "accent";
				value = value.slice(1).trim();
			} else if (value.startsWith("#")) {
				kind = "title";
				value = value.slice(1).trim();
			} else if (value.startsWith("*")) {
				kind = "strong";
				value = value.slice(1).trim();
			}
			return { text: value, kind, at };
		});
}

// ---------------------------------------------------------------- shared animated pieces
interface Env {
	ctx: Ctx;
	t: number;
	tOut: number;
	widthUnits: number;
	fg: string;
	accent: string;
	ink: string;
	pop: boolean;
	family: string;
	/** pixels per design unit */
	scale: number;
}

/** Exit progress (0 → visible, 1 → gone) shared by all pieces. */
const exitP = (env: Env) => eo3(prog(env.t, env.tOut, env.tOut + EXIT));

function staggerLine(env: Env, value: string, cx: number, cy: number, style: Style, color: string, tIn: number, opts: { mode?: "rise" | "pop"; st?: number; dur?: number; maxWidth?: number } = {}) {
	const { ctx, t } = env;
	if (t < tIn) return;
	let s = style;
	const maxWidth = opts.maxWidth ?? env.widthUnits * 0.9;
	let total = measure(ctx, value, s);
	if (total > maxWidth) {
		s = { ...style, size: (style.size * maxWidth) / total };
		total = maxWidth;
	}
	setFont(ctx, s);
	const st = opts.st ?? 0.035;
	const dur = opts.dur ?? 0.42;
	const po = exitP(env);
	let x = cx - total / 2;
	let i = 0;
	for (const ch of value) {
		const cw = ctx.measureText(ch).width;
		if (ch !== " ") {
			const p = prog(t, tIn + i * st, tIn + i * st + dur);
			i += 1;
			if (p > 0) {
				const mode = opts.mode ?? (env.pop ? "pop" : "rise");
				const dy = mode === "rise" ? (1 - eback(p, 2.2)) * s.size * 0.47 : 0;
				const sc = mode === "pop" ? 0.3 + 0.7 * eback(p, 2.6) : 1;
				text(ctx, ch, x + cw / 2, cy + dy - po * 40, s, {
					fill: color,
					shadow: 1,
					alpha: clamp(p * 2.5) * (1 - po),
					scale: sc,
				});
			}
		}
		x += cw;
	}
}

function slideIn(env: Env, tIn: number, kind: "up" | "left" | "right" | "pop" = "up", dur = 0.45) {
	const p = eback(prog(env.t, tIn, tIn + dur), 1.6);
	const a = clamp(prog(env.t, tIn, tIn + dur * 0.6)) * (1 - exitP(env));
	const po = exitP(env);
	let dx = 0;
	let dy = -po * 40;
	let scale = 1;
	if (kind === "up") dy += (1 - p) * 60;
	if (kind === "left") dx -= (1 - p) * 180;
	if (kind === "right") dx += (1 - p) * 180;
	if (kind === "pop") scale = 0.4 + 0.6 * p;
	return { dx, dy, scale, alpha: env.t < tIn ? 0 : a };
}

function kicker(env: Env, value: string, cx: number, cy: number, tIn: number) {
	const m = slideIn(env, tIn, "up", 0.4);
	text(env.ctx, value, cx + m.dx, cy + m.dy, mono(36), { fill: "#fff4e6", shadow: 1, alpha: m.alpha });
}

function accentLine(env: Env, value: string, cx: number, cy: number, size: number, tIn: number) {
	const m = slideIn(env, tIn, "up", 0.5);
	let style = serif(size);
	const w = measure(env.ctx, value, style);
	if (w > env.widthUnits * 0.9) style = serif((size * env.widthUnits * 0.9) / w);
	text(env.ctx, value, cx + m.dx, cy + m.dy, style, {
		fill: env.accent,
		stroke: 2,
		strokeColor: "rgba(60,22,8,0.9)",
		shadow: 1.4,
		alpha: m.alpha,
		scale: m.scale,
	});
}

function chip(env: Env, value: string, cx: number, cy: number, size: number, bg: string, fg: string, m: { dx: number; dy: number; scale: number; alpha: number }) {
	const style = sans(size, "800");
	const w = measure(env.ctx, value, style) + size * 1.4;
	const h = size * 1.9;
	roundRect(env.ctx, cx + m.dx, cy + m.dy, w, h, h / 2, bg, { alpha: m.alpha, shadow: 1, scale: m.scale });
	text(env.ctx, value, cx + m.dx, cy + m.dy + size * 0.03, style, { fill: fg, alpha: m.alpha, scale: m.scale });
	return w;
}

function chipWidth(env: Env, value: string, size: number) {
	return measure(env.ctx, value, sans(size, "800")) + size * 1.4;
}

function panel(env: Env, w: number, h: number, cx: number, cy: number, title: string | null, tIn: number) {
	const p = eback(prog(env.t, tIn, tIn + 0.45), 1.4);
	const a = clamp(prog(env.t, tIn, tIn + 0.25)) * (1 - exitP(env));
	if (env.t < tIn) return { a: 0, dy: 0 };
	const dy = (1 - p) * 50 - exitP(env) * 30;
	roundRect(env.ctx, cx, cy + dy, w, h, 28, "rgba(18,16,16,0.86)", { alpha: a, shadow: 1.2, scale: 0.92 + 0.08 * p });
	if (title) {
		text(env.ctx, title, cx - w / 2 + 40, cy - h / 2 + 46 + dy, mono(28, "500"), { fill: "#b4aaa0", alpha: a, align: "left" });
		["#ff5f56", "#ffbd2e", "#27c93f"].forEach((c, k) => {
			roundRect(env.ctx, cx + w / 2 - 110 + k * 30, cy - h / 2 + 46 + dy, 18, 18, 9, c, { alpha: a });
		});
	}
	return { a, dy };
}

// ---------------------------------------------------------------- presets
function drawHeadline(env: Env, lines: Line[]) {
	const sizes = lines.map((line) => (line.kind === "kicker" ? 70 : line.kind === "accent" ? 150 : 150));
	const totalH = sizes.reduce((a, b) => a + b, 0);
	let y = -totalH / 2;
	let auto = 0;
	lines.forEach((line, index) => {
		const h = sizes[index];
		const cy = y + h / 2;
		y += h;
		const tIn = line.at ?? auto;
		if (line.kind === "kicker") {
			kicker(env, line.text, 0, cy, tIn);
			auto = tIn + 0.25;
		} else if (line.kind === "accent") {
			accentLine(env, line.text, 0, cy, 150, tIn);
			auto = tIn + 0.4;
		} else {
			const color = line.kind === "strong" ? env.accent : env.fg;
			staggerLine(env, line.text.toUpperCase(), 0, cy, sans(150, "900", env.family), color, tIn);
			auto = tIn + Math.min(1.2, 0.2 + line.text.length * 0.035);
		}
	});
}

function drawChips(env: Env, lines: Line[]) {
	const head = lines.filter((l) => l.kind === "kicker" || l.kind === "title");
	const items = lines.filter((l) => l.kind === "plain" || l.kind === "strong" || l.kind === "accent");
	const size = 50;
	const gap = 28;
	// wrap chips into rows
	const rows: Line[][] = [];
	let row: Line[] = [];
	let rowW = 0;
	for (const item of items) {
		const w = chipWidth(env, item.text, size);
		if (row.length && rowW + gap + w > env.widthUnits * 0.92) {
			rows.push(row);
			row = [];
			rowW = 0;
		}
		row.push(item);
		rowW += (row.length > 1 ? gap : 0) + w;
	}
	if (row.length) rows.push(row);
	const headH = head.reduce((n, l) => n + (l.kind === "kicker" ? 80 : 150), 0);
	const rowH = size * 2.6;
	const totalH = headH + rows.length * rowH;
	let y = -totalH / 2;
	let auto = 0;
	for (const line of head) {
		const h = line.kind === "kicker" ? 80 : 150;
		const tIn = line.at ?? auto;
		if (line.kind === "kicker") kicker(env, line.text, 0, y + h / 2, tIn);
		else staggerLine(env, line.text.toUpperCase(), 0, y + h / 2, sans(128, "900", env.family), env.fg, tIn, { st: 0.04 });
		auto = tIn + 0.3;
		y += h;
	}
	let index = 0;
	for (const r of rows) {
		const widths = r.map((item) => chipWidth(env, item.text, size));
		const total = widths.reduce((a, b) => a + b, 0) + gap * (r.length - 1);
		let x = -total / 2;
		r.forEach((item, k) => {
			const tIn = item.at ?? 0.3 + index * 0.45;
			const dir = r.length === 1 ? "up" : k === 0 ? "left" : k === r.length - 1 ? "right" : "pop";
			const m = slideIn(env, tIn, dir);
			const strong = item.kind === "strong" || item.kind === "accent";
			chip(env, item.text, x + widths[k] / 2, y + rowH / 2, size, strong ? env.accent : "#ffffff", strong ? "#ffffff" : env.ink, m);
			x += widths[k] + gap;
			index += 1;
		});
		y += rowH;
	}
}

function drawTerminal(env: Env, lines: Line[]) {
	const [titleLine, ...rest] = lines;
	const style = mono(48);
	const longest = Math.max(320, ...rest.map((l) => measure(env.ctx, l.text, style)));
	const w = Math.min(env.widthUnits * 0.94, longest + 120);
	const h = 120 + rest.length * 72;
	const { a, dy } = panel(env, w, h, 0, 0, titleLine?.text ?? "terminal", 0);
	if (a <= 0) return;
	let cursor = 0.35;
	rest.forEach((line, k) => {
		const start = line.at ?? cursor;
		const cps = 24;
		const n = Math.max(0, Math.floor((env.t - start) * cps));
		const shown = line.text.slice(0, n);
		const typing = n < line.text.length && env.t >= start;
		const isLast = k === rest.length - 1;
		const caret = (typing || (isLast && env.t >= start)) && Math.floor(env.t * 2.5) % 2 === 0 ? "_" : "";
		const y = -h / 2 + 120 + k * 72 + dy;
		if (env.t >= start) {
			let fit = style;
			const lw = measure(env.ctx, line.text, style);
			if (lw > w - 100) fit = mono((48 * (w - 100)) / lw);
			text(env.ctx, shown + caret, -w / 2 + 50, y, fit, { fill: "#fff4e6", alpha: a, align: "left" });
		}
		cursor = start + line.text.length / cps + 0.35;
	});
}

function drawChecklist(env: Env, lines: Line[]) {
	const [titleLine, ...items] = lines;
	const style = mono(42, "500");
	const longest = Math.max(380, ...items.map((l) => measure(env.ctx, l.text.replace(/^\[[ xX]\]\s*/, ""), style)));
	const w = Math.min(env.widthUnits * 0.94, longest + 220);
	const h = 130 + items.length * 92;
	const { a, dy } = panel(env, w, h, 0, 0, titleLine?.text ?? "todo.md", 0);
	if (a <= 0) return;
	items.forEach((item, k) => {
		const ti = item.at ?? 0.3 + k * 0.9;
		if (env.t < ti) return;
		const done = /^\[[xX]\]/.test(item.text);
		const label = item.text.replace(/^\[[ xX]\]\s*/, "");
		const td = ti + 0.7;
		const pi = eo3(prog(env.t, ti, ti + 0.35));
		const y = -h / 2 + 130 + k * 92 + dy;
		const x0 = -w / 2 + 70;
		const al = a * pi;
		roundRect(env.ctx, x0, y, 44, 44, 9, "transparent", { stroke: "#fff4e6", lineWidth: 4, alpha: al });
		const isDone = done && env.t > td;
		if (done) check(env.ctx, x0 + 4, y - 2, 46, env.accent, prog(env.t, td, td + 0.35), al);
		const color = isDone && env.t > td + 0.2 ? "#968c84" : "#fff4e6";
		text(env.ctx, label, x0 + 50 + (1 - pi) * 30, y, style, { fill: color, alpha: al, align: "left" });
		if (isDone && env.t > td + 0.2) {
			const q = eo3(prog(env.t, td + 0.2, td + 0.5));
			const lw = measure(env.ctx, label, style);
			roundRect(env.ctx, x0 + 50 + (lw * q) / 2, y + 2, Math.max(1, lw * q), 5, 2, "#968c84", { alpha: al });
		}
	});
}

function drawStamp(env: Env, lines: Line[]) {
	const main = lines.find((l) => l.kind !== "accent")?.text ?? "STAMP";
	const sub = lines.find((l) => l.kind === "accent");
	const t0 = 0.1;
	const p = prog(env.t, t0, t0 + 0.25);
	if (env.t < t0) return;
	const po = exitP(env);
	const style = sans(116, "900");
	const tw = Math.min(measure(env.ctx, main.toUpperCase(), style), env.widthUnits * 0.8);
	const w = tw + 140;
	const h = 230;
	const sc = p < 1 ? 2.2 - 1.2 * ei3(p) : 1;
	const shake = env.t > t0 + 0.25 ? Math.sin(env.t * 90) * 10 * (1 - prog(env.t, t0 + 0.25, t0 + 0.55)) : 0;
	const a = clamp(p * 3) * (1 - po);
	const ctx = env.ctx;
	ctx.save();
	ctx.translate(shake, -40);
	ctx.rotate((-7 * Math.PI) / 180);
	ctx.scale(sc, sc);
	roundRect(ctx, 0, 0, w, h, 18, "transparent", { stroke: env.accent, lineWidth: 10, alpha: a });
	roundRect(ctx, 0, 0, w - 36, h - 36, 10, "transparent", { stroke: env.accent, lineWidth: 4, alpha: a });
	let fit = style;
	const mw = measure(ctx, main.toUpperCase(), style);
	if (mw > w - 80) fit = sans((116 * (w - 80)) / mw, "900");
	text(ctx, main.toUpperCase(), 0, 4, fit, { fill: env.accent, alpha: a });
	ctx.restore();
	if (sub) accentLine(env, sub.text, 120, 150, 84, sub.at ?? t0 + 0.55);
}

function drawFlow(env: Env, lines: Line[]) {
	const head = lines.find((l) => l.kind === "kicker");
	const steps = lines.filter((l) => l.kind !== "kicker").slice(0, 4);
	const n = Math.max(1, steps.length);
	const gap = 50;
	const cardW = Math.min(300, (env.widthUnits * 0.94 - gap * (n - 1)) / n);
	const cardH = 300;
	const total = cardW * n + gap * (n - 1);
	if (head) kicker(env, head.text, 0, -cardH / 2 - 80, head.at ?? 0);
	const times = steps.map((s, i) => s.at ?? 0.2 + i * 1.0);
	let active = -1;
	times.forEach((ti, i) => {
		if (env.t >= ti + 0.3) active = i;
	});
	const po = exitP(env);
	steps.forEach((step, i) => {
		const ti = times[i];
		if (env.t < ti) return;
		const [small, big] = step.text.includes("|") ? step.text.split("|").map((s) => s.trim()) : ["", step.text];
		const cx = -total / 2 + cardW / 2 + i * (cardW + gap);
		const p = eback(prog(env.t, ti, ti + 0.45), 1.6);
		const a = clamp(prog(env.t, ti, ti + 0.25)) * (1 - po);
		const y = (1 - p) * 60 - po * 40;
		const hot = i === active;
		roundRect(env.ctx, cx, y, cardW, cardH, 30, hot ? env.accent : "rgba(18,16,16,0.86)", { alpha: a, shadow: 1.2 });
		text(env.ctx, String(i + 1).padStart(2, "0"), cx - cardW / 2 + 40, y - 100, mono(40), { fill: hot ? env.ink : env.accent, alpha: a, align: "left" });
		if (small) {
			let st = serif(64);
			const sw = measure(env.ctx, small, st);
			if (sw > cardW - 30) st = serif((64 * (cardW - 30)) / sw);
			text(env.ctx, small, cx, y - 10, st, { fill: hot ? "#ffffff" : "#fff4e6", alpha: a });
		}
		let bs = sans(46, "800");
		const bw = measure(env.ctx, big, bs);
		if (bw > cardW - 30) bs = sans((46 * (cardW - 30)) / bw, "800");
		text(env.ctx, big, cx, y + 70, bs, { fill: "#ffffff", alpha: a });
		if (i < n - 1 && env.t > times[i + 1] - 0.3) {
			const pa = prog(env.t, times[i + 1] - 0.3, times[i + 1]);
			arrow(env.ctx, cx + cardW / 2 + gap / 2, 0, Math.min(40, gap * 0.8), "#ffffff", pa * (1 - po));
		}
	});
}

function drawMarquee(env: Env, lines: Line[]) {
	const title = lines[0]?.text ?? "";
	const word = (lines[1]?.text ?? lines[0]?.text ?? "MOTION").toUpperCase();
	if (lines.length > 1) staggerLine(env, title.toUpperCase(), 0, -210, sans(130, "900", env.family), env.fg, 0, { mode: "pop", st: 0.05 });
	const po = prog(env.t, env.tOut, env.tOut + EXIT);
	const style = sans(128, "900");
	const unit = `${word} • `;
	const unitW = measure(env.ctx, unit, style);
	const reps = Math.ceil((env.widthUnits * 1.6) / unitW) + 2;
	const rowText = unit.repeat(reps);
	for (let r = 0; r < 3; r++) {
		const y = -50 + r * 130;
		const rp = prog(env.t, 0.45 + r * 0.08, 0.75 + r * 0.08);
		if (rp <= 0) continue;
		const dir = r % 2 === 0 ? -1 : 1;
		const off = (((env.t * 260 * dir) % unitW) + unitW) % unitW;
		const x = -env.widthUnits / 2 - unitW + off;
		const alpha = clamp(rp * 2) * (1 - po);
		if (r === 1) {
			text(env.ctx, rowText, x, y, style, { fill: env.accent, shadow: 0.8, alpha, align: "left" });
		} else {
			env.ctx.save();
			env.ctx.globalAlpha *= alpha;
			setFont(env.ctx, style);
			env.ctx.textAlign = "left";
			env.ctx.textBaseline = "middle";
			env.ctx.lineWidth = 3;
			env.ctx.strokeStyle = env.fg;
			env.ctx.strokeText(rowText, x, y);
			env.ctx.restore();
		}
	}
}

function drawBigword(env: Env, lines: Line[]) {
	const lead = lines.find((l) => l.kind === "accent" || l.kind === "kicker");
	const word = lines.find((l) => l !== lead)?.text ?? "AI";
	const po = exitP(env);
	if (lead) {
		const p = prog(env.t, lead.at ?? 0, (lead.at ?? 0) + 0.5);
		text(env.ctx, lead.text.replace(/^\/\/\s*/, ""), 0, -240 - po * 40, serif(92), {
			fill: "#fff4e6",
			stroke: 2,
			strokeColor: "rgba(60,22,8,0.9)",
			shadow: 1.4,
			alpha: clamp(p * 2) * (1 - po),
		});
	}
	const t0 = lead ? 0.5 : 0;
	const p2 = prog(env.t, t0, t0 + 0.5);
	if (p2 <= 0) return;
	const drift = 1 + 0.04 * prog(env.t, t0 + 0.5, env.tOut);
	let style = sans(400, "900", env.family);
	const w = measure(env.ctx, word.toUpperCase(), style);
	if (w > env.widthUnits * 0.92) style = sans((400 * env.widthUnits * 0.92) / w, "900", env.family);
	text(env.ctx, word.toUpperCase(), 0, 30 - po * 40, style, {
		fill: env.accent,
		shadow: 1,
		alpha: clamp(p2 * 3) * (1 - po),
		scale: (1.6 - 0.6 * eo3(p2)) * drift,
	});
}

function drawProgress(env: Env, lines: Line[]) {
	const title = (lines.find((l) => l.kind !== "accent" && l.kind !== "kicker")?.text ?? "SPEED UP").toUpperCase();
	const label = lines.find((l) => l.kind === "accent")?.text;
	const kick = lines.find((l) => l.kind === "kicker");
	if (kick) kicker(env, kick.text, 0, -230, kick.at ?? 0);
	const po = exitP(env);
	const p = prog(env.t, 0.1, 0.45);
	if (p <= 0) return;
	const a = clamp(p * 2) * (1 - po);
	const barW = Math.min(820, env.widthUnits * 0.85);
	for (let k = 0; k < 7; k++) {
		const yy = -130 + k * 34;
		const span = env.widthUnits + 600;
		const ln = ((env.t * 1600 + k * 397) % span) - span / 2;
		roundRect(env.ctx, ln, yy, 180 + 60 * (k % 3), 6, 3, "rgba(255,255,255,0.55)", { alpha: a * 0.8 });
	}
	let ts = { ...sans(150, "900"), italic: true };
	const tw = measure(env.ctx, title, ts);
	if (tw > env.widthUnits * 0.9) ts = { ...sans((150 * env.widthUnits * 0.9) / tw, "900"), italic: true };
	text(env.ctx, title, (1 - eo3(p)) * -500, -60 - po * 40, ts, { fill: env.fg, shadow: 1, alpha: a });
	const q = eio(prog(env.t, 0.5, 2.3));
	roundRect(env.ctx, 0, 90, barW, 26, 13, "rgba(255,255,255,0.25)", { alpha: a });
	if (q > 0.01) {
		const bw = Math.max(26, barW * q);
		roundRect(env.ctx, -barW / 2 + bw / 2, 90, bw, 26, 13, env.accent, { alpha: 1 - po });
	}
	text(env.ctx, `${Math.round(q * 100)}%`, barW / 2, 160, mono(40), { fill: "#fff4e6", shadow: 1, alpha: a, align: "right" });
	if (label) {
		text(env.ctx, label, -barW / 2, 160, serif(64), {
			fill: "#fff4e6",
			stroke: 2,
			strokeColor: "rgba(60,22,8,0.9)",
			shadow: 1.2,
			alpha: a,
			align: "left",
		});
	}
}

function drawRec(env: Env, lines: Line[]) {
	const label = lines[0]?.text ?? "REC";
	const a = 1 - exitP(env);
	const blink = Math.floor(env.t * 1.6) % 2 === 0 ? 1 : 0.25;
	roundRect(env.ctx, 0, 0, 30, 30, 15, "#eb3434", { alpha: a * blink * clamp(env.t * 4) });
	text(env.ctx, label, 34, 0, mono(40), { fill: "#ffffff", shadow: 1, alpha: a * clamp(env.t * 4), align: "left" });
}

// ================================================================ more presets (v2)

const rand = (seed: number) => {
	const x = Math.sin(seed * 12.9898) * 43758.5453;
	return x - Math.floor(x);
};

function wrapWords(ctx: Ctx, value: string, style: Style, maxWidth: number): string[] {
	const words = value.split(/\s+/).filter(Boolean);
	const out: string[] = [];
	let line = "";
	for (const word of words) {
		const next = line ? `${line} ${word}` : word;
		if (line && measure(ctx, next, style) > maxWidth) {
			out.push(line);
			line = word;
		} else line = next;
	}
	if (line) out.push(line);
	return out;
}

function fitStyle(ctx: Ctx, value: string, style: Style, maxWidth: number): Style {
	const w = measure(ctx, value, style);
	return w > maxWidth ? { ...style, size: (style.size * maxWidth) / w } : style;
}

const plainLines = (lines: Line[]) => lines.filter((l) => l.kind === "plain" || l.kind === "strong" || l.kind === "title");

function drawLowerThird(env: Env, lines: Line[]) {
	const { ctx, t } = env;
	const name = plainLines(lines)[0]?.text ?? "Your Name";
	const role = lines.find((l) => l.kind === "accent")?.text ?? plainLines(lines)[1]?.text;
	const po = exitP(env);
	const x0 = -env.widthUnits / 2 + 70;
	const nameStyle = fitStyle(ctx, name, sans(92, "900", env.family), env.widthUnits - 220);
	const nameW = measure(ctx, name, nameStyle) + 70;
	const roleStyle = mono(38, "700");
	const roleW = role ? measure(ctx, role.toUpperCase(), roleStyle) + 50 : 0;
	const barH = eo3(prog(t, 0, 0.35)) * (role ? 200 : 120);
	roundRect(ctx, x0 + 6, -10 + (role ? 30 : 0) - (role ? 100 : 60) + barH / 2, 12, Math.max(1, barH), 6, env.accent, { alpha: 1 - po });
	const wipe = (start: number, w: number, y: number, h: number, fill: string) => {
		const p = eo3(prog(t, start, start + 0.45));
		if (p <= 0) return 0;
		ctx.save();
		ctx.beginPath();
		ctx.rect(x0 + 24, y - h / 2 - 20, w * p + 4, h + 40);
		ctx.clip();
		roundRect(ctx, x0 + 24 + w / 2, y, w, h, 10, fill, { alpha: 1 - po, shadow: 1 });
		return p;
	};
	const p1 = wipe(0.2, nameW, -40, 130, "rgba(16,14,14,0.88)");
	if (p1 > 0) {
		text(ctx, name, x0 + 24 + 35 + (1 - p1) * -30, -36, nameStyle, { fill: env.fg, alpha: (1 - po) * clamp(p1 * 1.5), align: "left" });
		ctx.restore();
	}
	if (role) {
		const p2 = wipe(0.45, roleW, 70, 70, env.accent);
		if (p2 > 0) {
			text(ctx, role.toUpperCase(), x0 + 24 + 25, 72, roleStyle, { fill: "#ffffff", alpha: (1 - po) * clamp(p2 * 1.5), align: "left" });
			ctx.restore();
		}
	}
}

function drawChapter(env: Env, lines: Line[]) {
	const { ctx, t } = env;
	const label = (lines[0]?.text ?? "PART 01").replace(/^\/\/\s*/, "");
	const title = lines.slice(1).map((l) => l.text).join(" ") || "CHAPTER";
	const po = exitP(env);
	const lw = Math.min(env.widthUnits * 0.8, 640) * eio(prog(t, 0.15, 0.7));
	roundRect(ctx, 0, -10, Math.max(1, lw), 6, 3, env.accent, { alpha: 1 - po });
	const lp = slideIn(env, 0, "up", 0.4);
	ctx.save();
	if ("letterSpacing" in ctx) ctx.letterSpacing = "10px";
	text(ctx, label.toUpperCase(), 0, -80 + lp.dy, mono(46, "700"), { fill: env.accent, shadow: 1, alpha: lp.alpha });
	ctx.restore();
	staggerLine(env, title.toUpperCase(), 0, 80, sans(130, "900", env.family), env.fg, 0.55, { st: 0.035 });
}

function drawWedding(env: Env, lines: Line[]) {
	const { ctx, t } = env;
	const kickerText = lines.find((l) => l.kind === "kicker")?.text.replace(/^\/\/\s*/, "") ?? "THE WEDDING OF";
	const names = plainLines(lines)[0]?.text ?? "Ariff & Sarah";
	const date = lines.find((l) => l.kind === "accent")?.text ?? plainLines(lines)[1]?.text ?? "";
	const po = exitP(env);
	const kp = prog(t, 0, 0.8);
	ctx.save();
	if ("letterSpacing" in ctx) ctx.letterSpacing = "14px";
	text(ctx, kickerText.toUpperCase(), 0, -170, mono(30, "500"), { fill: "#fff4e6", shadow: 1, alpha: kp * (1 - po) });
	ctx.restore();
	// names: soft letter-by-letter fade
	const style = fitStyle(ctx, names, serif(170), env.widthUnits * 0.9);
	setFont(ctx, style);
	const total = ctx.measureText(names).width;
	let x = -total / 2;
	[...names].forEach((ch, i) => {
		const cw = ctx.measureText(ch).width;
		const p = eo3(prog(t, 0.35 + i * 0.06, 0.35 + i * 0.06 + 0.7));
		if (p > 0) {
			text(ctx, ch, x + cw / 2, -20 + (1 - p) * 26 - po * 30, style, {
				fill: ch === "&" ? env.accent : env.fg,
				shadow: 1.2,
				alpha: p * (1 - po),
			});
		}
		x += cw;
	});
	if (date) {
		const dp = eio(prog(t, 0.9, 1.6));
		const ds = mono(38, "500");
		const dw = measure(ctx, date, ds);
		text(ctx, date, 0, 130, ds, { fill: "#fff4e6", shadow: 1, alpha: dp * (1 - po) });
		const lineW = 150 * dp;
		roundRect(ctx, -dw / 2 - 40 - lineW / 2, 130, Math.max(1, lineW), 3, 1, env.accent, { alpha: 1 - po });
		roundRect(ctx, dw / 2 + 40 + lineW / 2, 130, Math.max(1, lineW), 3, 1, env.accent, { alpha: 1 - po });
	}
}

function drawGlitch(env: Env, lines: Line[]) {
	const { ctx, t } = env;
	const value = (plainLines(lines)[0]?.text ?? "GLITCH").toUpperCase();
	const sub = lines.find((l) => l.kind === "accent");
	const po = exitP(env);
	const style = fitStyle(ctx, value, sans(170, "900", env.family), env.widthUnits * 0.9);
	const step = Math.floor(t * 20);
	const burst = t < 0.7 || (t % 1.6 > 1.45);
	const amp = burst ? 1 : 0;
	const a = clamp(t * 6) * (1 - po);
	if (a <= 0) return;
	ctx.save();
	ctx.globalCompositeOperation = "lighter";
	const off = amp * (6 + rand(step) * 18);
	text(ctx, value, -off, 0, style, { fill: "rgba(0,255,255,0.75)", alpha: a });
	text(ctx, value, off, 0, style, { fill: "rgba(255,0,90,0.75)", alpha: a });
	ctx.restore();
	text(ctx, value, 0, 0, style, { fill: env.fg, shadow: 1, alpha: a });
	if (amp) {
		// displaced slices
		for (let k = 0; k < 3; k++) {
			const y = (rand(step * 3 + k) - 0.5) * style.size;
			const h = 8 + rand(step * 7 + k) * 24;
			const dx = (rand(step * 5 + k) - 0.5) * 60;
			ctx.save();
			ctx.beginPath();
			ctx.rect(-env.widthUnits / 2, y, env.widthUnits, h);
			ctx.clip();
			roundRect(ctx, 0, y + h / 2, env.widthUnits, h, 0, "rgba(16,14,14,0.6)", { alpha: a });
			text(ctx, value, dx, 0, style, { fill: env.accent, alpha: a });
			ctx.restore();
		}
	}
	if (sub) {
		const sp = Math.floor(Math.max(0, t - 0.6) * 28);
		text(ctx, sub.text.slice(0, sp) + (sp < sub.text.length && Math.floor(t * 4) % 2 ? "_" : ""), 0, style.size * 0.75, mono(40), { fill: env.accent, shadow: 1, alpha: 1 - po });
	}
}

function drawWordSwap(env: Env, lines: Line[]) {
	const { ctx, t } = env;
	const [prefixLine, ...rest] = lines;
	const prefix = prefixLine?.text ?? "Claude boleh edit";
	const words = rest.map((l) => l.text).filter(Boolean);
	if (!words.length) words.push("video");
	const po = exitP(env);
	staggerLine(env, prefix.toUpperCase(), 0, -90, sans(110, "900", env.family), env.fg, 0, { st: 0.03 });
	const start = 0.5;
	const span = Math.max(0.6, (env.tOut - start) / words.length);
	const idx = Math.min(words.length - 1, Math.max(0, Math.floor((t - start) / span)));
	const local = t - start - idx * span;
	const style = sans(120, "900", env.family);
	const wCur = measure(ctx, words[idx].toUpperCase(), style);
	const wPrev = idx > 0 ? measure(ctx, words[idx - 1].toUpperCase(), style) : wCur;
	const swap = idx > 0 ? eback(clamp(local / 0.35), 1.4) : eback(prog(t, start, start + 0.4), 1.4);
	const boxW = (idx > 0 ? wPrev + (wCur - wPrev) * clamp(swap) : wCur) + 70;
	const a = prog(t, start, start + 0.2) * (1 - po);
	roundRect(ctx, 0, 70, boxW, 160, 24, env.accent, { alpha: a, shadow: 1 });
	ctx.save();
	ctx.beginPath();
	ctx.rect(-boxW / 2, -10, boxW, 160);
	ctx.clip();
	text(ctx, words[idx].toUpperCase(), 0, 74 + (1 - swap) * 150, style, { fill: "#ffffff", alpha: a });
	if (idx > 0 && swap < 1) text(ctx, words[idx - 1].toUpperCase(), 0, 74 - swap * 150, style, { fill: "#ffffff", alpha: a });
	ctx.restore();
}

function pinIcon(ctx: Ctx, cx: number, cy: number, size: number, color: string, alpha: number) {
	if (alpha <= 0) return;
	ctx.save();
	ctx.globalAlpha *= alpha;
	ctx.translate(cx, cy);
	ctx.fillStyle = color;
	ctx.shadowColor = "rgba(0,0,0,0.4)";
	ctx.shadowBlur = 16;
	ctx.beginPath();
	const r = size * 0.36;
	ctx.arc(0, -size * 0.18, r, Math.PI * 0.8, Math.PI * 2.2);
	ctx.lineTo(0, size * 0.5);
	ctx.closePath();
	ctx.fill();
	ctx.shadowColor = "transparent";
	ctx.fillStyle = "#ffffff";
	ctx.beginPath();
	ctx.arc(0, -size * 0.18, r * 0.42, 0, Math.PI * 2);
	ctx.fill();
	ctx.restore();
}

function drawLocation(env: Env, lines: Line[]) {
	const { ctx, t } = env;
	const place = plainLines(lines)[0]?.text ?? "Kuala Lumpur";
	const sub = lines.find((l) => l.kind === "accent")?.text ?? plainLines(lines)[1]?.text;
	const po = exitP(env);
	const style = fitStyle(ctx, place.toUpperCase(), sans(84, "900", env.family), env.widthUnits - 300);
	const tw = measure(ctx, place.toUpperCase(), style);
	const total = 130 + tw;
	const x0 = -total / 2;
	const drop = prog(t, 0, 0.5);
	const bounce = drop < 1 ? (1 - eback(drop, 3)) * -160 : 0;
	pinIcon(ctx, x0 + 50, -10 + bounce - po * 30, 110, env.accent, clamp(drop * 3) * (1 - po));
	const wp = eo3(prog(t, 0.4, 0.9));
	if (wp > 0) {
		ctx.save();
		ctx.beginPath();
		ctx.rect(x0 + 120, -120, (tw + 30) * wp, 260);
		ctx.clip();
		text(ctx, place.toUpperCase(), x0 + 130, -24 - po * 30, style, { fill: env.fg, shadow: 1, alpha: 1 - po, align: "left" });
		if (sub) text(ctx, sub, x0 + 132, 50 - po * 30, mono(36, "500"), { fill: "#fff4e6", shadow: 1, alpha: (1 - po) * prog(t, 0.7, 1.0), align: "left" });
		ctx.restore();
	}
}

function formatCount(value: number, decimals: number, commas: boolean) {
	const fixed = value.toFixed(decimals);
	if (!commas) return fixed;
	const [int, dec] = fixed.split(".");
	return int.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (dec ? `.${dec}` : "");
}

function drawCounter(env: Env, lines: Line[]) {
	const { ctx, t } = env;
	const kick = lines.find((l) => l.kind === "kicker");
	const label = lines.find((l) => l.kind === "accent");
	const raw = plainLines(lines)[0]?.text ?? "100%";
	const m = /^(.*?)(\d[\d,]*(?:\.\d+)?)(.*)$/.exec(raw);
	const po = exitP(env);
	if (kick) kicker(env, kick.text, 0, -230, kick.at ?? 0);
	let shown = raw;
	if (m) {
		const target = Number(m[2].replace(/,/g, ""));
		const decimals = m[2].includes(".") ? m[2].split(".")[1].length : 0;
		const q = eo3(prog(t, 0.15, 1.6));
		shown = `${m[1]}${formatCount(target * q, decimals, m[2].includes(","))}${m[3]}`;
	}
	const style = fitStyle(ctx, raw, sans(300, "900", env.family), env.widthUnits * 0.92);
	const pop = eback(prog(t, 0.05, 0.4), 2);
	const settle = t > 1.6 ? 1 + 0.06 * Math.sin(Math.PI * prog(t, 1.6, 1.85)) : 1;
	text(ctx, shown, 0, -20 - po * 40, style, { fill: env.accent, shadow: 1, alpha: clamp(pop * 2) * (1 - po), scale: (0.6 + 0.4 * pop) * settle });
	if (label) accentLine(env, label.text, 0, style.size * 0.62, 90, label.at ?? 0.6);
}

function drawList(env: Env, lines: Line[]) {
	const { ctx } = env;
	const head = lines.find((l) => l.kind === "title" || l.kind === "kicker");
	const items = lines.filter((l) => l !== head);
	const rowH = 118;
	const headH = head ? 160 : 0;
	const totalH = headH + items.length * rowH;
	let y = -totalH / 2;
	if (head) {
		if (head.kind === "kicker") kicker(env, head.text, 0, y + 60, head.at ?? 0);
		else staggerLine(env, head.text.toUpperCase(), 0, y + 70, sans(120, "900", env.family), env.fg, head.at ?? 0, { st: 0.035 });
		y += headH;
	}
	const maxW = Math.min(env.widthUnits * 0.9, 920);
	const x0 = -maxW / 2;
	items.forEach((item, i) => {
		const ti = item.at ?? 0.4 + i * 0.6;
		const m = slideIn(env, ti, "left", 0.45);
		if (m.alpha <= 0) return;
		const cy = y + rowH / 2 + i * rowH;
		const label = item.text.replace(/^\d+[.)]?\s*/, "");
		roundRect(ctx, x0 + 50 + m.dx, cy + m.dy, 100, 100, 22, env.accent, { alpha: m.alpha, shadow: 1 });
		text(ctx, String(i + 1), x0 + 50 + m.dx, cy + m.dy + 3, sans(64, "900"), { fill: "#ffffff", alpha: m.alpha });
		const ls = fitStyle(ctx, label, sans(62, "800", env.family), maxW - 140);
		text(ctx, label, x0 + 125 + m.dx, cy + m.dy, ls, { fill: env.fg, shadow: 1, alpha: m.alpha, align: "left" });
	});
}

function drawVersus(env: Env, lines: Line[]) {
	const { ctx, t } = env;
	const sides = plainLines(lines).filter((l) => !/^vs\.?$/i.test(l.text)).slice(0, 2);
	const left = sides[0]?.text ?? "ChatGPT";
	const right = sides[1]?.text ?? "Claude";
	const kick = lines.find((l) => l.kind === "kicker");
	const po = exitP(env);
	if (kick) kicker(env, kick.text, 0, -230, kick.at ?? 0);
	const gap = 120;
	const cardW = Math.min(420, (env.widthUnits * 0.94 - gap) / 2);
	const cards: Array<[string, number, string, string, number]> = [
		[left, -(cardW + gap) / 2, "#ffffff", env.ink, 0.1],
		[right, (cardW + gap) / 2, env.accent, "#ffffff", 0.35],
	];
	cards.forEach(([value, cx, bg, fg, ti], k) => {
		const p = eback(prog(t, ti, ti + 0.5), 1.4);
		if (t < ti) return;
		const [main, sub] = value.split("|").map((s) => s.trim());
		const dx = (1 - p) * (k === 0 ? -400 : 400);
		const a = clamp(prog(t, ti, ti + 0.3)) * (1 - po);
		roundRect(ctx, cx + dx, 0 - po * 30, cardW, 280, 30, bg, { alpha: a, shadow: 1.2, rotate: k === 0 ? -2 : 2 });
		const ms = fitStyle(ctx, main, sans(80, "900", env.family), cardW - 50);
		text(ctx, main, cx + dx, (sub ? -25 : 0) - po * 30, ms, { fill: fg, alpha: a, rotate: k === 0 ? -2 : 2 });
		if (sub) text(ctx, sub, cx + dx, 60 - po * 30, serif(52), { fill: fg, alpha: a, rotate: k === 0 ? -2 : 2 });
	});
	const vp = prog(t, 0.6, 0.85);
	if (vp > 0) {
		const shake = t < 1.0 ? Math.sin(t * 80) * 6 * (1 - prog(t, 0.85, 1.0)) : 0;
		const sc = 2 - eback(vp, 2);
		roundRect(ctx, shake, 0, 130, 130, 65, env.ink, { alpha: (1 - po), shadow: 1.2, scale: sc, stroke: env.fg, lineWidth: 6 });
		text(ctx, "VS", shake, 4, sans(56, "900"), { fill: env.fg, alpha: 1 - po, scale: sc });
	}
}

function drawNotification(env: Env, lines: Line[]) {
	const { ctx, t } = env;
	const items = lines.map((l) => l.text);
	const app = items[0] ?? "Claude";
	const title = items[1] ?? "Video siap!";
	const body = items[2];
	const po = exitP(env);
	const w = Math.min(env.widthUnits * 0.92, 940);
	const h = body ? 230 : 180;
	const p = prog(t, 0, 0.55);
	const y = (1 - eback(p, 1.6)) * -400 - po * 300;
	const a = clamp(p * 3) * (1 - prog(t, env.tOut, env.tOut + EXIT));
	roundRect(ctx, 0, y, w, h, 46, "rgba(245,242,238,0.95)", { alpha: a, shadow: 1.4 });
	const x0 = -w / 2 + 40;
	const top = y - h / 2;
	roundRect(ctx, x0 + 45, top + 70, 90, 90, 22, env.accent, { alpha: a });
	text(ctx, app.slice(0, 1).toUpperCase(), x0 + 45, top + 73, sans(56, "900"), { fill: "#ffffff", alpha: a });
	text(ctx, app.toUpperCase(), x0 + 115, top + 46, sans(30, "800"), { fill: "#6d655f", alpha: a, align: "left" });
	text(ctx, "now", w / 2 - 40, top + 46, sans(30, "800"), { fill: "#9a918a", alpha: a, align: "right" });
	const ts = fitStyle(ctx, title, sans(44, "900"), w - 200);
	text(ctx, title, x0 + 115, top + 100, ts, { fill: env.ink, alpha: a, align: "left" });
	if (body) {
		const bs = fitStyle(ctx, body, sans(38, "800"), w - 200);
		text(ctx, body, x0 + 115, top + 160, bs, { fill: "#4a4440", alpha: a, align: "left" });
	}
}

function drawChat(env: Env, lines: Line[]) {
	const { ctx, t } = env;
	const msgs = lines.map((l) => {
		const mine = l.text.startsWith(">");
		return { mine, text: l.text.replace(/^[<>]\s*/, ""), at: l.at };
	});
	const style = sans(46, "800");
	const maxW = Math.min(env.widthUnits * 0.7, 700);
	const laid = msgs.map((m) => {
		const rows = wrapWords(ctx, m.text, style, maxW - 70);
		const w = Math.max(...rows.map((r) => measure(ctx, r, style))) + 70;
		return { ...m, rows, w, h: rows.length * 58 + 44 };
	});
	const gap = 26;
	const totalH = laid.reduce((n, m) => n + m.h + gap, -gap);
	let y = -totalH / 2;
	let cursor = 0.1;
	const po = exitP(env);
	const half = Math.min(env.widthUnits * 0.46, 480);
	laid.forEach((m) => {
		const typing = m.mine ? 0 : 0.55;
		const ti = (m.at ?? cursor) + typing;
		const cy = y + m.h / 2;
		const cx = m.mine ? half - m.w / 2 : -half + m.w / 2;
		if (!m.mine && t >= ti - typing && t < ti) {
			// typing dots
			roundRect(ctx, -half + 75, cy, 150, 80, 40, "#ffffff", { alpha: 1 - po, shadow: 1 });
			for (let k = 0; k < 3; k++) {
				const b = Math.sin((t * 8) - k * 0.8) * 6;
				roundRect(ctx, -half + 40 + k * 35, cy + b, 18, 18, 9, "#9a918a", { alpha: 1 - po });
			}
		}
		const p = eback(prog(t, ti, ti + 0.35), 2);
		if (t >= ti) {
			const a = clamp(p * 2) * (1 - po);
			ctx.save();
			ctx.translate(m.mine ? cx + m.w / 2 : cx - m.w / 2, cy + m.h / 2);
			ctx.scale(0.4 + 0.6 * p, 0.4 + 0.6 * p);
			ctx.translate(-(m.mine ? cx + m.w / 2 : cx - m.w / 2), -(cy + m.h / 2));
			roundRect(ctx, cx, cy - po * 30, m.w, m.h, 34, m.mine ? env.accent : "#ffffff", { alpha: a, shadow: 1 });
			m.rows.forEach((row, r) => {
				text(ctx, row, cx - m.w / 2 + 35, cy - m.h / 2 + 22 + 29 + r * 58 - po * 30, style, { fill: m.mine ? "#ffffff" : env.ink, alpha: a, align: "left" });
			});
			ctx.restore();
		}
		cursor = ti + 0.9;
		y += m.h + gap;
	});
}

function cursorIcon(ctx: Ctx, x: number, y: number, size: number, alpha: number) {
	if (alpha <= 0) return;
	ctx.save();
	ctx.globalAlpha *= alpha;
	ctx.translate(x, y);
	ctx.scale(size / 100, size / 100);
	ctx.beginPath();
	ctx.moveTo(0, 0);
	ctx.lineTo(0, 78);
	ctx.lineTo(20, 60);
	ctx.lineTo(34, 92);
	ctx.lineTo(48, 86);
	ctx.lineTo(34, 55);
	ctx.lineTo(60, 55);
	ctx.closePath();
	ctx.shadowColor = "rgba(0,0,0,0.4)";
	ctx.shadowBlur = 10;
	ctx.fillStyle = "#ffffff";
	ctx.fill();
	ctx.shadowColor = "transparent";
	ctx.lineWidth = 6;
	ctx.strokeStyle = "#100e0e";
	ctx.stroke();
	ctx.restore();
}

function drawCta(env: Env, lines: Line[]) {
	const { ctx, t } = env;
	const caption = lines.find((l) => l.kind === "accent");
	const labels = plainLines(lines);
	const before = (labels[0]?.text ?? "FOLLOW").toUpperCase();
	const after = (labels[1]?.text ?? "FOLLOWING").toUpperCase();
	const po = exitP(env);
	const clickAt = 1.1;
	const clicked = t >= clickAt;
	const label = clicked ? after : before;
	const style = sans(70, "900", env.family);
	const w = Math.max(measure(ctx, before, style), measure(ctx, after, style) + 70) + 120;
	const pIn = eback(prog(t, 0, 0.45), 1.8);
	const press = t > clickAt - 0.08 && t < clickAt + 0.2 ? 1 - 0.08 * Math.sin(Math.PI * prog(t, clickAt - 0.08, clickAt + 0.2)) : 1;
	const a = clamp(pIn * 2) * (1 - po);
	if (caption) accentLine(env, caption.text, 0, -170, 84, caption.at ?? 0.2);
	roundRect(ctx, 0, 0 - po * 30, w, 150, 75, clicked ? "#2a2523" : env.accent, { alpha: a, shadow: 1.2, scale: (0.5 + 0.5 * pIn) * press });
	const tw = measure(ctx, label, style);
	const textX = clicked ? 35 : 0;
	text(ctx, label, textX, 4 - po * 30, style, { fill: "#ffffff", alpha: a, scale: (0.5 + 0.5 * pIn) * press });
	if (clicked) check(ctx, textX - tw / 2 - 45, -2 - po * 30, 50, env.accent, prog(t, clickAt, clickAt + 0.3), a);
	// cursor glides in, clicks, leaves
	const cp = eio(prog(t, 0.35, clickAt - 0.05));
	const cx = 420 - (420 - w * 0.22) * cp + eio(prog(t, clickAt + 0.5, clickAt + 1.0)) * 300;
	const cy = 300 - 290 * cp + eio(prog(t, clickAt + 0.5, clickAt + 1.0)) * 200;
	const ca = prog(t, 0.35, 0.5) * (1 - prog(t, clickAt + 0.7, clickAt + 1.0)) * (1 - po);
	if (t > clickAt && t < clickAt + 0.4) {
		const rp = prog(t, clickAt, clickAt + 0.4);
		ctx.save();
		ctx.globalAlpha *= (1 - rp) * (1 - po);
		ctx.strokeStyle = "#ffffff";
		ctx.lineWidth = 5;
		ctx.beginPath();
		ctx.arc(cx, cy, 20 + rp * 60, 0, Math.PI * 2);
		ctx.stroke();
		ctx.restore();
	}
	cursorIcon(ctx, cx, cy, t > clickAt - 0.08 && t < clickAt + 0.12 ? 82 : 90, ca);
}

function drawHighlight(env: Env, lines: Line[]) {
	const { ctx, t } = env;
	const raw = lines.map((l) => l.text).join(" ");
	const tokens = raw.split(/\s+/).filter(Boolean).map((tok) => {
		const marked = /^\*.*\*?$/.test(tok) || tok.startsWith("*");
		return { text: tok.replace(/\*/g, "").toUpperCase(), marked };
	});
	if (!tokens.some((tk) => tk.marked) && tokens.length) tokens[tokens.length - 1].marked = true;
	const style = sans(116, "900", env.family);
	const space = 34;
	const maxW = env.widthUnits * 0.88;
	const rows: Array<typeof tokens> = [];
	let row: typeof tokens = [];
	let rw = 0;
	for (const tk of tokens) {
		const w = measure(ctx, tk.text, style);
		if (row.length && rw + space + w > maxW) {
			rows.push(row);
			row = [];
			rw = 0;
		}
		row.push(tk);
		rw += (row.length > 1 ? space : 0) + w;
	}
	if (row.length) rows.push(row);
	const lh = 150;
	const po = exitP(env);
	let index = 0;
	let markIndex = 0;
	const markStart = 0.25 + tokens.length * 0.06;
	rows.forEach((r, ri) => {
		const widths = r.map((tk) => measure(ctx, tk.text, style));
		const total = widths.reduce((a, b) => a + b, 0) + space * (r.length - 1);
		let x = -total / 2;
		const cy = (ri - (rows.length - 1) / 2) * lh;
		r.forEach((tk, k) => {
			const w = widths[k];
			if (tk.marked) {
				const mp = eio(prog(t, markStart + markIndex * 0.35, markStart + markIndex * 0.35 + 0.4));
				markIndex += 1;
				if (mp > 0) {
					ctx.save();
					ctx.globalAlpha *= 1 - po;
					ctx.fillStyle = env.accent;
					ctx.beginPath();
					ctx.roundRect(x - 16, cy - 62 - po * 40, (w + 32) * mp, 128, 14);
					ctx.fill();
					ctx.restore();
				}
			}
			const p = prog(t, 0.05 + index * 0.06, 0.05 + index * 0.06 + 0.4);
			if (p > 0) {
				text(ctx, tk.text, x + w / 2, cy + (1 - eback(p, 2)) * 50 - po * 40, style, { fill: env.fg, shadow: tk.marked ? 0.3 : 1, alpha: clamp(p * 2.5) * (1 - po) });
			}
			index += 1;
			x += w + space;
		});
	});
}

function drawStrike(env: Env, lines: Line[]) {
	const { ctx, t } = env;
	const items = plainLines(lines);
	const oldText = (items[0]?.text ?? "EDIT MANUAL").toUpperCase();
	const newText = (items[1]?.text ?? lines.find((l) => l.kind === "accent")?.text ?? "GUNA AI").toUpperCase();
	const po = exitP(env);
	const os = fitStyle(ctx, oldText, sans(110, "900", env.family), env.widthUnits * 0.85);
	const ow = measure(ctx, oldText, os);
	const m = slideIn(env, 0, "up", 0.4);
	const struck = t > 0.9;
	text(ctx, oldText, 0, -90 + m.dy, os, { fill: struck ? "#b9b0a8" : env.fg, shadow: 1, alpha: m.alpha * (struck ? 0.8 : 1) });
	const sp = eio(prog(t, 0.7, 1.05));
	if (sp > 0) {
		ctx.save();
		ctx.globalAlpha *= 1 - po;
		ctx.strokeStyle = env.accent;
		ctx.lineWidth = 16;
		ctx.lineCap = "round";
		ctx.beginPath();
		ctx.moveTo(-ow / 2 - 20, -80 - po * 40);
		ctx.lineTo(-ow / 2 - 20 + (ow + 40) * sp, -100 - po * 40);
		ctx.stroke();
		ctx.restore();
	}
	staggerLine(env, newText, 0, 80, sans(150, "900", env.family), env.accent, 1.15, { mode: "pop", st: 0.05 });
}

function drawQuote(env: Env, lines: Line[]) {
	const { ctx, t } = env;
	const attribution = lines.find((l) => /^[-—–]/.test(l.text));
	const body = lines.filter((l) => l !== attribution).map((l) => l.text).join(" ");
	const po = exitP(env);
	const style = serif(96);
	const rows = wrapWords(ctx, body, style, Math.min(env.widthUnits * 0.84, 900));
	const lh = 112;
	const top = -((rows.length - 1) * lh) / 2;
	const qp = eback(prog(t, 0, 0.45), 2.2);
	text(ctx, "“", -Math.min(env.widthUnits * 0.42, 450) + 60, top - 110, serif(320), { fill: env.accent, shadow: 1, alpha: clamp(qp * 2) * (1 - po), scale: 0.5 + 0.5 * qp });
	let wi = 0;
	rows.forEach((row, ri) => {
		const words = row.split(" ");
		const total = measure(ctx, row, style);
		let x = -total / 2;
		setFont(ctx, style);
		const spaceW = ctx.measureText(" ").width;
		words.forEach((word) => {
			const w = measure(ctx, word, style);
			const p = eo3(prog(t, 0.3 + wi * 0.09, 0.3 + wi * 0.09 + 0.5));
			if (p > 0) {
				text(ctx, word, x + w / 2, top + ri * lh + (1 - p) * 20 - po * 40, style, {
					fill: env.fg,
					stroke: 2,
					strokeColor: "rgba(16,14,14,0.6)",
					shadow: 1.3,
					alpha: p * (1 - po),
				});
			}
			x += w + spaceW;
			wi += 1;
		});
	});
	if (attribution) {
		const at = attribution.at ?? 0.5 + wi * 0.09;
		const m = slideIn(env, at, "up", 0.4);
		text(ctx, attribution.text.toUpperCase(), 0, top + rows.length * lh + 30 + m.dy, mono(36, "700"), { fill: env.accent, shadow: 1, alpha: m.alpha });
	}
}

function drawArrowNote(env: Env, lines: Line[]) {
	const { ctx, t } = env;
	const label = plainLines(lines)[0]?.text ?? lines[0]?.text ?? "ni dia!";
	const po = exitP(env);
	const lp = eback(prog(t, 0, 0.4), 2);
	text(ctx, label, -60, -150 - po * 30, serif(110), {
		fill: env.accent,
		stroke: 2,
		strokeColor: "rgba(60,22,8,0.9)",
		shadow: 1.4,
		alpha: clamp(lp * 2) * (1 - po),
		scale: 0.6 + 0.4 * lp,
		rotate: -6,
	});
	// hand-drawn curve from under the label to bottom-right
	const p0 = [-40, -80];
	const c = [260, -60];
	const p1 = [220, 170];
	const dp = eio(prog(t, 0.3, 0.9));
	if (dp <= 0) return;
	ctx.save();
	ctx.globalAlpha *= 1 - po;
	ctx.translate(0, -po * 30);
	ctx.strokeStyle = env.fg;
	ctx.lineWidth = 12;
	ctx.lineCap = "round";
	ctx.lineJoin = "round";
	ctx.shadowColor = "rgba(0,0,0,0.45)";
	ctx.shadowBlur = 10;
	const pts: Array<[number, number]> = [];
	const steps = 40;
	for (let i = 0; i <= Math.round(steps * dp); i++) {
		const u = i / steps;
		const wob = Math.sin(u * 9) * 3;
		pts.push([
			(1 - u) ** 2 * p0[0] + 2 * (1 - u) * u * c[0] + u * u * p1[0] + wob,
			(1 - u) ** 2 * p0[1] + 2 * (1 - u) * u * c[1] + u * u * p1[1],
		]);
	}
	ctx.beginPath();
	pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
	ctx.stroke();
	if (dp > 0.97 && pts.length > 2) {
		const [ex, ey] = pts[pts.length - 1];
		const [px, py] = pts[pts.length - 3];
		const ang = Math.atan2(ey - py, ex - px);
		const hp = eback(prog(t, 0.88, 1.05), 2.5);
		const len = 50 * hp;
		ctx.beginPath();
		ctx.moveTo(ex + Math.cos(ang + 2.5) * len, ey + Math.sin(ang + 2.5) * len);
		ctx.lineTo(ex, ey);
		ctx.lineTo(ex + Math.cos(ang - 2.5) * len, ey + Math.sin(ang - 2.5) * len);
		ctx.stroke();
	}
	ctx.restore();
}

const LOTTIE_UNITS = 900;

function lottiePlaceholder(env: Env, message: string) {
	const { ctx } = env;
	ctx.save();
	ctx.setLineDash([24, 16]);
	roundRect(ctx, 0, 0, 760, 300, 30, "rgba(16,14,14,0.55)", { stroke: env.accent, lineWidth: 6 });
	ctx.restore();
	text(ctx, "LOTTIE", 0, -50, mono(40), { fill: env.accent });
	text(ctx, message, 0, 30, fitStyle(ctx, message, sans(44, "800"), 700), { fill: "#fff4e6" });
}

function drawLottie(env: Env, input: MotionDrawInput) {
	const id = input.assetId;
	if (!id) {
		lottiePlaceholder(env, "Pick an animation in Motion → Lottie");
		return;
	}
	const player = getLottiePlayer({ id });
	if (!player) {
		if (isLottieMissing({ id })) lottiePlaceholder(env, "Not in this browser's Lottie library");
		return;
	}
	const aspect = player.meta.height / player.meta.width;
	const w = LOTTIE_UNITS;
	const h = w * aspect;
	const frame = player.frameAt({
		seconds: env.t,
		clipDuration: input.duration,
		playback: readLottiePlayback(input.playback),
	});
	const canvas = player.render({ frame });
	env.ctx.drawImage(canvas, -w / 2, -h / 2, w, h);
}

const CAPTION_UNITS = 133;

function drawCaptions(env: Env, words: MotionWord[], variant: "box" | "pop") {
	const { ctx, t } = env;
	if (!words.length) return;
	const style = sans(CAPTION_UNITS, "900", env.family);
	const space = CAPTION_UNITS * 0.29;
	const tokens = words.map((w) => w.w.toUpperCase());
	const widths = tokens.map((tok) => measure(ctx, tok, style));
	const maxW = env.widthUnits * 0.9;
	// split into at most two balanced lines when too wide
	let lines: number[][] = [tokens.map((_, i) => i)];
	const total = widths.reduce((a, b) => a + b, 0) + space * (tokens.length - 1);
	if (total > maxW && tokens.length > 1) {
		let best = Number.POSITIVE_INFINITY;
		let split = 1;
		for (let k = 1; k < tokens.length; k++) {
			const a = widths.slice(0, k).reduce((x, y) => x + y, 0) + space * (k - 1);
			const b = widths.slice(k).reduce((x, y) => x + y, 0) + space * (tokens.length - k - 1);
			if (Math.max(a, b) < best) {
				best = Math.max(a, b);
				split = k;
			}
		}
		lines = [lines[0].slice(0, split), lines[0].slice(split)];
	}
	const lineWidths = lines.map((line) => line.reduce((n, i) => n + widths[i], 0) + space * (line.length - 1));
	const fit = Math.min(1, maxW / Math.max(...lineWidths));
	const lh = CAPTION_UNITS * 1.3 * fit;
	const y0 = -((lines.length - 1) * lh) / 2;
	const fade = 1 - prog(t, env.tOut + EXIT - 0.1, env.tOut + EXIT);
	lines.forEach((line, li) => {
		let x = -(lineWidths[li] * fit) / 2;
		const cy = y0 + li * lh;
		for (const i of line) {
			const word = words[i];
			const cw = widths[i] * fit;
			let p = prog(t, word.s - 0.06, word.s + 0.12);
			if (i === 0) p = Math.max(p, prog(t, 0, 0.12));
			if (p > 0) {
				const active = t >= word.s - 0.04 && t < Math.max(word.e, word.s + 0.18) + 0.04;
				const sc = (0.75 + 0.25 * eback(p, 2.4)) * fit;
				const cx = x + cw / 2;
				if (active && variant === "box") {
					const pb = eo3(prog(t, word.s - 0.04, word.s + 0.08));
					roundRect(ctx, cx, cy + CAPTION_UNITS * 0.05 * fit, widths[i] + CAPTION_UNITS * 0.4, CAPTION_UNITS * 1.37, CAPTION_UNITS * 0.29, env.accent, {
						alpha: pb * fade,
						shadow: 1,
						scale: fit * (0.85 + 0.15 * pb),
					});
					text(ctx, tokens[i], cx, cy - 4 * eo3(prog(t, word.s - 0.04, word.s + 0.1)), style, {
						fill: "#ffffff",
						alpha: clamp(p * 2) * fade,
						scale: sc * 1.04,
					});
				} else {
					const color = active && variant === "pop" ? env.accent : env.fg;
					text(ctx, tokens[i], cx, cy, style, {
						fill: color,
						stroke: CAPTION_UNITS * 0.12,
						strokeColor: env.ink,
						shadow: 1,
						alpha: clamp(p * 2) * fade,
						scale: variant === "pop" && active ? sc * 1.08 : sc,
					});
				}
			}
			x += cw + space * fit;
		}
	});
}

/**
 * Use stored word timing when it still matches the content. If the user edited a
 * word but kept the count, keep the timing with the new spelling; otherwise spread
 * the new words evenly across the clip.
 */
function resolveCaptionWords({
	content,
	wordsParam,
	duration,
}: {
	content: string;
	wordsParam: unknown;
	duration: number;
}): MotionWord[] {
	const tokens = content.split(/\s+/).filter(Boolean);
	const stored = decodeMotionWords({ value: wordsParam });
	if (stored && stored.length === tokens.length) {
		return stored.map((word, i) => ({ ...word, w: tokens[i] }));
	}
	return spreadWordsEvenly({ content, duration });
}

// ---------------------------------------------------------------- entry point
export function drawMotion(input: MotionDrawInput): void {
	const { ctx, preset } = input;
	if (preset === "none") return;
	const scale = (input.fontSize * input.canvasHeight) / FONT_SIZE_SCALE_REFERENCE / UNIT_REFERENCE;
	if (!(scale > 0)) return;
	const env: Env = {
		ctx,
		t: input.localTime,
		tOut: Math.max(0.3, input.duration - EXIT),
		widthUnits: input.canvasWidth / scale,
		fg: input.textColor || "#ffffff",
		accent: input.accentColor || DEFAULT_MOTION_ACCENT,
		ink: DEFAULT_MOTION_INK,
		pop: input.entrance === "pop",
		scale,
		family:
			input.fontFamily && input.fontFamily !== "Arial"
				? `"${input.fontFamily}", ${MOTION_SANS}`
				: MOTION_SANS,
	};
	ctx.save();
	ctx.scale(scale, scale);
	const lines = parseLines(input.content);
	switch (preset) {
		case "headline":
			drawHeadline(env, lines);
			break;
		case "chips":
			drawChips(env, lines);
			break;
		case "terminal":
			drawTerminal(env, lines);
			break;
		case "checklist":
			drawChecklist(env, lines);
			break;
		case "stamp":
			drawStamp(env, lines);
			break;
		case "flow":
			drawFlow(env, lines);
			break;
		case "marquee":
			drawMarquee(env, lines);
			break;
		case "bigword":
			drawBigword(env, lines);
			break;
		case "progress":
			drawProgress(env, lines);
			break;
		case "rec":
			drawRec(env, lines);
			break;
		case "lower-third":
			drawLowerThird(env, lines);
			break;
		case "chapter":
			drawChapter(env, lines);
			break;
		case "wedding":
			drawWedding(env, lines);
			break;
		case "glitch":
			drawGlitch(env, lines);
			break;
		case "word-swap":
			drawWordSwap(env, lines);
			break;
		case "location":
			drawLocation(env, lines);
			break;
		case "counter":
			drawCounter(env, lines);
			break;
		case "list":
			drawList(env, lines);
			break;
		case "versus":
			drawVersus(env, lines);
			break;
		case "notification":
			drawNotification(env, lines);
			break;
		case "chat":
			drawChat(env, lines);
			break;
		case "cta":
			drawCta(env, lines);
			break;
		case "highlight":
			drawHighlight(env, lines);
			break;
		case "strike":
			drawStrike(env, lines);
			break;
		case "quote":
			drawQuote(env, lines);
			break;
		case "arrow":
			drawArrowNote(env, lines);
			break;
		case "lottie":
			drawLottie(env, input);
			break;
		case "captions-box":
		case "captions-pop": {
			const words = resolveCaptionWords({
				content: input.content,
				wordsParam: input.wordsParam,
				duration: input.duration,
			});
			drawCaptions(env, words, preset === "captions-box" ? "box" : "pop");
			break;
		}
	}
	ctx.restore();
}

/** Approximate on-canvas box of a motion element, for selection handles (design units → px). */
export function motionBounds({
	preset,
	content,
	fontSize,
	canvasHeight,
	canvasWidth,
}: {
	preset: MotionPresetId;
	content: string;
	fontSize: number;
	canvasHeight: number;
	canvasWidth: number;
}): { width: number; height: number; left: number; top: number } {
	const scale = (fontSize * canvasHeight) / FONT_SIZE_SCALE_REFERENCE / UNIT_REFERENCE;
	const lineCount = Math.max(1, parseLines(content).length);
	let w = 980;
	let h = 200;
	switch (preset) {
		case "captions-box":
		case "captions-pop":
			h = CAPTION_UNITS * 1.5;
			break;
		case "rec":
			w = 420;
			h = 60;
			return { width: w * scale, height: h * scale, left: -15 * scale, top: (-h / 2) * scale };
		case "headline":
			h = lineCount * 150;
			break;
		case "flow":
		case "bigword":
		case "marquee":
		case "versus":
		case "counter":
		case "arrow":
		case "cta":
			h = 520;
			break;
		case "lower-third":
		case "location":
			h = 280;
			break;
		case "lottie":
			w = LOTTIE_UNITS;
			h = LOTTIE_UNITS;
			break;
		case "chat":
		case "list":
		case "quote":
			h = Math.max(420, lineCount * 130);
			break;
		default:
			h = Math.max(320, lineCount * 110);
	}
	const width = Math.min(canvasWidth * 0.95, w * scale);
	return { width, height: h * scale, left: -width / 2, top: (-h * scale) / 2 };
}
if (typeof window !== "undefined") void ensureMotionFonts();
