// Talking-video mode: upload a selfie clip → Whisper (with fillers) → Claude edit plan →
// (you approve) → cut + grade → stock B-roll + music → speaker cut-outs → build → Claude scenes → render.
const fs = require("fs");
const path = require("path");
const S = require("./store");
const R = require("./runner");
const P = require("./pipeline");

const FILLER = /^(u+h+m*|u+m+|e+r+m*|e+r+|h+m+|m+h*m+|a+h+|a+a+h*|e+h+|e+m+|uh-huh|mhm|hmm+)$/i;
const GAP = 0.45; // pauses longer than this get tightened
const clean = (w) => String(w || "").toLowerCase().replace(/[^\p{L}\p{N}'-]/gu, "");

function stockEnv() {
  const s = S.getSettings();
  return {
    PEXELS_API_KEY: s.pexelsKey || "", PIXABAY_API_KEY: s.pixabayKey || "",
    UNSPLASH_ACCESS_KEY: s.unsplashKey || "", FREESOUND_API_KEY: s.freesoundKey || "",
  };
}
async function stock(args, ctx) {
  const r = await R.run(R.python(), [path.join(S.RES_ROOT, "tools", "stock.py"), ...args], { env: stockEnv(), quiet: true, timeoutMs: 180000 });
  const lines = r.out.trim().split("\n");
  const json = lines.reverse().find((l) => /^\s*[[{]/.test(l));
  const errs = r.out.split("\n").filter((l) => l && !/^\s*[[{]/.test(l));
  if (ctx && errs.length) ctx.log(`  (${errs.slice(0, 3).join(" | ").slice(0, 240)})`);
  try { return JSON.parse(json || "[]"); } catch { return []; }
}

// ---------------------------------------------------------------- create
function createTalking(form, uploadPath) {
  const f = {
    topic: String(form.topic || "").trim(), notes: String(form.notes || "").trim(),
    language: ["en", "ms-casual", "mixed"].includes(form.language) ? form.language : "mixed",
    captionStyle: form.captionStyle === "pop" ? "pop" : "box",
    cta: String(form.cta || "").trim(), styleId: "talking", length: 0,
  };
  const ext = (path.extname(uploadPath) || ".mp4").toLowerCase();
  const id = S.newId(f.topic || path.basename(uploadPath, ext) || "talking");
  const dir = S.projDir(id);
  S.copyDir(path.join(S.RES_ROOT, "kit-talking"), dir);
  S.addShared(dir);
  fs.copyFileSync(path.join(S.RES_ROOT, "tools", "stock.py"), path.join(dir, "tools", "stock.py"));
  for (const d of ["source", "renders", "logs", "snapshots", "compositions"]) fs.mkdirSync(path.join(dir, d), { recursive: true });
  const raw = path.join(dir, "source", `raw${ext}`);
  try { fs.renameSync(uploadPath, raw); } catch { fs.copyFileSync(uploadPath, raw); fs.unlinkSync(uploadPath); }
  const p = {
    id, kind: "talking", title: f.topic || "Talking video", status: "draft", form: f, tplan: null, steps: {},
    sessionId: null, cost: 0, createdAt: new Date().toISOString(), history: [], rawFile: `source/raw${ext}`,
  };
  S.saveProject(p);
  P.writeClaudeMd(p);
  prep(id);
  return p;
}

// ---------------------------------------------------------------- prep: normalise, Whisper, plan, search
function prep(id) {
  P.startJob(id, "Preparing", async (ctx) => {
    let p = P.update(id, { status: "transcribing", error: null });
    const dir = S.projDir(id);
    if (!fs.existsSync(path.join(dir, "source/main.mp4"))) {
      ctx.log("Normalising your footage to 1080×1920, 30 fps…");
      await R.runOk("ffmpeg", ["-v", "error", "-y", "-i", path.join(dir, p.rawFile),
        "-vf", "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,format=yuv420p",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "source/main.mp4"], { cwd: dir, onSpawn: ctx.onSpawn });
      await R.runOk("ffmpeg", ["-v", "error", "-y", "-i", "source/main.mp4", "-vn", "-ac", "1", "-ar", "16000", "source/audio.wav"], { cwd: dir });
      const d = await P.probeDuration(path.join(dir, "source/main.mp4"));
      p = P.update(id, { sourceSeconds: Math.round(d * 100) / 100 });
      ctx.log(`✔ Footage ready (${d.toFixed(1)} s).`);
    }
    ctx.check();
    if (!fs.existsSync(path.join(dir, "source/words.json"))) {
      const s = S.getSettings();
      const lang = (S.getLanguages().find((x) => x.id === p.form.language) || { whisper: "auto" }).whisper;
      ctx.log(`Transcribing every word, fillers included (Whisper ${s.whisperModel}, ${lang}). First run downloads the model…`);
      await R.runOk(R.python(), ["tools/whisper-words.py", "source/audio.wav", "source/words.json", lang, s.whisperModel], { cwd: dir, onLine: ctx.log, onSpawn: ctx.onSpawn });
    }
    ctx.check();
    await planEdit(id, ctx);
  });
}

function loadWords(id) {
  return S.readJSON(path.join(S.projDir(id), "source/words.json"), []).map((w, i) => ({ i, w: w[0], s: w[1], e: w[2], p: w[3] }));
}
function autoFillers(words) {
  return words.filter((w) => FILLER.test(clean(w.w))).map((w) => ({ from: w.i, to: w.i, reason: `filler “${w.w}”`, auto: true, on: true }));
}
function transcriptText(words, fillers) {
  const fset = new Set(fillers.map((f) => f.from));
  const lines = [];
  let cur = [], start = 0;
  words.forEach((w, k) => {
    if (!cur.length) start = w.s;
    cur.push(`[${w.i}]${w.w}${fset.has(w.i) ? "⟨filler⟩" : ""}`);
    const next = words[k + 1];
    if (!next || /[.!?]$/.test(w.w) || next.s - w.e > 0.8 || cur.length >= 18) {
      lines.push(`${start.toFixed(2).padStart(6)}  ${cur.join(" ")}`);
      cur = [];
    }
  });
  return lines.join("\n");
}
function presetCatalog() {
  const list = S.readDefaultJSON("motion-presets.json", []);
  return list.map((x) => `- ${x.id} (${x.category}): ${x.description}. Format: ${x.help} Example: ${JSON.stringify(x.example)}`).join("\n");
}

function planVars(p, words, fillers) {
  return P.vars(p, {
    duration: (p.sourceSeconds || 0).toFixed(1),
    transcript: transcriptText(words, fillers),
    presets: presetCatalog(),
    notes: [p.form.topic, p.form.notes].filter(Boolean).join(". ") || "none",
    cta_line: p.form.cta ? `the creator wants "Comment ${p.form.cta}" at the end` : "only if the creator says one",
  });
}

async function planEdit(id, ctx, note) {
  let p = P.update(id, { status: "planning", error: null });
  const words = loadWords(id);
  if (!words.length) throw new Error("Whisper found no speech in this video.");
  const fillers = autoFillers(words);
  let prompt = S.fill(S.getPrompt("talking_plan"), planVars(p, words, fillers));
  if (note && p.tplan) {
    prompt += `\n\n## Revise the current plan\nCurrent plan JSON:\n${JSON.stringify(stripPlan(p.tplan), null, 1)}\n\nThe creator's note: ${note}\nReturn the FULL revised plan JSON in the same shape.`;
  }
  ctx.log(note ? `Revising the edit plan: ${note}` : `Claude is planning the edit (${words.length} words, ${fillers.length} fillers spotted)…`);
  const r = await R.claude(prompt, { cwd: S.projDir(id), onLine: ctx.log, onSpawn: ctx.onSpawn });
  const plan = normalisePlan(parseJSON(r.text), words, fillers);
  P.update(id, (q) => { q.tplan = plan; q.title = plan.title || q.title; q.planApproved = false; P.addCost(q, r.cost); q.history.push({ at: new Date().toISOString(), what: note ? `plan revised: ${note}` : "edit plan" }); });
  ctx.check();
  await searchAssets(id, ctx);
  P.update(id, { status: "planned" });
  ctx.log(`✔ Edit plan ready: ${plan.segments.length} segments, ${plan.cuts.filter((c) => c.on).length} cuts. Review it, then Approve.`);
}

function parseJSON(text) {
  const t = String(text || "");
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a < 0 || b < a) throw new Error("Claude did not return an edit plan. Try Regenerate.");
  return JSON.parse(t.slice(a, b + 1));
}
const stripPlan = (pl) => ({ ...pl, segments: pl.segments.map((s) => ({ ...s, broll: s.broll ? { query: s.broll.query, kind: s.broll.kind } : undefined })), music: { query: pl.music && pl.music.query } });

const LAYOUTS = ["overlay", "split", "broll", "fullmotion"];
function normalisePlan(j, words, fillers) {
  const n = words.length;
  const idx = (x, d) => { const v = parseInt(x, 10); return Number.isFinite(v) ? Math.max(0, Math.min(n - 1, v)) : d; };
  const keep = new Set((j.keep || []).map((x) => idx(x, -1)));
  const cuts = [
    ...fillers.map((f) => ({ ...f, on: !keep.has(f.from) })),
    ...(j.cuts || []).map((c) => ({ from: idx(c.from, 0), to: idx(c.to, idx(c.from, 0)), reason: String(c.reason || "cut"), on: true })),
  ].filter((c) => c.to >= c.from).sort((a, b) => a.from - b.from)
    .filter((c, k, arr) => !arr.slice(0, k).some((d) => d.from <= c.from && d.to >= c.to)); // drop duplicates / ranges already covered
  let segs = (j.segments || []).map((s) => ({
    from: idx(s.from, 0), to: idx(s.to, n - 1),
    layout: LAYOUTS.includes(s.layout) ? s.layout : "overlay",
    preset: s.preset || "none", content: String(s.content || ""), at: idx(s.at, idx(s.from, 0)),
    zoom: !!s.zoom, behind: !!s.behind, sfx: s.sfx || "none", brief: String(s.brief || ""),
    assetId: s.assetId, y: s.y, fontSize: s.fontSize,
    broll: (s.layout === "split" || s.layout === "broll") ? { query: String((s.broll && s.broll.query) || ""), kind: (s.broll && s.broll.kind) === "image" ? "image" : "video", candidates: [], pick: 0 } : null,
  })).filter((s) => s.to >= s.from).sort((a, b) => a.from - b.from);
  if (!segs.length) segs = [{ from: 0, to: n - 1, layout: "overlay", preset: "none", content: "", at: 0, zoom: false, behind: false, sfx: "none", brief: "", broll: null }];
  // make segments contiguous and cover every word
  segs[0].from = 0;
  for (let k = 0; k < segs.length - 1; k++) segs[k].to = Math.max(segs[k].from, segs[k + 1].from - 1);
  segs[segs.length - 1].to = n - 1;
  segs = segs.filter((s) => s.to >= s.from);
  segs.forEach((s, k) => { s.id = `s${k + 1}`; if (s.at < s.from || s.at > s.to) s.at = s.from; });
  return {
    title: String(j.title || ""), notes: String(j.notes || ""),
    hook: { text: String((j.hook && j.hook.text) || ""), preset: (j.hook && j.hook.preset) || "headline" },
    cuts, segments: segs, tightenPauses: true, grade: S.getSettings().colorGrade !== false,
    music: { query: String((j.music && j.music.query) || "chill lofi"), candidates: [], pick: 0, volume: 0.16, on: true },
  };
}

async function searchAssets(id, ctx, only) {
  const p = S.getProject(id);
  const plan = p.tplan;
  const need = plan.segments.filter((s) => s.broll && s.broll.query && (!only || only === s.id));
  for (const s of need) {
    ctx.log(`Searching free ${s.broll.kind}s: “${s.broll.query}”…`);
    const list = await stock(["search", "--kind", s.broll.kind, "--query", s.broll.query, "--n", "6", "--min-dur", "2"], ctx);
    s.broll.candidates = list; s.broll.pick = 0;
    ctx.log(list.length ? `  ${list.length} results (${[...new Set(list.map((c) => c.source))].join(", ")})` : "  no results: this segment will fall back to a motion overlay");
  }
  if (!only && plan.music && plan.music.query) {
    ctx.log(`Searching music: “${plan.music.query}”…`);
    const total = Math.max(30, (p.sourceSeconds || 60) * 0.8);
    plan.music.candidates = await stock(["music", "--query", plan.music.query, "--n", "5", "--min-dur", String(Math.round(Math.min(total, 120)))], ctx);
    plan.music.pick = 0;
    ctx.log(plan.music.candidates.length ? `  ${plan.music.candidates.length} tracks` : "  no music found (add a Freesound key in Settings): the reel will have voice + SFX only");
  }
  P.update(id, (q) => { q.tplan = plan; });
}

// ---------------------------------------------------------------- edit helpers (used by UI)
function savePlan(id, plan) {
  if (P.jobs.has(id)) throw new Error("Busy, wait for the current step");
  return P.update(id, (q) => { q.tplan = { ...q.tplan, ...plan }; if (q.planApproved) { q.planApproved = false; q.status = "planned"; } });
}
function revise(id, note) { P.startJob(id, "Revising edit", (ctx) => planEdit(id, ctx, note)); }
function regenerate(id) {
  P.startJob(id, "Planning", async (ctx) => {
    const dir = S.projDir(id);
    if (!fs.existsSync(path.join(dir, "source/words.json"))) throw new Error("No transcript yet: click Continue.");
    await planEdit(id, ctx);
  });
}
function researchSegment(id, segId, query, kind) {
  P.startJob(id, "Searching stock", async (ctx) => {
    P.update(id, (q) => { const s = q.tplan.segments.find((x) => x.id === segId); if (s) { s.broll = { ...(s.broll || {}), query, kind: kind === "image" ? "image" : "video", candidates: [], pick: 0 }; } });
    await searchAssets(id, ctx, segId);
  });
}
function researchMusic(id, query) {
  P.startJob(id, "Searching music", async (ctx) => {
    const p = S.getProject(id);
    const list = await stock(["music", "--query", query, "--n", "6", "--min-dur", String(Math.round(Math.min(120, (p.sourceSeconds || 60) * 0.8)))], ctx);
    P.update(id, (q) => { q.tplan.music = { ...q.tplan.music, query, candidates: list, pick: 0 }; });
    ctx.log(`✔ ${list.length} tracks`);
  });
}

// ---------------------------------------------------------------- approve → automatic
function approve(id) {
  const p = S.getProject(id);
  if (!p.tplan) throw new Error("No edit plan yet");
  P.update(id, (q) => { q.planApproved = true; q.status = "approved"; q.error = null; q.steps = {}; q.sessionId = null; q.history.push({ at: new Date().toISOString(), what: "edit approved" }); });
  runTalking(id);
}
function continueTalking(id) {
  const p = S.getProject(id);
  if (!p.tplan) return prep(id);
  if (!p.planApproved) { P.update(id, { status: "planned", error: null }); return; }
  runTalking(id);
}

function runTalking(id) {
  P.startJob(id, "Editing the video", async (ctx) => {
    let p = S.getProject(id);
    if (!p.steps.cut) { await cutAndGrade(id, ctx); ctx.check(); }
    p = S.getProject(id);
    if (!p.steps.assets) { await fetchAssets(id, ctx); ctx.check(); }
    p = S.getProject(id);
    if (!p.steps.matte) { await mattes(id, ctx); ctx.check(); }
    p = S.getProject(id);
    if (!p.steps.build) { await buildTalking(id, ctx); ctx.check(); }
    p = S.getProject(id);
    if (!p.steps.render) await P.renderAndCheck(id, ctx, { qa: S.getSettings().autoQA });
  });
}

// keep ranges (source seconds) from words + active cuts
function keepRanges(words, plan, dur) {
  const cut = new Set();
  for (const c of plan.cuts) if (c.on) for (let i = c.from; i <= c.to; i++) cut.add(i);
  const ranges = [];
  let group = null, prev = null;
  for (const w of words) {
    if (cut.has(w.i)) { if (group) { ranges.push(group); group = null; } prev = null; continue; }
    const split = prev && plan.tightenPauses && w.s - prev.e > GAP;
    if (!group || split) {
      if (group) ranges.push(group);
      group = { a: Math.max(0, w.s - 0.1), b: w.e + 0.14, first: w.i };
    } else group.b = w.e + 0.14;
    prev = w;
  }
  if (group) ranges.push(group);
  // clamp + merge overlaps
  const out = [];
  for (const r of ranges) {
    r.b = Math.min(dur, r.b);
    if (out.length && r.a <= out[out.length - 1].b + 0.02) out[out.length - 1].b = Math.max(out[out.length - 1].b, r.b);
    else if (r.b - r.a > 0.05) out.push({ a: r.a, b: r.b });
  }
  return out.map((r) => ({ a: Math.round(r.a * 1000) / 1000, b: Math.round(r.b * 1000) / 1000 }));
}
function mapper(ranges) {
  const starts = [];
  let acc = 0;
  for (const r of ranges) { starts.push(acc); acc += r.b - r.a; }
  const total = acc;
  const map = (t) => {
    for (let k = 0; k < ranges.length; k++) {
      const r = ranges[k];
      if (t < r.a) return starts[k];
      if (t <= r.b) return starts[k] + (t - r.a);
    }
    return total;
  };
  return { map, total };
}

let _ffv = null;
async function ffmpegMajor() {
  if (_ffv !== null) return _ffv;
  const r = await R.run("ffmpeg", ["-version"], { quiet: true });
  const m = r.out.match(/ffmpeg version n?(\d+)/);
  _ffv = m ? parseInt(m[1], 10) : 6;
  return _ffv;
}

async function cutAndGrade(id, ctx) {
  let p = P.update(id, { status: "cutting", error: null });
  const dir = S.projDir(id);
  const words = loadWords(id);
  const ranges = keepRanges(words, p.tplan, p.sourceSeconds || 1e9);
  if (!ranges.length) throw new Error("Everything would be cut: untick some cuts.");
  const cutSecs = (p.sourceSeconds || 0) - ranges.reduce((a, r) => a + r.b - r.a, 0);
  ctx.log(`Cutting ${ranges.length} pieces (removing ${cutSecs.toFixed(1)} s of fillers, pauses and retakes)${p.tplan.grade ? " and colour grading" : ""}…`);
  const parts = [];
  ranges.forEach((r, i) => {
    const d = (r.b - r.a).toFixed(3), f = Math.min(0.012, (r.b - r.a) / 4).toFixed(3);
    parts.push(`[0:v]trim=start=${r.a}:end=${r.b},setpts=PTS-STARTPTS[v${i}]`);
    parts.push(`[0:a]atrim=start=${r.a}:end=${r.b},asetpts=PTS-STARTPTS,afade=t=in:d=${f},afade=t=out:st=${(d - f).toFixed(3)}:d=${f}[a${i}]`);
  });
  parts.push(`${ranges.map((_, i) => `[v${i}][a${i}]`).join("")}concat=n=${ranges.length}:v=1:a=1[vc][ac]`);
  parts.push(p.tplan.grade
    ? "[vc]eq=brightness=-0.03:contrast=1.07:saturation=1.14,colorbalance=rs=0.05:gs=0.01:bs=-0.05:rm=0.03:bm=-0.03,vignette=angle=0.5,format=yuv420p[vo]"
    : "[vc]format=yuv420p[vo]");
  parts.push("[ac]loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[ao]");
  const script = path.join(dir, "source", "cut.ffgraph");
  fs.writeFileSync(script, parts.join(";\n"));
  fs.mkdirSync(path.join(dir, "assets/footage"), { recursive: true });
  fs.mkdirSync(path.join(dir, "assets/audio"), { recursive: true });
  const major = await ffmpegMajor();
  const graphArgs = major >= 7 ? ["-/filter_complex", script] : ["-filter_complex_script", script];
  await R.runOk("ffmpeg", ["-v", "error", "-y", "-i", "source/main.mp4", ...graphArgs,
    "-map", "[vo]", "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-r", "30", "assets/footage/main.mp4",
    "-map", "[ao]", "-c:a", "pcm_s16le", "assets/audio/voice.wav"], { cwd: dir, onSpawn: ctx.onSpawn });
  const { map, total } = mapper(ranges);
  const realTotal = await P.probeDuration(path.join(dir, "assets/footage/main.mp4")) || total;
  // words on the edited timeline (kept only)
  const cutSet = new Set(); for (const c of p.tplan.cuts) if (c.on) for (let i = c.from; i <= c.to; i++) cutSet.add(i);
  const kept = words.filter((w) => !cutSet.has(w.i));
  const ew = kept.map((w) => [w.w, +map(w.s).toFixed(3), +map(w.e).toFixed(3)]);
  const firstKept = (s) => kept.find((w) => w.i >= s.from && w.i <= s.to);
  // segments on the edited timeline, contiguous
  let segs = p.tplan.segments.map((s) => {
    const fk = firstKept(s);
    return fk ? { ...s, start: Math.max(0, map(fk.s) - 0.06), atT: map((words[s.at] && !cutSet.has(s.at) ? words[s.at] : fk).s) } : null;
  }).filter(Boolean);
  segs[0].start = 0;
  segs.forEach((s, k) => { s.end = k + 1 < segs.length ? segs[k + 1].start : realTotal; });
  segs = segs.filter((s) => s.end - s.start > 0.05);
  const words1 = kept.filter((w) => w.i <= p.tplan.segments[0].to);
  const hookEnd = Math.min(3.6, Math.max(1.6, words1.length ? map(words1[words1.length - 1].e) + 0.15 : 2.5));
  P.update(id, (q) => {
    q.edit = { ranges, total: +realTotal.toFixed(3), words: ew, segments: segs.map((s) => ({ ...s, start: +s.start.toFixed(3), end: +s.end.toFixed(3), at: +Math.min(s.end - 0.3, Math.max(s.start, s.atT - 0.08)).toFixed(3) })), hookEnd };
    q.steps.cut = true; q.cutSeconds = +cutSecs.toFixed(1);
  });
  ctx.log(`✔ Cut to ${realTotal.toFixed(1)} s (was ${(p.sourceSeconds || 0).toFixed(1)} s).`);
}

async function fetchAssets(id, ctx) {
  let p = P.update(id, { status: "assets" });
  const dir = S.projDir(id);
  const credits = [];
  const segs = p.edit.segments;
  for (const s of segs) {
    if (!s.broll || !(s.layout === "split" || s.layout === "broll")) continue;
    const c = s.broll.candidates || [];
    const order = [s.broll.pick || 0, ...c.map((_, i) => i).filter((i) => i !== (s.broll.pick || 0))].slice(0, 4);
    const d = Math.max(0.5, s.end - s.start);
    const [w, h] = s.layout === "split" ? [1080, 960] : [1080, 1920];
    let done = false;
    for (const k of order) {
      const cand = c[k];
      if (!cand) continue;
      const rawExt = cand.kind === "image" ? ".img" : ".src";
      const raw = path.join(dir, "assets/broll", `${s.id}${rawExt}`);
      try {
        ctx.log(`Downloading ${cand.kind} for ${s.id} from ${cand.source}…`);
        await R.runOk(R.python(), [path.join(S.RES_ROOT, "tools", "stock.py"), "download", "--url", cand.url, "--out", raw, ...(cand.ping ? ["--ping", cand.ping] : [])], { env: stockEnv(), onSpawn: ctx.onSpawn });
        const vf = `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}`;
        if (cand.kind === "image") {
          await R.runOk("ffmpeg", ["-v", "error", "-y", "-i", raw, "-vf", vf, "-frames:v", "1", "-q:v", "3", `assets/broll/${s.id}.jpg`], { cwd: dir });
          s.broll.file = `assets/broll/${s.id}.jpg`;
        } else {
          await R.runOk("ffmpeg", ["-v", "error", "-y", "-stream_loop", "-1", "-i", raw, "-t", d.toFixed(3), "-vf", `${vf},fps=30,format=yuv420p`, "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", `assets/broll/${s.id}.mp4`], { cwd: dir, onSpawn: ctx.onSpawn });
          s.broll.file = `assets/broll/${s.id}.mp4`;
        }
        try { fs.unlinkSync(raw); } catch { /* fine */ }
        s.broll.used = { source: cand.source, page: cand.page, author: cand.author, license: cand.license, title: cand.title };
        credits.push(`${s.id}: ${cand.title || cand.kind} by ${cand.author || "unknown"} (${cand.source}, ${cand.license}) ${cand.page || ""}`);
        done = true;
        break;
      } catch (e) {
        ctx.log(`  that one failed (${String(e.message).split("\n")[0].slice(0, 140)}), trying the next result…`);
      }
    }
    if (!done) {
      ctx.log(`  no usable B-roll for ${s.id}: switching it to a motion overlay.`);
      s.layout = "overlay"; s.broll = null;
      if (!s.preset || s.preset === "none") { s.preset = "highlight"; s.content = s.content || ""; }
    }
  }
  // music + mix
  const music = p.tplan.music || {};
  const voice = path.join(dir, "assets/audio/voice.wav");
  const mix = path.join(dir, "assets/audio/mix.wav");
  let mixed = false;
  if (music.on !== false && (music.candidates || []).length) {
    const cand = music.candidates[music.pick || 0] || music.candidates[0];
    try {
      ctx.log(`Downloading music “${cand.title}” (${cand.source})…`);
      const mf = path.join(dir, "assets/audio/music.src");
      await R.runOk(R.python(), [path.join(S.RES_ROOT, "tools", "stock.py"), "download", "--url", cand.url, "--out", mf], { env: stockEnv(), onSpawn: ctx.onSpawn });
      const T = p.edit.total, vol = music.volume || 0.16;
      const graph = `[1:a]aresample=48000,volume=${vol},atrim=0:${T.toFixed(3)},afade=t=in:d=0.8,afade=t=out:st=${Math.max(0, T - 1.8).toFixed(3)}:d=1.8[m];` +
        `[0:a]aresample=48000,asplit=2[v1][v2];[m][v1]sidechaincompress=threshold=0.04:ratio=6:attack=15:release=350[md];` +
        `[v2][md]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[out]`;
      await R.runOk("ffmpeg", ["-v", "error", "-y", "-i", voice, "-stream_loop", "-1", "-i", mf, "-filter_complex", graph, "-map", "[out]", "-c:a", "pcm_s16le", mix], { cwd: dir, onSpawn: ctx.onSpawn });
      credits.push(`music: ${cand.title} by ${cand.author || "unknown"} (${cand.source}, ${cand.license}) ${cand.page || ""}`);
      mixed = true;
    } catch (e) {
      ctx.log(`  music failed (${String(e.message).split("\n")[0].slice(0, 140)}): continuing with voice only.`);
    }
  }
  if (!mixed) fs.copyFileSync(voice, mix);
  fs.writeFileSync(path.join(dir, "credits.txt"), `Stock media and music used in this reel\n\n${credits.join("\n") || "(none)"}\n`);
  P.update(id, (q) => { q.edit.segments = segs; q.steps.assets = true; q.credits = credits; });
  ctx.log("✔ Assets ready.");
}

async function mattes(id, ctx) {
  let p = P.update(id, { status: "matting" });
  const dir = S.projDir(id);
  const segs = p.edit.segments;
  const want = segs.filter((s) => s.behind && s.layout === "overlay");
  fs.mkdirSync(path.join(dir, "assets/matte"), { recursive: true });
  for (const s of want) {
    const clip = path.join(dir, "assets/matte", `${s.id}.src.mp4`);
    try {
      ctx.log(`Cutting you out of the background for ${s.id} (text behind you). This takes a few minutes…`);
      await R.runOk("ffmpeg", ["-v", "error", "-y", "-ss", s.start.toFixed(3), "-i", "assets/footage/main.mp4", "-t", (s.end - s.start).toFixed(3), "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", clip], { cwd: dir });
      const r = await R.npxHF(["remove-background", clip, "-o", `assets/matte/${s.id}.webm`, "--quality", "balanced"], { cwd: dir, onLine: ctx.log, onSpawn: ctx.onSpawn });
      if (r.code !== 0 || !fs.existsSync(path.join(dir, "assets/matte", `${s.id}.webm`))) throw new Error("remove-background failed");
    } catch (e) {
      ctx.log(`  couldn't cut out ${s.id}: the text goes in front instead.`);
      s.behind = false;
    } finally { try { fs.unlinkSync(clip); } catch { /* fine */ } }
  }
  P.update(id, (q) => { q.edit.segments = segs; q.steps.matte = true; });
}

function editJson(p) {
  const s = S.getSettings();
  const hookEnd = p.edit.hookEnd || 2.5;
  return {
    total: p.edit.total, captionStyle: p.form.captionStyle || "box", captionY: 0.22, captionSize: 4.2, accent: s.accent || "#ff6a2b",
    hook: p.tplan.hook && p.tplan.hook.text ? { text: p.tplan.hook.text, preset: p.tplan.hook.preset || "headline", start: 0, end: +hookEnd.toFixed(3) } : null,
    words: p.edit.words,
    segments: p.edit.segments.map((x) => {
      const o = { id: x.id, start: x.start, end: x.end, layout: x.layout, preset: x.preset, content: x.content, at: x.at, zoom: x.zoom, behind: x.behind, sfx: x.sfx, brief: x.brief };
      for (const k of ["y", "fontSize", "assetId"]) if (x[k] !== undefined && x[k] !== null && x[k] !== "") o[k] = x[k];
      if (x.broll && x.broll.file) o.broll = { file: x.broll.file, kind: x.broll.kind };
      o.text = p.edit.words.filter((w) => w[1] >= x.start - 0.01 && w[1] < x.end).map((w) => w[0]).join(" ");
      if (x.start < hookEnd - 0.05 && x.layout === "overlay" && (!x.preset || x.preset === "none")) o.preset = "none";
      return o;
    }),
  };
}

async function buildTalking(id, ctx) {
  let p = P.update(id, { status: "building", error: null });
  const dir = S.projDir(id);
  fs.writeFileSync(path.join(dir, "edit.json"), JSON.stringify(editJson(p), null, 1));
  P.writeClaudeMd(p);
  ctx.log("Building the composition from the approved edit…");
  await R.runOk(R.python(), ["tools/build_talking.py"], { cwd: dir, onLine: ctx.log });
  const fm = p.edit.segments.filter((s) => s.layout === "fullmotion");
  ctx.log(`Claude is writing ${fm.length} full-motion scene${fm.length === 1 ? "" : "s"} and checking every segment. Usually 10–25 minutes…`);
  const fmList = fm.length ? fm.map((s) => `${s.id} (${(s.end - s.start).toFixed(1)} s): ${s.brief || s.content || s.preset}`).join("; ") : "none (just tune and check the overlays)";
  const r = await R.claude(S.fill(S.getPrompt("talking_build"), P.vars(p, { fm_list: fmList })), { cwd: dir, tools: P.BUILD_TOOLS, onLine: ctx.log, onSpawn: ctx.onSpawn, timeoutMs: 90 * 60 * 1000 });
  P.update(id, (q) => { q.sessionId = r.sessionId; q.buildSummary = r.text; P.addCost(q, r.cost); });
  ctx.check();
  await R.runOk(R.python(), ["tools/build_talking.py"], { cwd: dir, onLine: ctx.log });
  await P.ensureBuilt(id, ctx);
  P.update(id, (q) => { q.steps.build = true; q.history.push({ at: new Date().toISOString(), what: "scenes built" }); });
  ctx.log("✔ Composition built.");
}

module.exports = { stockEnv, stockJSON: stock, createTalking, prep, revise, regenerate, savePlan, approve, continueTalking, researchSegment, researchMusic, keepRanges, mapper, normalisePlan, autoFillers, editJson };
