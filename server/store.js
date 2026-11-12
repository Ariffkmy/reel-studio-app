// Settings, prompts and project storage for Reel Studio.
const fs = require("fs");
const os = require("os");
const path = require("path");

const crypto = require("crypto");
const APP_ROOT = path.resolve(__dirname, "..");
// In the installed app the code lives in app.asar; tools, kits and sounds are unpacked next to it
// because Python and other programs need real files.
const RES_ROOT = APP_ROOT.endsWith("app.asar") ? APP_ROOT + ".unpacked" : APP_ROOT;
const DATA = process.env.REEL_STUDIO_HOME || path.join(os.homedir(), "Documents", "ReelStudio");
const IS_WIN = process.platform === "win32";

const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } };
const writeJSON = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v, null, 2)); };

// ---------- settings ----------
const SETTINGS_FILE = path.join(DATA, "settings.json");
const DEFAULTS = {
  port: 4477,
  projectsDir: path.join(DATA, "projects"),
  python: "",               // empty = auto-detect
  claudeCmd: "claude",
  claudeModel: "",          // empty = Claude Code default
  hf: "0.8.145",
  browserPath: "",
  accent: "#ff6a2b",
  pexelsKey: "", pixabayKey: "", unsplashKey: "", freesoundKey: "", elevenlabsKey: "",
  colorGrade: true,          // empty = HyperFrames picks/downloads its own Chrome
  whisperModel: "medium",
  autoQA: true,
  openBrowser: true,
  voiceEn: { engine: "kokoro", voice: "af_heart", speed: 1.0 },
  voiceMs: { engine: "edge", voice: "ms-MY-YasminNeural", rate: "+0%" },
};
function getSettings() {
  const s = { ...DEFAULTS, ...readJSON(SETTINGS_FILE, {}) };
  s.voiceEn = { ...DEFAULTS.voiceEn, ...(s.voiceEn || {}) };
  s.voiceMs = { ...DEFAULTS.voiceMs, ...(s.voiceMs || {}) };
  return s;
}
function saveSettings(patch) {
  const cur = readJSON(SETTINGS_FILE, {});
  const next = { ...cur, ...patch };
  writeJSON(SETTINGS_FILE, next);
  return getSettings();
}

// ---------- prompts (defaults in app/prompts, user overrides in DATA/prompts) ----------
const PROMPT_NAMES = {
  system: "System prompt (CLAUDE.md written into every project)",
  system_canvas: "Canvas styles: system prompt (CLAUDE.md)",
  build_canvas: "Canvas styles: build the piece",
  talking_system: "Talking video: system prompt (CLAUDE.md)",
  talking_plan: "Talking video: plan the edit",
  talking_build: "Talking video: build scenes & check",
  plan: "Plan the reel",
  revise: "Revise the plan with a note",
  build: "Build every scene (after the voice is ready)",
  fix: "Fix what you see",
  qa: "Check the rendered MP4",
};
const DATA_FILES = ["styles.json", "languages.json", "voices.json"];
const defaultPath = (n) => path.join(APP_ROOT, "prompts", n);
const overridePath = (n) => path.join(DATA, "prompts", n);

// Installed builds ship the built-in prompts encrypted in prompts.bin (made by dev/protect.js).
const PACKED_FILE = path.join(APP_ROOT, "prompts.bin");
const PACKED = fs.existsSync(PACKED_FILE);
let bundle = null;
function packedKey() {
  return crypto.createHash("sha256").update(["rs", "reel", "studio", String(0x5eed), "prompts"].join(":")).digest();
}
function readDefault(n) {
  if (!PACKED) return fs.readFileSync(defaultPath(n), "utf8");
  if (!bundle) {
    const buf = fs.readFileSync(PACKED_FILE);
    const d = crypto.createDecipheriv("aes-256-gcm", packedKey(), buf.subarray(0, 12));
    d.setAuthTag(buf.subarray(12, 28));
    bundle = JSON.parse(Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8"));
  }
  if (!(n in bundle)) throw new Error(`missing built-in file ${n}`);
  return bundle[n];
}
const readDefaultJSON = (n, dflt) => { try { return JSON.parse(readDefault(n)); } catch { return dflt; } };

// Source runs: the user's file replaces the default. Installed builds: built-in prompts stay hidden,
// and what the user writes is added as extra instructions after them.
function readPromptFile(n) {
  const o = overridePath(n);
  if (PACKED && n.endsWith(".md")) {
    const extra = fs.existsSync(o) ? fs.readFileSync(o, "utf8").trim() : "";
    return readDefault(n) + (extra ? `\n\n## Extra instructions from the user\n${extra}\n` : "");
  }
  return fs.existsSync(o) ? fs.readFileSync(o, "utf8") : readDefault(n);
}
const getPrompt = (name) => readPromptFile(`${name}.md`);
function listPrompts() {
  return Object.entries(PROMPT_NAMES).map(([name, label]) => {
    const o = overridePath(`${name}.md`), custom = fs.existsSync(o);
    return { name, label, custom, text: PACKED ? (custom ? fs.readFileSync(o, "utf8") : "") : getPrompt(name) };
  });
}
function savePrompt(name, text) {
  if (!PROMPT_NAMES[name]) throw new Error("unknown prompt");
  fs.mkdirSync(path.join(DATA, "prompts"), { recursive: true });
  fs.writeFileSync(overridePath(`${name}.md`), text);
}
function resetPrompt(name) {
  for (const f of [`${name}.md`, name]) { const o = overridePath(f); if (fs.existsSync(o)) fs.unlinkSync(o); }
}
// Source runs: your saved styles first, plus any built-in style added later.
// Installed builds: the built-in styles (fixed) plus the styles you added.
const getStyles = () => {
  const defaults = JSON.parse(readDefault("styles.json"));
  const o = overridePath("styles.json");
  const mine = fs.existsSync(o) ? JSON.parse(fs.readFileSync(o, "utf8")) : (PACKED ? [] : defaults);
  if (PACKED) return defaults.map((d) => ({ ...d, builtin: true })).concat(mine.filter((m) => !defaults.some((d) => d.id === m.id)));
  return mine.concat(defaults.filter((d) => !mine.some((m) => m.id === d.id)));
};
// what the browser gets: built-in briefs stay inside the installed app
const publicStyles = () => getStyles().map((st) => (PACKED && st.builtin ? { id: st.id, name: st.name, emoji: st.emoji, length: st.length, engine: st.engine, canvasStyle: st.canvasStyle, builtin: true } : st));
const getLanguages = () => JSON.parse(readPromptFile("languages.json"));
const getVoices = () => JSON.parse(readPromptFile("voices.json"));
function saveStyles(styles) {
  if (!Array.isArray(styles)) throw new Error("styles must be a list");
  if (PACKED) styles = styles.filter((x) => !x.builtin);
  fs.mkdirSync(path.join(DATA, "prompts"), { recursive: true });
  fs.writeFileSync(overridePath("styles.json"), JSON.stringify(styles, null, 2));
}

// {{key}} templating
const fill = (tpl, vars) => tpl.replace(/\{\{(\w+)\}\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : ""));

// ---------- projects ----------
const projectsDir = () => getSettings().projectsDir;
const projDir = (id) => path.join(projectsDir(), id);
const projFile = (id) => path.join(projDir(id), "project.json");
function slug(s) {
  return (s || "reel").toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_]+/g, "-").slice(0, 40).replace(/-+$/, "") || "reel";
}
function newId(topic) {
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  return `${stamp}-${slug(topic)}-${Math.random().toString(36).slice(2, 6)}`;
}
const getProject = (id) => {
  if (!/^[\w-]+$/.test(id)) return null;
  return readJSON(projFile(id), null);
};
function saveProject(p) { p.updatedAt = new Date().toISOString(); writeJSON(projFile(p.id), p); return p; }
function listProjects() {
  const dir = projectsDir();
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .map((id) => readJSON(path.join(dir, id, "project.json"), null))
    .filter(Boolean)
    .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
}
function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d); else fs.copyFileSync(s, d);
  }
}
function trashProject(id) {
  const src = projDir(id);
  if (!fs.existsSync(src)) return;
  const dst = path.join(DATA, "trash", id);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  try { fs.renameSync(src, dst); } catch { copyDir(src, dst); fs.rmSync(src, { recursive: true, force: true }); }
}

// ---------- shared assets copied into every project ----------
const VENDOR = path.join(DATA, "vendor");
const GSAP_VERSION = "3.14.2";
const gsapFile = () => path.join(VENDOR, `gsap-${GSAP_VERSION}.min.js`);
function addShared(dir) {
  const sfx = path.join(dir, "assets", "sfx");
  fs.mkdirSync(sfx, { recursive: true });
  for (const f of fs.readdirSync(path.join(RES_ROOT, "shared", "sfx"))) fs.copyFileSync(path.join(RES_ROOT, "shared", "sfx", f), path.join(sfx, f));
  if (!fs.existsSync(gsapFile())) throw new Error("The animation library (GSAP) isn't downloaded yet. Open Setup and click Install on \"Animation library\".");
  fs.copyFileSync(gsapFile(), path.join(dir, "assets", "gsap.min.js"));
}

module.exports = {
  VENDOR, GSAP_VERSION, gsapFile, addShared,
  APP_ROOT, RES_ROOT, PACKED, DATA, IS_WIN, readJSON, writeJSON, readDefault, readDefaultJSON, publicStyles,
  getSettings, saveSettings,
  PROMPT_NAMES, getPrompt, listPrompts, savePrompt, resetPrompt, getStyles, getLanguages, getVoices, saveStyles, fill,
  projDir, getProject, saveProject, listProjects, newId, copyDir, trashProject,
};
