// Spawning helpers: run commands with live log lines, cancel, and drive Claude Code headless.
const { spawn, spawnSync } = require("child_process");
const { IS_WIN, getSettings } = require("./store");

// On Windows, npm shims (claude, npx) are .cmd files, so we go through the shell and quote args ourselves.
const q = (a) => (IS_WIN && /[\s"&|<>^()%!]/.test(a) ? `"${String(a).replace(/"/g, '""')}"` : a);

function baseEnv(extra = {}) {
  const s = getSettings();
  const py = s.python || detectPython();
  return {
    ...process.env,
    PYTHONUTF8: "1",
    PYTHONIOENCODING: "utf-8",
    HYPERFRAMES_PYTHON: process.env.HYPERFRAMES_PYTHON || pythonExe(py),
    ...(s.browserPath ? { HYPERFRAMES_BROWSER_PATH: s.browserPath } : {}),
    FORCE_COLOR: "0",
    NO_COLOR: "1",
    ...extra,
  };
}

let _py = null;
function detectPython() {
  if (_py) return _py;
  const cands = IS_WIN ? ["python", "py", "python3"] : ["python3", "python"];
  for (const c of cands) {
    try {
      const r = spawnSync(c, ["--version"], { shell: IS_WIN, encoding: "utf8", timeout: 15000 });
      if (r.status === 0 && /Python 3/.test((r.stdout || "") + (r.stderr || ""))) { _py = c; return c; }
    } catch { /* next */ }
  }
  _py = IS_WIN ? "python" : "python3";
  return _py;
}
const python = () => getSettings().python || detectPython();

// Absolute path of the Python the app uses, so HyperFrames (Kokoro TTS) uses the same one
// instead of guessing (on Windows it can otherwise pick a different Python or the Store stub).
const _exe = {};
function pythonExe(cmd) {
  if (_exe[cmd] !== undefined) return _exe[cmd];
  try {
    const r = spawnSync(cmd, ["-c", "import sys; print(sys.executable)"], { shell: IS_WIN, encoding: "utf8", timeout: 15000 });
    const p = (r.stdout || "").trim().split(/\r?\n/).pop();
    _exe[cmd] = r.status === 0 && p ? p : cmd;
  } catch { _exe[cmd] = cmd; }
  return _exe[cmd];
}
const resetPython = () => { _py = null; for (const k of Object.keys(_exe)) delete _exe[k]; };

// A Chrome/Edge already on this computer, for when HyperFrames can't download chrome-headless-shell.
function findBrowser() {
  const fs = require("fs");
  const env = process.env;
  const c = IS_WIN
    ? [`${env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`, `${env["PROGRAMFILES(X86)"]}\\Google\\Chrome\\Application\\chrome.exe`,
       `${env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`, `${env["PROGRAMFILES(X86)"]}\\Microsoft\\Edge\\Application\\msedge.exe`,
       `${env.PROGRAMFILES}\\Microsoft\\Edge\\Application\\msedge.exe`]
    : process.platform === "darwin"
      ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"]
      : ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
  return c.find((f) => { try { return f && !f.startsWith("undefined") && fs.existsSync(f); } catch { return false; } }) || null;
}

function killTree(child) {
  if (!child || child.exitCode !== null) return;
  try {
    if (IS_WIN) spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { shell: true });
    else process.kill(-child.pid, "SIGTERM");
  } catch { try { child.kill("SIGTERM"); } catch { /* gone */ } }
}

const stripAnsi = (s) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").replace(/\r/g, "");

/**
 * run(cmd, args, opts) -> Promise<{code, out}>
 * opts: cwd, env, input (string to stdin), onLine(line), onSpawn(child), quiet (don't stream lines), timeoutMs
 */
function run(cmd, args = [], opts = {}) {
  return new Promise((resolve, reject) => {
    // Only npm shims (.cmd) need a shell on Windows; real .exe files (ffmpeg, python) are
    // spawned directly so long arguments aren't cut by cmd.exe's 8 KB line limit.
    const shell = IS_WIN && (/^(npx|npm|claude)$/i.test(cmd) || /\.(cmd|bat)$/i.test(cmd) || opts.shell === true);
    const child = spawn(shell ? q(cmd) : cmd, shell ? args.map(q) : args, {
      cwd: opts.cwd,
      env: baseEnv(opts.env),
      shell,
      detached: !IS_WIN,
      windowsHide: true,
    });
    opts.onSpawn && opts.onSpawn(child);
    let out = "", buf = "";
    const push = (d) => {
      const s = stripAnsi(d.toString("utf8"));
      out += s;
      if (out.length > 400000) out = out.slice(-300000);
      if (opts.quiet || !opts.onLine) return;
      buf += s;
      const lines = buf.split("\n");
      buf = lines.pop();
      for (const l of lines) if (l.trim()) opts.onLine(l);
    };
    child.stdout.on("data", push);
    child.stderr.on("data", push);
    let timer = null;
    if (opts.timeoutMs) timer = setTimeout(() => { killTree(child); }, opts.timeoutMs);
    child.on("error", (e) => { clearTimeout(timer); reject(new Error(`Could not start "${cmd}": ${e.message}`)); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (buf.trim() && opts.onLine && !opts.quiet) opts.onLine(buf);
      resolve({ code, out });
    });
    if (opts.input !== undefined) { child.stdin.write(opts.input); }
    child.stdin.end();
  });
}

async function runOk(cmd, args, opts = {}) {
  const r = await run(cmd, args, opts);
  if (r.code !== 0) {
    const tail = r.out.trim().split("\n").slice(-12).join("\n");
    throw new Error(`${cmd} ${args.slice(0, 3).join(" ")} failed (exit ${r.code}):\n${tail}`);
  }
  return r;
}

const npxHF = (args, opts) => {
  const s = getSettings();
  return run("npx", ["-y", `hyperframes@${s.hf}`, ...args], opts);
};

/**
 * Claude Code headless. The prompt goes in via stdin; CLAUDE.md in cwd carries the system prompt.
 * tools: list of allowed tools (empty list = no tools). resume: session id to continue.
 * Returns {text, sessionId, cost, isError}.
 */
async function claude(prompt, { cwd, tools = [], resume, onLine, onSpawn, timeoutMs } = {}) {
  const s = getSettings();
  const args = ["-p", "--output-format", "stream-json", "--verbose"];
  if (tools.length) args.push("--allowedTools", tools.join(","), "--permission-mode", "acceptEdits");
  else args.push("--allowedTools", "Read,Glob,Grep", "--disallowedTools", "Write,Edit,Bash,NotebookEdit");
  if (s.claudeModel) args.push("--model", s.claudeModel);
  if (resume) args.push("--resume", resume);

  let final = null, sessionId = resume || null, partial = "";
  const handle = (line) => {
    let ev;
    try { ev = JSON.parse(line); } catch { onLine && onLine(line); return; }
    if (ev.session_id) sessionId = ev.session_id;
    if (ev.type === "assistant" && ev.message && Array.isArray(ev.message.content)) {
      for (const c of ev.message.content) {
        if (c.type === "text" && c.text.trim()) { partial = c.text; onLine && onLine(`💬 ${c.text.trim().slice(0, 600)}`); }
        if (c.type === "tool_use") onLine && onLine(`▸ ${describeTool(c)}`);
      }
    }
    if (ev.type === "result") final = ev;
  };
  const r = await run(s.claudeCmd || "claude", args, {
    cwd, input: prompt, onSpawn, timeoutMs, onLine: handle,
  });
  if (!final) {
    const tail = r.out.trim().split("\n").filter((l) => !l.startsWith("{")).slice(-8).join("\n");
    throw new Error(`Claude Code stopped without a result (exit ${r.code}). ${tail || "Is Claude Code installed and logged in? Run \"claude\" once in a terminal."}`);
  }
  if (final.is_error) throw new Error(`Claude Code error: ${final.result || final.subtype || "unknown"}`);
  return { text: final.result || partial, sessionId, cost: final.total_cost_usd || 0, isError: false };
}

function describeTool(c) {
  const i = c.input || {};
  const short = (x) => String(x || "").replace(/\s+/g, " ").slice(0, 160);
  switch (c.name) {
    case "Bash": return `Bash: ${short(i.command)}`;
    case "Read": return `Read ${short(i.file_path)}`;
    case "Write": return `Write ${short(i.file_path)}`;
    case "Edit": case "MultiEdit": return `Edit ${short(i.file_path)}`;
    case "Glob": case "Grep": return `${c.name} ${short(i.pattern)}`;
    default: return `${c.name}`;
  }
}

module.exports = { run, runOk, npxHF, claude, killTree, python, pythonExe, resetPython, detectPython, baseEnv, findBrowser };
