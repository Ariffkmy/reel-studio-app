// Setup checks and one-click installs.
const S = require("./store");
const R = require("./runner");
const P = require("./pipeline");

const fs = require("fs");
const https = require("https");
const path = require("path");

const PY_PKGS = ["faster-whisper", "numpy", "edge-tts", "kokoro-onnx", "soundfile", "requests"];
const GSAP_URLS = (v) => [`https://cdn.jsdelivr.net/npm/gsap@${v}/dist/gsap.min.js`, `https://unpkg.com/gsap@${v}/dist/gsap.min.js`];

function download(url, out, hops = 0) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": "ReelStudio" } }, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location && hops < 5) { res.resume(); return resolve(download(new URL(res.headers.location, url).toString(), out, hops + 1)); }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode} for ${url}`)); }
      const chunks = []; res.on("data", (c) => chunks.push(c));
      res.on("end", () => { fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, Buffer.concat(chunks)); resolve(out); });
    }).on("error", reject);
  });
}
async function ensureGsap(log = () => {}) {
  const f = S.gsapFile();
  if (fs.existsSync(f) && fs.statSync(f).size > 20000) return f;
  for (const u of GSAP_URLS(S.GSAP_VERSION)) {
    try {
      log(`Downloading GSAP ${S.GSAP_VERSION} (the free animation library, from its official npm package)…`);
      await download(u, f);
      if (fs.statSync(f).size > 20000) { log("✔ GSAP ready."); return f; }
    } catch (e) { log(`  ${e.message}`); }
  }
  throw new Error("Could not download GSAP. Check your internet connection and try again.");
}

async function version(cmd, args = ["--version"]) {
  try {
    const r = await R.run(cmd, args, { quiet: true, timeoutMs: 30000 });
    return r.code === 0 ? r.out.trim().split("\n")[0] : null;
  } catch { return null; }
}

async function check() {
  const s = S.getSettings();
  const py = R.python();
  const items = [];
  const nv = await version("node");
  const nodeMajor = nv ? parseInt(nv.replace(/^v/, ""), 10) : 0;
  items.push({ name: "Node.js 22+ (runs HyperFrames)", ok: nodeMajor >= 22, detail: nv || "not found", fix: "winget install OpenJS.NodeJS.LTS", key: "node" });
  items.push({ name: "Animation library (GSAP)", ok: fs.existsSync(S.gsapFile()), detail: fs.existsSync(S.gsapFile()) ? `gsap ${S.GSAP_VERSION}` : "not downloaded", fix: "Click Install everything", key: "gsap" });

  const cl = await version(s.claudeCmd || "claude");
  items.push({ name: "Claude Code (the generation engine)", ok: !!cl, detail: cl || "not found", fix: "Click Install everything, then run  claude  once in a terminal and log in with your own Claude account", key: "claude" });

  const ff = await version("ffmpeg", ["-version"]);
  items.push({ name: "FFmpeg", ok: !!ff, detail: ff ? ff.replace(/Copyright.*/, "").trim() : "not found", fix: "winget install Gyan.FFmpeg   (then restart Reel Studio)", key: "ffmpeg" });
  const fp = await version("ffprobe", ["-version"]);
  items.push({ name: "FFprobe", ok: !!fp, detail: fp ? fp.replace(/Copyright.*/, "").trim() : "not found", fix: "comes with FFmpeg" });

  const pv = await version(py);
  items.push({ name: "Python 3", ok: !!pv && /Python 3/.test(pv), detail: pv ? `${pv} · ${R.pythonExe(py)}` : "not found", fix: "winget install Python.Python.3.12", key: "python" });

  if (pv) {
    const code = "import importlib.util as u, json; print(json.dumps({m: bool(u.find_spec(m)) for m in ['faster_whisper','numpy','edge_tts','kokoro_onnx','soundfile']}))";
    const r = await R.run(py, ["-c", code], { quiet: true, timeoutMs: 30000 });
    let mods = {};
    try { mods = JSON.parse(r.out.trim().split("\n").pop()); } catch { /* ignore */ }
    const row = (name, keys, need) => items.push({ name, ok: keys.every((k) => mods[k]), detail: keys.map((k) => `${k} ${mods[k] ? "✓" : "✗"}`).join(", "), fix: "Click Install Python packages", optional: !need });
    row("Whisper word timing (faster-whisper, numpy)", ["faster_whisper", "numpy"], true);
    row("Free English AI voice (Kokoro)", ["kokoro_onnx", "soundfile"], false);
    row("Malay + English online voice (Edge TTS, uses Microsoft’s online voice service)", ["edge_tts"], false);
  }
  return { items, python: py, settings: s };
}

function installPython() {
  P.startJob("setup", "Installing Python packages", async (ctx) => {
    ctx.log(`pip install ${PY_PKGS.join(" ")}`);
    const r = await R.run(R.python(), ["-m", "pip", "install", "-U", ...PY_PKGS], { onLine: ctx.log, onSpawn: ctx.onSpawn });
    R.resetPython();
    ctx.log(r.code === 0 ? `✔ Python packages installed into ${R.pythonExe(R.python())}.` : `✖ pip exited with ${r.code}. If it says "externally managed", run: ${R.python()} -m pip install --user ${PY_PKGS.join(" ")}`);
  });
}
function doctor() {
  P.startJob("setup", "HyperFrames doctor", async (ctx) => {
    const r = await R.npxHF(["doctor"], { onLine: ctx.log, onSpawn: ctx.onSpawn, cwd: S.DATA });
    ctx.log(r.code === 0 ? "✔ Doctor finished." : "Doctor finished with some checks failing (optional ones like whisper-cpp, MusicGen and Docker are not needed).");
  });
}
function hfSkills() {
  P.startJob("setup", "HyperFrames skills", async (ctx) => {
    const r = await R.npxHF(["skills"], { onLine: ctx.log, onSpawn: ctx.onSpawn, cwd: S.DATA });
    ctx.log(r.code === 0 ? "✔ HyperFrames skills installed for Claude Code." : `skills exited with ${r.code}`);
  });
}
function warmWhisper() {
  P.startJob("setup", "Downloading Whisper models", async (ctx) => {
    const s = S.getSettings();
    const names = [`${s.whisperModel}.en`, s.whisperModel].map((n) => `'${n}'`).join(",");
    const code = `from faster_whisper import WhisperModel as W; [(print('downloading', n, flush=True), W(n, device='cpu', compute_type='int8'), print('ok', n, flush=True)) for n in [${names}]]`;
    const r = await R.run(R.python(), ["-c", code], { onLine: ctx.log, onSpawn: ctx.onSpawn });
    ctx.log(r.code === 0 ? "✔ Whisper models ready." : "✖ Could not download the Whisper models.");
  });
}

// One click: install whatever is missing (Windows uses winget; elsewhere it lists what to install).
function installAll() {
  P.startJob("setup", "Installing everything", async (ctx) => {
    const { items } = await check();
    const miss = new Set(items.filter((i) => !i.ok && i.key).map((i) => i.key));
    const win = process.platform === "win32";
    const winget = async (id, label) => {
      ctx.log(`Installing ${label}…`);
      const r = await R.run("winget", ["install", "-e", "--id", id, "--accept-source-agreements", "--accept-package-agreements", "--silent"], { onLine: ctx.log, onSpawn: ctx.onSpawn });
      ctx.log(r.code === 0 ? `✔ ${label} installed.` : `✖ ${label}: winget exited with ${r.code}. Install it manually: winget install ${id}`);
      return r.code === 0;
    };
    let needRestart = false;
    if (win) {
      if (miss.has("node")) needRestart = (await winget("OpenJS.NodeJS.LTS", "Node.js")) || needRestart;
      if (miss.has("ffmpeg")) needRestart = (await winget("Gyan.FFmpeg", "FFmpeg")) || needRestart;
      if (miss.has("python")) needRestart = (await winget("Python.Python.3.12", "Python 3.12")) || needRestart;
      if (miss.has("claude")) {
        ctx.log("Installing Claude Code (Anthropic's official installer)…");
        const r = await R.run("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", "irm https://claude.ai/install.ps1 | iex"], { onLine: ctx.log, onSpawn: ctx.onSpawn });
        ctx.log(r.code === 0 ? "✔ Claude Code installed. Open a terminal, run  claude  once and log in with your own Claude account." : "✖ Claude Code install failed. See https://docs.claude.com/en/docs/claude-code/setup");
        needRestart = needRestart || r.code === 0;
      }
    } else {
      for (const k of miss) if (k !== "gsap") ctx.log(`Missing: ${k}. Install it with your package manager (see the Fix column).`);
    }
    if (miss.has("gsap")) await ensureGsap(ctx.log);
    if (needRestart) { ctx.log("⚠ Close and reopen Reel Studio so it sees the newly installed programs, then click Install everything again to finish."); return; }
    if (!miss.has("python")) {
      ctx.log(`pip install ${PY_PKGS.join(" ")}`);
      const r = await R.run(R.python(), ["-m", "pip", "install", "-U", ...PY_PKGS], { onLine: ctx.log, onSpawn: ctx.onSpawn });
      R.resetPython();
      ctx.log(r.code === 0 ? "✔ Python packages installed." : `✖ pip exited with ${r.code}.`);
    }
    ctx.log("✔ Done. Click Recheck.");
  });
}

module.exports = { check, installPython, doctor, hfSkills, warmWhisper, installAll, ensureGsap };

