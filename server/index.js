// Reel Studio: local web app that drives Claude Code + HyperFrames to make animated reels.
const fs = require("fs");
const path = require("path");
const express = require("express");
const multer = require("multer");
const { spawn } = require("child_process");
const S = require("./store");
const R = require("./runner");
const P = require("./pipeline");
const SETUP = require("./setup");
const L = require("./license");
const T = require("./talking");

fs.mkdirSync(S.getSettings().projectsDir, { recursive: true });
fs.mkdirSync(path.join(S.DATA, "tmp"), { recursive: true });
P.recoverInterrupted();
SETUP.ensureGsap().catch((e) => console.log("  GSAP not downloaded yet:", e.message));

const app = express();
app.use(express.json({ limit: "5mb" }));
app.use(express.static(path.join(S.APP_ROOT, "public")));

const wrap = (fn) => async (req, res) => {
  try { const out = await fn(req, res); if (!res.headersSent) res.json(out === undefined ? { ok: true } : out); }
  catch (e) { res.status(400).json({ error: e.message || String(e) }); }
};
const must = (id) => { const p = S.getProject(id); if (!p) throw new Error("Project not found"); return p; };

// ---------- app state ----------
// ---------- licence ----------
app.use(L.guard);
app.get("/api/license", wrap(() => L.status()));
app.post("/api/license/activate", wrap((req) => L.activate((req.body || {}).key)));
app.post("/api/license/check", wrap(() => L.validate(true)));
app.post("/api/license/deactivate", wrap(() => L.deactivate()));
L.validate().catch(() => {});
setInterval(() => L.validate().catch(() => {}), 6 * 3600 * 1000).unref();

app.get("/api/state", wrap(() => ({
  license: L.status(),
  settings: S.getSettings(), styles: S.publicStyles(), packed: S.PACKED, languages: S.getLanguages(), voices: S.getVoices(),
  elevenlabs: { models: require("./elevenlabs").MODELS, defaultModel: require("./elevenlabs").DEFAULT_MODEL, hasKey: !!(S.getSettings().elevenlabsKey || "").trim() },
  dataDir: S.DATA, python: R.python(), platform: process.platform,
})));
app.put("/api/settings", wrap((req) => S.saveSettings(req.body || {})));

// ---------- prompts ----------
app.get("/api/prompts", wrap(() => ({ prompts: S.listPrompts(), styles: S.publicStyles(), packed: S.PACKED })));
app.put("/api/prompts/:name", wrap((req) => { S.savePrompt(req.params.name, String(req.body.text || "")); }));
app.delete("/api/prompts/:name", wrap((req) => { S.resetPrompt(req.params.name); }));
app.put("/api/styles", wrap((req) => { S.saveStyles(req.body.styles); }));
app.delete("/api/styles", wrap(() => { S.resetPrompt("styles.json"); }));

// ---------- projects ----------
app.get("/api/projects", wrap(() => S.listProjects().map(P.decorate)));
app.post("/api/projects", wrap((req) => {
  const p = P.createProject(req.body || {});
  P.generatePlan(p.id);
  return P.decorate(S.getProject(p.id));
}));
app.get("/api/projects/:id", wrap((req) => P.decorate(must(req.params.id))));
app.delete("/api/projects/:id", wrap((req) => { must(req.params.id); P.cancel(req.params.id); S.trashProject(req.params.id); }));
app.put("/api/projects/:id/form", wrap((req) => {
  const p = must(req.params.id);
  p.form = { ...p.form, ...(req.body || {}) };
  S.saveProject(p);
  return P.decorate(p);
}));
app.put("/api/projects/:id/plan", wrap((req) => P.decorate(P.savePlan(req.params.id, req.body.plan))));
app.post("/api/projects/:id/plan/generate", wrap((req) => { must(req.params.id); P.generatePlan(req.params.id); }));
app.post("/api/projects/:id/plan/revise", wrap((req) => {
  const p = must(req.params.id);
  if (!p.plan) throw new Error("No plan yet");
  const note = String(req.body.note || "").trim();
  if (!note) throw new Error("Write what to change");
  P.revisePlan(req.params.id, note);
}));
app.post("/api/projects/:id/approve", wrap((req) => { const p = must(req.params.id); if (p.kind === "talking") T.approve(req.params.id); else P.approve(req.params.id); }));

// ---------- talking video ----------
const vupload = multer({ dest: path.join(S.DATA, "tmp"), limits: { fileSize: 4 * 1024 * 1024 * 1024 } });
app.post("/api/talking", vupload.single("video"), wrap((req) => {
  if (!req.file) throw new Error("Choose your video first");
  const ext = (path.extname(req.file.originalname) || ".mp4").toLowerCase();
  const named = `${req.file.path}${ext}`;
  fs.renameSync(req.file.path, named);
  const p = T.createTalking(req.body || {}, named);
  return P.decorate(S.getProject(p.id));
}));
const mupload = multer({ dest: path.join(S.DATA, "tmp"), limits: { fileSize: 200 * 1024 * 1024 } });
app.post("/api/projects/:id/music", mupload.single("song"), wrap((req) => {
  must(req.params.id);
  const mode = ["none", "search", "upload"].includes(req.body.mode) ? req.body.mode : "none";
  const music = { mode, query: String(req.body.query || "") };
  if (mode === "upload") {
    if (!req.file) { const cur = (S.getProject(req.params.id).form.music || {}); if (!cur.file) throw new Error("Choose a song file"); music.file = cur.file; }
    else {
      const ext = (path.extname(req.file.originalname) || ".mp3").toLowerCase();
      const rel = `assets/vo/music-upload${ext}`;
      fs.mkdirSync(path.join(S.projDir(req.params.id), "assets", "vo"), { recursive: true });
      fs.copyFileSync(req.file.path, path.join(S.projDir(req.params.id), rel)); fs.unlinkSync(req.file.path);
      music.file = rel; music.name = req.file.originalname;
    }
  }
  return P.decorate(P.setMusic(req.params.id, music));
}));
app.get("/api/projects/:id/words", wrap((req) => { must(req.params.id); return S.readJSON(path.join(S.projDir(req.params.id), "source", "words.json"), []); }));
app.put("/api/projects/:id/tplan", wrap((req) => P.decorate(T.savePlan(req.params.id, req.body.plan))));
app.post("/api/projects/:id/tplan/generate", wrap((req) => { must(req.params.id); T.regenerate(req.params.id); }));
app.post("/api/projects/:id/tplan/revise", wrap((req) => {
  const note = String(req.body.note || "").trim(); if (!note) throw new Error("Write what to change");
  must(req.params.id); T.revise(req.params.id, note);
}));
app.post("/api/projects/:id/tplan/search", wrap((req) => { must(req.params.id); T.researchSegment(req.params.id, req.body.segId, String(req.body.query || ""), req.body.kind); }));
app.post("/api/projects/:id/tplan/music", wrap((req) => { must(req.params.id); T.researchMusic(req.params.id, String(req.body.query || "")); }));
app.get("/api/motion-presets", wrap(() => S.readDefaultJSON("motion-presets.json", [])));
app.post("/api/projects/:id/continue", wrap((req) => { must(req.params.id); P.continueProject(req.params.id); }));
app.post("/api/projects/:id/cancel", wrap((req) => ({ cancelled: P.cancel(req.params.id) })));
app.post("/api/projects/:id/fix", wrap((req) => {
  const note = String(req.body.note || "").trim();
  if (!note) throw new Error("Describe what to fix");
  must(req.params.id); P.fix(req.params.id, note);
}));
app.post("/api/projects/:id/rerender", wrap((req) => { must(req.params.id); P.rerender(req.params.id); }));
app.post("/api/projects/:id/voice/generate", wrap((req) => { must(req.params.id); P.regenerateVoice(req.params.id, req.body.voice); }));

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => { const d = path.join(S.projDir(req.params.id), "assets", "vo"); fs.mkdirSync(d, { recursive: true }); cb(null, d); },
    filename: (req, file, cb) => cb(null, `upload-${Date.now()}${(path.extname(file.originalname) || ".audio").toLowerCase()}`),
  }),
  limits: { fileSize: 300 * 1024 * 1024 },
});
app.post("/api/projects/:id/voice/upload", upload.single("voice"), wrap(async (req) => {
  must(req.params.id);
  if (!req.file) throw new Error("No file received");
  return P.decorate(await P.uploadVoice(req.params.id, req.file.path));
}));

app.get("/api/projects/:id/log", wrap((req) => {
  const f = path.join(S.projDir(req.params.id), "logs", "pipeline.log");
  if (!fs.existsSync(f)) return { lines: [] };
  const lines = fs.readFileSync(f, "utf8").split("\n").filter(Boolean);
  return { lines: lines.slice(-400) };
}));
app.post("/api/projects/:id/open", wrap((req) => { must(req.params.id); openPath(S.projDir(req.params.id)); }));
app.post("/api/projects/:id/claude", wrap((req) => { must(req.params.id); openTerminal(S.projDir(req.params.id), S.getProject(req.params.id).sessionId); }));

// project files (snapshots, renders, voice)
app.get("/files/:id/*", (req, res) => {
  const base = path.resolve(S.projDir(req.params.id));
  const f = path.resolve(base, req.params[0]);
  if (!f.startsWith(base) || !fs.existsSync(f)) return res.status(404).end();
  res.set("Cache-Control", "no-store");
  res.sendFile(f);
});
app.use("/tmp", express.static(path.join(S.DATA, "tmp"), { maxAge: 0 }));

// ---------- ElevenLabs ----------
const EL = require("./elevenlabs");
app.get("/api/elevenlabs/voices", wrap((req) => EL.listVoices(req.query.refresh === "1")));
app.get("/api/elevenlabs/account", wrap(() => EL.account()));

// ---------- voice test ----------
app.post("/api/tts/test", wrap(async (req) => {
  const { engine, voice, speed, rate, model, stability, similarity, style, lang, text } = req.body || {};
  const dir = path.join(S.DATA, "tmp");
  const name = `test-${Date.now()}`;
  const txt = path.join(dir, `${name}.txt`), out = path.join(dir, `${name}.mp3`);
  fs.writeFileSync(txt, String(text || "Hello! This is how your reel will sound.").slice(0, 400));
  await P.tts({ engine, voice, speed, rate, model, stability, similarity, style, lang, textFile: txt, out, cwd: dir, ctx: { log: (l) => P.log("setup", l) } });
  return { url: `/tmp/${name}.mp3` };
}));

// ---------- setup ----------
app.get("/api/setup/check", wrap(() => SETUP.check()));
app.post("/api/setup/install-python", wrap(() => SETUP.installPython()));
app.post("/api/setup/install-all", wrap(() => SETUP.installAll()));
app.post("/api/setup/doctor", wrap(() => SETUP.doctor()));
app.post("/api/setup/skills", wrap(() => SETUP.hfSkills()));
app.post("/api/setup/whisper", wrap(() => SETUP.warmWhisper()));

// ---------- live events (SSE) ----------
app.get("/api/events", (req, res) => {
  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  res.flushHeaders();
  const send = (ev) => res.write(`data: ${JSON.stringify(ev)}\n\n`);
  send({ type: "hello", busy: [...P.jobs.entries()].map(([id, j]) => ({ id, name: j.name })) });
  P.bus.on("event", send);
  const ping = setInterval(() => res.write(": ping\n\n"), 20000);
  req.on("close", () => { clearInterval(ping); P.bus.off("event", send); });
});

// ---------- OS helpers ----------
function openPath(p) {
  if (process.platform === "win32") spawn("explorer", [p], { detached: true, stdio: "ignore" }).unref();
  else if (process.platform === "darwin") spawn("open", [p], { detached: true, stdio: "ignore" }).unref();
  else spawn("xdg-open", [p], { detached: true, stdio: "ignore" }).unref();
}
function openTerminal(dir, sessionId) {
  const cmd = `${S.getSettings().claudeCmd || "claude"}${sessionId ? ` --resume ${sessionId}` : ""}`;
  if (process.platform === "win32") spawn("cmd", ["/c", "start", "Reel Studio - Claude", "cmd", "/k", `cd /d "${dir}" && ${cmd}`], { detached: true, stdio: "ignore", shell: true }).unref();
  else if (process.platform === "darwin") spawn("osascript", ["-e", `tell app "Terminal" to do script "cd '${dir}' && ${cmd}"`], { detached: true, stdio: "ignore" }).unref();
  else throw new Error(`Open a terminal in ${dir} and run: ${cmd}`);
}

// listen on the configured port, or the next free one; module.exports.ready resolves with the URL
const basePort = parseInt(process.env.PORT, 10) || S.getSettings().port || 4477;
module.exports.ready = new Promise((resolve, reject) => {
  const tryPort = (port, left) => {
    const srv = app.listen(port, "127.0.0.1", () => {
      const url = `http://localhost:${port}`;
      console.log(`\n  Reel Studio is running at ${url}\n  Projects: ${S.getSettings().projectsDir}\n  Close this window to stop it.\n`);
      if (S.getSettings().openBrowser && !process.env.NO_OPEN) {
        try { if (process.platform === "win32") spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref(); else if (process.platform === "darwin") spawn("open", [url]).unref(); } catch { /* ignore */ }
      }
      resolve(url);
    });
    srv.on("error", (e) => (e.code === "EADDRINUSE" && left > 0 ? tryPort(port + 1, left - 1) : reject(e)));
  };
  tryPort(basePort, 10);
});
