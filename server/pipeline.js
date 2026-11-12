// The reel pipeline: plan → (approve) → voice → Whisper → Claude build → render → MP4 check.
const fs = require("fs");
const path = require("path");
const { EventEmitter } = require("events");
const EL = require("./elevenlabs");
const S = require("./store");
const R = require("./runner");

const bus = new EventEmitter();
bus.setMaxListeners(100);
const jobs = new Map(); // project id -> { name, child, cancelled }

const BUILD_TOOLS = ["Read", "Write", "Edit", "MultiEdit", "Bash", "Glob", "Grep", "TodoWrite"];
const RUNNING = ["planning", "voicing", "transcribing", "building", "rendering", "checking", "cutting", "assets", "matting"];

// ---------- logging / events ----------
function log(id, line) {
  const t = new Date().toISOString();
  const text = String(line);
  if (id !== "setup") try {
    const f = path.join(S.projDir(id), "logs", "pipeline.log");
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.appendFileSync(f, `[${t.slice(11, 19)}] ${text}\n`);
  } catch { /* setup channel has no folder */ }
  bus.emit("event", { type: "log", id, line: text, t });
}
function emitProject(p) { bus.emit("event", { type: "project", id: p.id, project: decorate(p) }); }
function update(id, patch) {
  const p = S.getProject(id);
  if (!p) throw new Error("project not found");
  const next = typeof patch === "function" ? patch(p) || p : Object.assign(p, patch);
  S.saveProject(next);
  emitProject(next);
  return next;
}
function decorate(p) {
  const dir = S.projDir(p.id);
  const has = (f) => fs.existsSync(path.join(dir, f));
  let snapshots = [];
  try {
    snapshots = fs.readdirSync(path.join(dir, "snapshots")).filter((f) => /\.png$/i.test(f)).sort();
  } catch { /* none yet */ }
  return {
    ...p,
    busy: jobs.has(p.id) ? jobs.get(p.id).name : null,
    files: {
      voice: has("assets/vo/voice.mp3"),
      words: has("assets/vo/words.json"),
      reel: has("renders/reel.mp4"),
      tiles: has("renders/tiles.jpg"),
      snapshots,
    },
    dir,
  };
}

// ---------- background music for animated reels (free search or the creator's own song) ----------
async function prepareMusic(id, ctx) {
  let p = S.getProject(id);
  const dir = S.projDir(id), vo = path.join(dir, "assets", "vo");
  const m = p.form.music || { mode: "none" };
  const out = path.join(vo, "music.wav"), beats = path.join(vo, "beats.json");
  for (const f of [out, beats]) if (fs.existsSync(f)) fs.unlinkSync(f);
  let src = null, credit = null;
  if (m.mode === "upload" && m.file && fs.existsSync(path.join(dir, m.file))) {
    src = path.join(dir, m.file); credit = `music: your own track (${path.basename(m.file)})`;
  } else if (m.mode === "search") {
    ctx.log(`Searching free music: “${m.query}”…`);
    const T = require("./talking");
    const list = await T.stockJSON(["music", "--query", m.query || "chill lofi hip hop", "--n", "5", "--min-dur", String(Math.round(Math.min(120, (p.voiceSeconds || 30) + 2)))], ctx);
    for (const c of list) {
      try {
        const f = path.join(vo, "music-src.mp3");
        await R.runOk(R.python(), [path.join(S.RES_ROOT, "tools", "stock.py"), "download", "--url", c.url, "--out", f], { env: T.stockEnv(), onSpawn: ctx.onSpawn });
        src = f; credit = `music: ${c.title} by ${c.author || "unknown"} (${c.source}, ${c.license}) ${c.page || ""}`;
        break;
      } catch { ctx.log("  that track failed, trying the next…"); }
    }
    if (!src) ctx.log("  no free music found (add a Freesound key in Settings): continuing with voice + SFX only.");
  }
  if (src) {
    const len = (p.voiceSeconds || 30) + 1.6;
    await R.runOk("ffmpeg", ["-v", "error", "-y", "-stream_loop", "-1", "-i", src, "-t", len.toFixed(2), "-af", `afade=t=in:d=0.4,afade=t=out:st=${Math.max(0, len - 1.6).toFixed(2)}:d=1.6`, "-ar", "48000", "-ac", "2", out], { cwd: dir, onSpawn: ctx.onSpawn });
    const r = await R.run(R.python(), [path.join(S.RES_ROOT, "tools", "beats.py"), out, beats], { cwd: dir, quiet: true });
    ctx.log(r.code === 0 ? `✔ Music ready · ${r.out.trim().split("\n").pop()}` : "✔ Music ready (beat map failed; cuts follow the voice only).");
  }
  update(id, (q) => { q.steps.music = true; q.musicCredit = credit; });
  p = S.getProject(id);
  if (p.steps.build) { // music changed after the scenes were built: just rebuild the audio mix
    await R.runOk(R.python(), [p.engine === "canvas" ? "tools/build_canvas.py" : "tools/build.py"], { cwd: dir, onLine: ctx.log });
    update(id, (q) => { q.steps.render = false; });
  }
}
function setMusic(id, music) {
  const p = update(id, (q) => { q.form.music = music; q.steps.music = false; if (q.steps.build) q.steps.render = false; });
  if (p.planApproved && p.steps.voice && p.steps.words && !jobs.has(id)) runAuto(id);
  return p;
}

// ---------- product screenshots (headless Chrome already on this computer) ----------
async function captureProduct(id, ctx) {
  const p = S.getProject(id);
  const urls = String(p.form.productUrl || "").split(/[\s,]+/).filter((u) => /^https?:\/\//i.test(u)).slice(0, 3);
  if (!urls.length || p.productShots) return;
  const chrome = S.getSettings().browserPath || R.findBrowser();
  if (!chrome) { ctx.log("No Chrome/Edge found for product screenshots (set it in Settings → Browser for rendering)."); return; }
  const dir = path.join(S.projDir(id), "assets", "img");
  fs.mkdirSync(dir, { recursive: true });
  const shots = [];
  for (const [k, url] of urls.entries()) {
    for (const [kind, size, ua] of [["phone", "390,844", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"], ["desktop", "1440,900", ""]]) {
      const out = path.join(dir, `product-${k + 1}-${kind}.png`);
      ctx.log(`Screenshotting ${url} (${kind})…`);
      const args = ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", "--no-default-browser-check", `--user-data-dir=${path.join(S.DATA, "tmp", "chrome-shot")}`,
        `--window-size=${size}`, ...(kind === "phone" ? [`--force-device-scale-factor=2.77`, `--user-agent=${ua}`] : []), "--virtual-time-budget=6000", `--screenshot=${out}`, url];
      await R.run(chrome, args, { quiet: true, timeoutMs: 60000, onSpawn: ctx.onSpawn });
      if (fs.existsSync(out) && fs.statSync(out).size > 2000) shots.push(path.basename(out));
      else ctx.log(`  couldn't screenshot ${url} (${kind}).`);
    }
  }
  update(id, (q) => { q.productShots = shots; });
  if (shots.length) ctx.log(`✔ ${shots.length} product screenshot${shots.length === 1 ? "" : "s"} saved for Claude to use.`);
}

// notes about extra assets for the build prompt (product screenshots, music beats)
function assetsNote(p) {
  const dir = S.projDir(p.id), out = [];
  try {
    const shots = fs.readdirSync(path.join(dir, "assets", "img")).filter((f) => /^product-.*\.(png|jpg)$/i.test(f));
    if (shots.length) out.push(`Real product screenshots of ${p.form.productUrl || "the creator's product"} are in assets/img/: ${shots.join(", ")} (phone = 1080 wide portrait, desktop = 1440×900). Show them inside the style (a phone or laptop frame, a browser window, a card) where the plan talks about the product; crop/zoom to the part being discussed${p.engine === "canvas" ? ". In canvas pieces load them with an Image() from 'assets/img/<file>' at the top of scenes.js and draw them once loaded (keep a placeholder until then)" : ""}.`);
  } catch { /* none */ }
  if (fs.existsSync(path.join(dir, "assets", "vo", "beats.json"))) out.push("Background music is mixed under the voice; its beat map is in assets/vo/beats.json (bpm, beats, downbeats, hits; seconds on the timeline). Where it doesn't fight the voice, land scene cuts and big entrances on beats/downbeats and the payoff on the biggest hit.");
  return out.length ? `\n${out.join("\n")}\n` : "";
}

// ---------- vars for prompt templates ----------
function vars(p, extra = {}) {
  const s = S.getSettings();
  const talking = p.kind === "talking";
  const style = S.getStyles().find((x) => x.id === p.form.styleId) || S.getStyles()[0];
  const lang = S.getLanguages().find((x) => x.id === p.form.language) || S.getLanguages()[0];
  const cta = (p.form.cta || "").trim();
  return {
    title: (p.plan && p.plan.title) || p.form.topic,
    topic: p.form.topic,
    length: p.form.length,
    words_target: Math.round(p.form.length * (lang.wps || 2.5)),
    style_name: style.name, style_brief: style.brief, style_prompt: style.prompt,
    language_label: lang.label, language_rules: lang.rules,
    cta_line: cta ? `end with "Comment ${cta}" and one short reason to comment.` : "end with one short call to action that fits (follow, save, or comment one keyword).",
    notes: ((p.form.notes || "").trim() || "none") + (p.productShots && p.productShots.length ? `\nThe creator's real product (${p.form.productUrl}) is screenshotted in assets/img/: ${p.productShots.join(", ")}. Look at them (Read) and plan rows that show the real screens inside the style.` : ""),
    python: R.python(), hf: s.hf,
    build_cmd: `${R.python()} tools/${talking ? "build_talking.py" : p.engine === "canvas" ? "build_canvas.py" : "build.py"}`,
    canvas_style: style.canvasStyle || "",
    caption_style_id: p.form.captionStyle === "pop" ? "pop" : "box",
    assets_note: assetsNote(p),
    accent: s.accent || "#ff6a2b",
    caption_style: p.form.captionStyle === "pop" ? "pop & colour (words pop in, active word turns accent)" : "highlight box (active word in an accent box)",
    ...extra,
  };
}
function writeClaudeMd(p) {
  fs.writeFileSync(path.join(S.projDir(p.id), "CLAUDE.md"), S.fill(S.getPrompt(p.kind === "talking" ? "talking_system" : p.engine === "canvas" ? "system_canvas" : "system"), vars(p)));
}

// ---------- jobs ----------
function startJob(id, name, fn) {
  if (jobs.has(id)) throw new Error(`Busy: ${jobs.get(id).name} is still running`);
  const job = { name, child: null, cancelled: false };
  jobs.set(id, job);
  const ctx = {
    log: (l) => log(id, l),
    onSpawn: (c) => { job.child = c; },
    check: () => { if (job.cancelled) throw new Error("Stopped by you"); },
  };
  const p0 = S.getProject(id);
  if (p0) emitProject(p0);
  (async () => {
    try {
      await fn(ctx);
    } catch (e) {
      const msg = e.message || String(e);
      log(id, `✖ ${msg}`);
      try { update(id, { status: job.cancelled ? "stopped" : "error", error: msg }); } catch { /* setup channel */ }
    } finally {
      jobs.delete(id);
      const p = S.getProject(id);
      if (p) emitProject(p);
      bus.emit("event", { type: "job-done", id, name });
    }
  })();
}
function cancel(id) {
  const j = jobs.get(id);
  if (!j) return false;
  j.cancelled = true;
  R.killTree(j.child);
  return true;
}
function recoverInterrupted() {
  for (const p of S.listProjects()) {
    if (RUNNING.includes(p.status)) {
      p.status = "error";
      p.error = "Interrupted (the app was closed while this was running). Click Continue to pick up where it stopped.";
      S.saveProject(p);
    }
  }
}

// ---------- create ----------
function createProject(form) {
  const f = {
    topic: String(form.topic || "").trim(),
    styleId: form.styleId || "paper",
    length: Math.max(10, Math.min(90, parseInt(form.length, 10) || 40)),
    cta: String(form.cta || "").trim(),
    language: form.language || "en",
    voiceMode: form.voiceMode === "upload" ? "upload" : "ai",
    voice: form.voice || null,
    notes: String(form.notes || "").trim(),
    productUrl: String(form.productUrl || "").trim(),
    captionStyle: form.captionStyle === "pop" ? "pop" : "box",
    music: form.music && form.music.mode === "search" ? { mode: "search", query: String(form.music.query || "chill lofi hip hop") } : { mode: "none" },
  };
  if (!f.topic) throw new Error("Topic is required");
  if (f.voiceMode === "ai" && !f.voice) {
    const s = S.getSettings();
    f.voice = f.language === "en" ? s.voiceEn : s.voiceMs;
  }
  const id = S.newId(f.topic);
  const dir = S.projDir(id);
  const st = S.getStyles().find((x) => x.id === f.styleId) || {};
  const canvas = st.engine === "canvas";
  S.copyDir(path.join(S.RES_ROOT, canvas ? "kit-canvas" : "kit"), dir);
  if (canvas) {
    // the style's demo piece is the starting point Claude rewrites for this reel
    const demo = path.join(dir, "animate", "styles", st.canvasStyle, "demo", "src");
    const head = fs.readFileSync(path.join(demo, "head.html"), "utf8");
    const i = head.indexOf('"use strict";');
    fs.mkdirSync(path.join(dir, "piece"), { recursive: true });
    fs.writeFileSync(path.join(dir, "piece", "head.js"), (i >= 0 ? head.slice(i + 13) : head).replace(/const DURATION = [\d.]+;/, "const DURATION = TOTAL;"));
    for (const fn of ["scenes.js", "bridges.js"]) fs.copyFileSync(path.join(demo, fn), path.join(dir, "piece", fn));
    fs.writeFileSync(path.join(dir, "piece", "piece.json"), JSON.stringify({ style: st.canvasStyle, captions: f.captionStyle === "pop" ? "pop" : "box", captionY: 0.22, accent: S.getSettings().accent || "#ff6a2b" }, null, 1));
    fs.writeFileSync(path.join(dir, "piece", "sfx.json"), "[]");
  }
  S.addShared(dir);
  for (const t of ["whisper-words.py", "tts_edge.py"]) fs.copyFileSync(path.join(S.RES_ROOT, "tools", t), path.join(dir, "tools", t));
  for (const d of ["assets/vo", "renders", "logs", "snapshots"]) fs.mkdirSync(path.join(dir, d), { recursive: true });
  // theme for tools/build.py: the style's own theme, or the one it names
  fs.writeFileSync(path.join(dir, "assets", "style.txt"), st.theme || (["paper", "blueprint", "poster", "neon", "storybook"].includes(f.styleId) ? f.styleId : "paper"));
  if (!canvas) {
    fs.writeFileSync(path.join(dir, "reel.json"), JSON.stringify({ scenes: [{ id: "hook", from: 0 }], captions: "auto", sfx: [], cut_whoosh: true, clips: [] }, null, 1));
    fs.writeFileSync(path.join(dir, "assets", "scenes.js"), "// Scenes for this reel: RS.scene(\"<id>\", (s) => { ... }); see GUIDE.md\n");
  }
  const p = {
    id, title: f.topic, status: "draft", form: f, plan: null, steps: {}, engine: canvas ? "canvas" : "html",
    sessionId: null, cost: 0, createdAt: new Date().toISOString(), history: [],
  };
  S.saveProject(p);
  writeClaudeMd(p);
  return p;
}

// ---------- plan ----------
function parsePlan(text) {
  let t = String(text || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a < 0 || b < a) throw new Error("Claude did not return a plan (no JSON found). Try Regenerate.");
  const j = JSON.parse(t.slice(a, b + 1));
  const str = (x) => (x === undefined || x === null ? "" : String(x).trim());
  const plan = {
    title: str(j.title) || "Untitled reel",
    hook: { text: str(j.hook && j.hook.text), spoken: str(j.hook && j.hook.spoken), visual: str(j.hook && j.hook.visual) },
    rows: (Array.isArray(j.rows) ? j.rows : []).map((r) => ({ spoken: str(r.spoken), text: str(r.text), visual: str(r.visual) })).filter((r) => r.spoken),
    voice_script: str(j.voice_script),
    notes: str(j.notes),
  };
  if (!plan.rows.length) throw new Error("The plan came back with no spoken lines. Try Regenerate.");
  if (!plan.voice_script) plan.voice_script = plan.rows.map((r) => r.spoken).join(" ");
  return plan;
}
const addCost = (p, c) => { p.cost = Math.round(((p.cost || 0) + (c || 0)) * 10000) / 10000; };

function generatePlan(id) {
  startJob(id, "Planning", async (ctx) => {
    let p = update(id, { status: "planning", error: null });
    await captureProduct(id, ctx);
    p = S.getProject(id);
    ctx.log("Asking Claude for the hook and the scene-by-scene plan…");
    const r = await R.claude(S.fill(S.getPrompt("plan"), vars(p)), { cwd: S.projDir(id), onLine: ctx.log, onSpawn: ctx.onSpawn });
    const plan = parsePlan(r.text);
    update(id, (q) => { q.plan = plan; q.title = plan.title; q.status = "planned"; q.planApproved = false; addCost(q, r.cost); q.history.push({ at: new Date().toISOString(), what: "plan generated" }); });
    ctx.log(`✔ Plan ready: ${plan.rows.length} lines, ~${countWords(plan)} words. Review it, edit anything, then Approve.`);
  });
}
function revisePlan(id, note) {
  startJob(id, "Revising plan", async (ctx) => {
    let p = update(id, { status: "planning", error: null });
    ctx.log(`Revising the plan: ${note}`);
    const prompt = S.fill(S.getPrompt("revise"), vars(p, { plan_json: JSON.stringify(p.plan, null, 2), note }));
    const r = await R.claude(prompt, { cwd: S.projDir(id), onLine: ctx.log, onSpawn: ctx.onSpawn });
    const plan = parsePlan(r.text);
    update(id, (q) => { q.plan = plan; q.title = plan.title; q.status = "planned"; q.planApproved = false; addCost(q, r.cost); q.history.push({ at: new Date().toISOString(), what: `plan revised: ${note}` }); });
    ctx.log("✔ Plan revised.");
  });
}
function savePlan(id, plan) {
  const p = S.getProject(id);
  if (jobs.has(id)) throw new Error("Busy, wait for the current step");
  p.plan = { ...p.plan, ...plan };
  p.title = p.plan.title || p.title;
  if (p.planApproved) { p.planApproved = false; p.status = "planned"; }
  S.saveProject(p); emitProject(p);
  return p;
}
const countWords = (plan) => plan.rows.map((r) => r.spoken).join(" ").split(/\s+/).filter(Boolean).length;

function planToMd(plan) {
  const cell = (s) => String(s || "").replace(/\|/g, "/").replace(/\n/g, " ");
  const lines = [
    `# ${plan.title}`, "",
    "Hook",
    `- TEXT: "${plan.hook.text}"`, `- SPOKEN: "${plan.hook.spoken}"`, `- VISUAL: ${plan.hook.visual}`, "",
    "| # | SPOKEN | TEXT | VISUAL |", "|---|---|---|---|",
    ...plan.rows.map((r, i) => `| ${i + 1} | ${cell(r.spoken)} | ${cell(r.text)} | ${cell(r.visual)} |`),
  ];
  if (plan.notes) lines.push("", `Notes: ${plan.notes}`);
  return lines.join("\n");
}
const spokenScript = (plan) => plan.rows.map((r) => r.spoken.replace(/\[[^\]]*\]/g, "").replace(/\s+/g, " ").trim()).join("\n");

// ---------- approve → automatic pipeline ----------
function approve(id) {
  const p = S.getProject(id);
  if (!p.plan) throw new Error("No plan yet");
  fs.writeFileSync(path.join(S.projDir(id), "plan.md"), planToMd(p.plan));
  p.planApproved = true;
  p.status = "approved";
  p.error = null;
  // a new approved plan means new scenes; keep an uploaded/generated voice only if the script didn't change
  const script = spokenScript(p.plan);
  if (p.voiceScript !== script && p.voiceSource === "ai") p.steps.voice = false;
  p.steps.words = false; p.steps.music = false; p.steps.build = false; p.steps.render = false;
  p.sessionId = null;
  p.history.push({ at: new Date().toISOString(), what: "plan approved" });
  S.saveProject(p);
  writeClaudeMd(p);
  runAuto(id);
}

function runAuto(id) {
  startJob(id, "Making the reel", async (ctx) => {
    let p = S.getProject(id);
    if (!p.planApproved) throw new Error("Approve the plan first");
    if (!p.steps.voice) {
      if (p.form.voiceMode === "upload") {
        update(id, { status: "needs_voice", error: null });
        ctx.log("Waiting for your voice recording: upload it on the Voice step and the reel continues by itself.");
        return;
      }
      await makeAiVoice(id, ctx);
      ctx.check();
    }
    p = S.getProject(id);
    if (!p.steps.words) { await transcribe(id, ctx); ctx.check(); }
    p = S.getProject(id);
    if (!p.steps.music) { await prepareMusic(id, ctx); ctx.check(); }
    p = S.getProject(id);
    if (!p.steps.build) { await buildScenes(id, ctx); ctx.check(); }
    p = S.getProject(id);
    if (!p.steps.render) { await renderAndCheck(id, ctx, { qa: S.getSettings().autoQA }); }
  });
}

// ---------- voice ----------
async function makeAiVoice(id, ctx, override) {
  let p = update(id, { status: "voicing", error: null });
  const v = override || p.form.voice || {};
  const dir = S.projDir(id);
  const script = spokenScript(p.plan);
  fs.writeFileSync(path.join(dir, "assets/vo/script.txt"), script);
  const out = path.join(dir, "assets/vo/voice.mp3");
  await tts({ ...v, lang: p.form.language, textFile: path.join(dir, "assets/vo/script.txt"), out, cwd: dir, ctx });
  update(id, (q) => {
    q.steps.voice = true; q.steps.words = false; q.steps.music = false; q.steps.build = false; q.steps.render = false;
    q.voiceSource = "ai"; q.voiceScript = script; q.voiceInfo = { engine: v.engine, voice: v.voice, name: v.voiceName || v.voice, model: v.model };
    if (override) q.form.voice = override;
  });
  ctx.log("✔ Voice ready.");
}

// Kokoro voice -> closest free Edge voice, used only if Kokoro can't run on this computer.
const EDGE_FOR_KOKORO = { af: "en-US-AvaNeural", am: "en-US-AndrewNeural", bf: "en-GB-SoniaNeural", bm: "en-GB-RyanNeural" };

async function hasPyModules(mods) {
  const r = await R.run(R.python(), ["-c", `import ${mods.join(", ")}`], { quiet: true, timeoutMs: 60000 });
  return r.code === 0;
}
async function ensureKokoro(log, onSpawn) {
  if (await hasPyModules(["kokoro_onnx", "soundfile"])) return true;
  log(`Kokoro isn't installed for ${R.pythonExe(R.python())}. Installing kokoro-onnx + soundfile (one time, about a minute)…`);
  const r = await R.run(R.python(), ["-m", "pip", "install", "kokoro-onnx", "soundfile"], { onLine: log, onSpawn });
  if (r.code !== 0) await R.run(R.python(), ["-m", "pip", "install", "--user", "kokoro-onnx", "soundfile"], { onLine: log, onSpawn });
  return hasPyModules(["kokoro_onnx", "soundfile"]);
}

async function tts({ engine, voice, speed, rate, model, stability, similarity, style, lang, textFile, out, cwd, ctx }) {
  const log = ctx ? ctx.log : () => {};
  const onSpawn = ctx && ctx.onSpawn;
  if (engine === "elevenlabs") {
    const text = fs.readFileSync(textFile, "utf8").replace(/\[[^\]]*\]/g, "").trim();
    await EL.speak({ text, voice, model, lang, stability, similarity, style, speed, out, log });
    if (!fs.existsSync(out) || fs.statSync(out).size < 1000) throw new Error("ElevenLabs returned an empty voice file.");
    return;
  }
  const edge = async (v, r) => {
    if (!(await hasPyModules(["edge_tts"]))) {
      log("Installing edge-tts (one time)…");
      await R.run(R.python(), ["-m", "pip", "install", "edge-tts"], { onLine: log, onSpawn });
    }
    log(`Generating the voice with Edge TTS (${v})…`);
    await R.runOk(R.python(), [path.join(S.RES_ROOT, "tools", "tts_edge.py"), textFile, out, v, r || "+0%"], { cwd, onLine: log, onSpawn });
  };
  if (engine === "edge") {
    await edge(voice, rate);
  } else {
    const v = voice || "af_heart";
    let ok = await ensureKokoro(log, onSpawn);
    let r = null;
    const wav = out.replace(/\.mp3$/i, ".tts.wav");
    if (ok) {
      log(`Generating the voice with Kokoro (${v}), offline. The first run downloads the voice model (~300 MB)…`);
      r = await R.npxHF(["tts", textFile, "-o", wav, "-v", v, "-s", String(speed || 1), "--json"], { cwd, onLine: log, onSpawn });
      ok = r.code === 0 && fs.existsSync(wav);
    }
    if (ok) {
      await R.runOk("ffmpeg", ["-v", "error", "-y", "-i", wav, "-ar", "44100", "-ac", "1", "-b:a", "192k", out], { cwd });
      try { fs.unlinkSync(wav); } catch { /* fine */ }
    } else {
      const fallback = EDGE_FOR_KOKORO[v.slice(0, 2)] || "en-US-AvaNeural";
      log(`✖ Kokoro couldn't run here${r ? `: ${r.out.trim().split("\n").slice(-2).join(" ")}` : ""}`);
      log(`Using the free Edge voice ${fallback} instead so the reel can continue. (Setup → Install Python packages fixes Kokoro for next time.)`);
      const pct = `${Math.round(((speed || 1) - 1) * 100) >= 0 ? "+" : ""}${Math.round(((speed || 1) - 1) * 100)}%`;
      await edge(fallback, pct);
    }
  }
  if (!fs.existsSync(out) || fs.statSync(out).size < 1000) throw new Error("The voice file came out empty. For Edge TTS check your internet connection.");
}

async function uploadVoice(id, file) {
  const dir = S.projDir(id);
  const out = path.join(dir, "assets/vo/voice.mp3");
  await R.runOk("ffmpeg", ["-v", "error", "-y", "-i", file, "-ar", "44100", "-ac", "1", "-b:a", "192k", out], { cwd: dir });
  const p = update(id, (q) => {
    q.steps.voice = true; q.steps.words = false; q.steps.music = false; q.steps.build = false; q.steps.render = false;
    q.voiceSource = "upload"; q.voiceInfo = { file: path.basename(file) }; q.form.voiceMode = "upload";
    q.history.push({ at: new Date().toISOString(), what: "voice uploaded" });
  });
  log(id, `✔ Voice uploaded (${path.basename(file)}).`);
  if (p.planApproved && !jobs.has(id)) runAuto(id);
  return p;
}
function regenerateVoice(id, voice) {
  const p = S.getProject(id);
  if (!p.plan) throw new Error("No plan yet");
  startJob(id, "Making the voice", async (ctx) => {
    await makeAiVoice(id, ctx, voice);
    update(id, (q) => { q.form.voiceMode = "ai"; q.status = q.planApproved ? "approved" : "planned"; });
  });
  // continue the pipeline once the voice is done
  const off = (ev) => {
    if (ev.type === "job-done" && ev.id === id) {
      bus.off("event", off);
      const q = S.getProject(id);
      if (q && q.planApproved && q.steps.voice && q.status !== "error" && q.status !== "stopped") runAuto(id);
    }
  };
  bus.on("event", off);
}

// ---------- Whisper ----------
async function transcribe(id, ctx) {
  let p = update(id, { status: "transcribing", error: null });
  const s = S.getSettings();
  const lang = S.getLanguages().find((x) => x.id === p.form.language) || { whisper: "en" };
  const dir = S.projDir(id);
  ctx.log(`Getting word timings with Whisper (${s.whisperModel}, ${lang.whisper}). The first run downloads the model, so it can take a few minutes…`);
  await R.runOk(R.python(), ["tools/whisper-words.py", "assets/vo/voice.mp3", "assets/vo/words.json", lang.whisper, s.whisperModel], { cwd: dir, onLine: ctx.log, onSpawn: ctx.onSpawn });
  const words = S.readJSON(path.join(dir, "assets/vo/words.json"), []);
  if (!words.length) throw new Error("Whisper found no words in the voice file.");
  const dur = await probeDuration(path.join(dir, "assets/vo/voice.mp3"));
  update(id, (q) => { q.steps.words = true; q.wordCount = words.length; q.voiceSeconds = Math.round(dur * 10) / 10; });
  ctx.log(`✔ ${words.length} words timed (${dur.toFixed(1)} s).`);
}

// ---------- Claude build ----------
async function buildScenes(id, ctx) {
  let p = update(id, { status: "building", error: null });
  const dir = S.projDir(id);
  writeClaudeMd(p);
  ctx.log("Claude is building every scene (timing, captions, sound effects, animation, lint, snapshots). This usually takes 10–30 minutes…");
  const prompt = S.fill(S.getPrompt(p.engine === "canvas" ? "build_canvas" : "build"), vars(p, { plan_md: planToMd(p.plan), word_count: p.wordCount, voice_seconds: p.voiceSeconds }));
  const r = await R.claude(prompt, { cwd: dir, tools: BUILD_TOOLS, onLine: ctx.log, onSpawn: ctx.onSpawn, timeoutMs: 90 * 60 * 1000 });
  update(id, (q) => { q.sessionId = r.sessionId; q.buildSummary = r.text; addCost(q, r.cost); });
  ctx.check();
  await ensureBuilt(id, ctx);
  update(id, (q) => { q.steps.build = true; q.history.push({ at: new Date().toISOString(), what: "scenes built" }); });
  ctx.log("✔ Scenes built.");
}
async function ensureBuilt(id, ctx) {
  const dir = S.projDir(id);
  if (!fs.existsSync(path.join(dir, "index.html"))) {
    ctx.log("index.html missing, running the build once more…");
    const p = S.getProject(id);
    await R.runOk(R.python(), [p && p.kind === "talking" ? "tools/build_talking.py" : p && p.engine === "canvas" ? "tools/build_canvas.py" : "tools/build.py"], { cwd: dir, onLine: ctx.log });
  }
  const lint = await R.npxHF(["lint"], { cwd: dir, quiet: true });
  const summary = (lint.out.match(/\d+ error\(s\)[^\n]*/) || [""])[0].trim();
  ctx.log(`lint: ${summary || "done"}`);
}

// ---------- render + checks ----------
async function renderAndCheck(id, ctx, { qa }) {
  const dir = S.projDir(id);
  let p = update(id, { status: "rendering", error: null });
  const out = path.join(dir, "renders", "reel.mp4");
  if (fs.existsSync(out)) {
    const hist = path.join(dir, "renders", "history");
    fs.mkdirSync(hist, { recursive: true });
    fs.renameSync(out, path.join(hist, `reel-${Date.now()}.mp4`));
  }
  ctx.log("Rendering the MP4 (1080×1920). This depends on your computer, often a few minutes…");
  let r = await R.npxHF(["render", "-o", "renders/reel.mp4", "--quiet"], { cwd: dir, onLine: ctx.log, onSpawn: ctx.onSpawn });
  ctx.check();
  if (!fs.existsSync(out) && /headless-shell|HYPERFRAMES_BROWSER_PATH|browser/i.test(r.out) && !S.getSettings().browserPath) {
    const b = R.findBrowser();
    if (b) {
      ctx.log(`HyperFrames couldn't get its own browser, so using the one on this computer: ${b}`);
      S.saveSettings({ browserPath: b });
      r = await R.npxHF(["render", "-o", "renders/reel.mp4", "--quiet"], { cwd: dir, onLine: ctx.log, onSpawn: ctx.onSpawn });
      ctx.check();
    }
  }
  if (!fs.existsSync(out)) throw new Error(`Render failed (exit ${r.code}).\n${r.out.trim().split("\n").slice(-10).join("\n")}`);
  const info = await checkMp4(dir, ctx);
  info.checks = await autoChecks(dir, S.getProject(id), ctx);
  update(id, (q) => {
    q.steps.render = true; q.status = "rendered"; q.render = { ...info, at: new Date().toISOString() };
    q.history.push({ at: q.render.at, what: "rendered" });
  });
  ctx.log(`✔ Rendered: ${info.duration.toFixed(1)} s, voice loudness ${info.lufs === null ? "?" : info.lufs + " LUFS"}.`);

  if (!qa) return;
  p = S.getProject(id);
  update(id, { status: "checking" });
  ctx.log("Claude is checking frames from the MP4 itself…");
  const prompt = S.fill(S.getPrompt("qa"), vars(p, { duration: info.duration.toFixed(1), frames: info.frames, step: info.step.toFixed(2), lufs: info.lufs === null ? "unknown" : info.lufs, checks: info.checks.text }));
  const q = await R.claude(prompt, { cwd: dir, tools: BUILD_TOOLS, resume: p.sessionId || undefined, onLine: ctx.log, onSpawn: ctx.onSpawn });
  const fixed = /RESULT:\s*FIXED/i.test(q.text);
  update(id, (x) => { x.qa = { text: q.text, fixed, at: new Date().toISOString() }; x.sessionId = q.sessionId || x.sessionId; addCost(x, q.cost); x.status = "rendered"; });
  if (fixed) {
    ctx.log("Claude fixed something it saw, rendering once more…");
    await renderAndCheck(id, ctx, { qa: false });
  } else {
    ctx.log("✔ Frame check passed.");
  }
}

// Measured checks a reviewer misses by eye (ideas from cth9191/animate's review tools):
// dead beats = stretches where the picture barely changes; text = HyperFrames inspect overflow warnings.
async function autoChecks(dir, p, ctx) {
  const lines = [];
  const mp4 = path.join(dir, "renders", "reel.mp4");
  try {
    const r = await R.run("ffmpeg", ["-v", "error", "-i", mp4, "-vf", "fps=4,scale=180:-2,format=gray,tblend=all_mode=difference,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-", "-f", "null", "-"], { quiet: true, timeoutMs: 300000 });
    const vals = [];
    let t = null;
    for (const l of r.out.split("\n")) {
      const a = l.match(/pts_time:([\d.]+)/); if (a) t = parseFloat(a[1]);
      const b = l.match(/YAVG=([\d.]+)/); if (b && t !== null) vals.push([t, parseFloat(b[1])]);
    }
    if (vals.length > 8) {
      const win = vals.map((v, i) => [v[0], (v[1] + (vals[i + 1] ? vals[i + 1][1] : v[1])) / 2]);
      const sorted = win.map((w) => w[1]).sort((x, y) => x - y), med = sorted[Math.floor(sorted.length / 2)];
      const thr = Math.max(0.12, med * 0.12);
      const dead = [];
      let start = null;
      win.forEach(([tt, v], i) => {
        const still = v < thr;
        if (still && start === null) start = tt;
        if ((!still || i === win.length - 1) && start !== null) { if (tt - start >= 4) dead.push([start, tt]); start = null; }
      });
      lines.push(dead.length ? `DEAD BEATS (picture barely changes for 4 s or more): ${dead.map(([a, b]) => `${a.toFixed(1)}–${b.toFixed(1)} s`).join(", ")}. Add motion or a new visual tied to a spoken word there.` : "Dead beats: none (something changes at least every 4 s).");
    }
  } catch (e) { lines.push(`Dead-beat scan skipped (${String(e.message).slice(0, 80)}).`); }
  if (p.engine !== "canvas") {
    try {
      const r = await R.npxHF(["inspect", "--json", "--samples", "16"], { cwd: dir, quiet: true, timeoutMs: 300000 });
      const j = JSON.parse(r.out.slice(r.out.indexOf("{")));
      const bad = (j.issues || []).filter((x) => x.severity !== "info");
      lines.push(bad.length ? `TEXT/LAYOUT (hyperframes inspect): ${bad.slice(0, 12).map((x) => `${x.code} ${x.selector} at ${(x.times || [x.time]).map((tt) => (+tt).toFixed(1)).join("/")} s: ${x.message}`).join(" | ")}` : "Text/layout: no overflow or clipped text found by hyperframes inspect.");
    } catch (e) { lines.push("Text/layout inspect skipped."); }
  } else {
    lines.push("Text in canvas styles isn't in the DOM: check in-world text for clipping and overlap in the tile sheet yourself.");
  }
  const text = lines.join("\n");
  ctx.log(`Checks: ${text.replace(/\n/g, " · ").slice(0, 400)}`);
  return { text };
}

async function probeDuration(file) {
  const r = await R.run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { quiet: true });
  return parseFloat(r.out.trim()) || 0;
}
async function checkMp4(dir, ctx) {
  const mp4 = path.join(dir, "renders", "reel.mp4");
  const duration = await probeDuration(mp4);
  const frames = 12, step = duration / frames;
  await R.run("ffmpeg", ["-v", "error", "-y", "-i", mp4, "-vf", `fps=${(frames / Math.max(duration, 1)).toFixed(5)},scale=270:-1,tile=6x2:padding=6:color=white`, "-frames:v", "1", path.join(dir, "renders", "tiles.jpg")], { quiet: true });
  const loud = await R.run("ffmpeg", ["-hide_banner", "-nostats", "-i", mp4, "-af", "ebur128", "-f", "null", "-"], { quiet: true });
  const m = loud.out.match(/Integrated loudness:\s*\n?\s*I:\s*(-?[\d.]+)\s*LUFS/);
  const lufs = m ? parseFloat(m[1]) : null;
  return { file: "renders/reel.mp4", tiles: "renders/tiles.jpg", duration, frames, step, lufs, sizeMB: Math.round(fs.statSync(mp4).size / 1e5) / 10 };
}

// ---------- fix with a note ----------
function fix(id, note) {
  const p = S.getProject(id);
  if (!p.steps.build) throw new Error("Build the scenes first");
  startJob(id, "Fixing", async (ctx) => {
    let q = update(id, { status: "building", error: null });
    const dir = S.projDir(id);
    ctx.log(`Fixing: ${note}`);
    const r = await R.claude(S.fill(S.getPrompt("fix"), vars(q, { note })), { cwd: dir, tools: BUILD_TOOLS, resume: q.sessionId || undefined, onLine: ctx.log, onSpawn: ctx.onSpawn });
    update(id, (x) => { x.sessionId = r.sessionId || x.sessionId; x.lastFix = { note, text: r.text }; addCost(x, r.cost); x.steps.render = false; x.history.push({ at: new Date().toISOString(), what: `fix: ${note}` }); });
    await ensureBuilt(id, ctx);
    await renderAndCheck(id, ctx, { qa: S.getSettings().autoQA });
  });
}
function rerender(id) {
  startJob(id, "Rendering", async (ctx) => {
    update(id, (x) => { x.steps.render = false; });
    await ensureBuilt(id, ctx);
    await renderAndCheck(id, ctx, { qa: false });
  });
}
function continueProject(id) {
  const p = S.getProject(id);
  if (p.kind === "talking") return require("./talking").continueTalking(id);
  if (!p.plan) return generatePlan(id);
  if (!p.planApproved) { update(id, { status: "planned", error: null }); return; }
  runAuto(id);
}

module.exports = {
  bus, jobs, log, decorate, createProject, generatePlan, revisePlan, savePlan, approve, runAuto,
  uploadVoice, regenerateVoice, tts, fix, rerender, continueProject, cancel, recoverInterrupted,
  startJob, countWords, spokenScript, planToMd,
  setMusic, prepareMusic,
  update, vars, writeClaudeMd, ensureBuilt, renderAndCheck, addCost, BUILD_TOOLS, probeDuration,
};
