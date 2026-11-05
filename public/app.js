/* Reel Studio front end: plain JS, no build step. */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const view = $("#view");

const ST = { app: null, project: null, planDraft: null, planDirty: false, route: [], projects: [] };

async function api(url, opts = {}) {
  const o = { method: opts.method || (opts.body ? "POST" : "GET"), headers: {} };
  if (opts.body instanceof FormData) o.body = opts.body;
  else if (opts.body !== undefined) { o.body = JSON.stringify(opts.body); o.headers["Content-Type"] = "application/json"; }
  const r = await fetch(url, o);
  const j = await r.json().catch(() => ({}));
  if (r.status === 402 && j.license === false) { api("/api/license").then(viewLicense).catch(() => viewLicense({})); }
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}
function toast(msg, bad) {
  const t = $("#toast"); t.textContent = msg; t.className = "show" + (bad ? " bad" : "");
  clearTimeout(t._h); t._h = setTimeout(() => (t.className = ""), bad ? 6000 : 2600);
}
const tryDo = (fn) => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message, true); } };

const STATUS = {
  draft: ["Draft", "draft"], planning: ["Planning…", "running"], planned: ["Plan ready: review it", "planned"],
  approved: ["Approved", "approved"], voicing: ["Making the voice…", "running"], needs_voice: ["Waiting for your voice", "needs_voice"],
  transcribing: ["Timing the words…", "running"], building: ["Claude is building…", "running"], rendering: ["Rendering…", "running"],
  checking: ["Checking frames…", "running"], rendered: ["Done", "rendered"],
  cutting: ["Cutting fillers & pauses…", "running"], assets: ["Getting B-roll & music…", "running"], matting: ["Cutting you out (text behind you)…", "running"], error: ["Needs attention", "error"], stopped: ["Stopped", "stopped"],
};
const stBadge = (p) => { const [l, c] = STATUS[p.status] || [p.status, "draft"]; return `<span class="st ${c}"><span class="dot"></span>${esc(l)}</span>`; };
const styleOf = (id) => (ST.app.styles.find((s) => s.id === id) || { name: id, emoji: "🎞" });
const langOf = (id) => (ST.app.languages.find((l) => l.id === id) || ST.app.languages[0]);
const ago = (iso) => { if (!iso) return ""; const s = (Date.now() - new Date(iso)) / 1000; if (s < 60) return "just now"; if (s < 3600) return `${Math.round(s / 60)} min ago`; if (s < 86400) return `${Math.round(s / 3600)} h ago`; return new Date(iso).toLocaleDateString(); };

// ---------------- router ----------------
async function route() {
  const h = location.hash.replace(/^#\/?/, "");
  const [pathPart, query] = h.split("?");
  ST.route = pathPart.split("/").filter(Boolean);
  ST.query = new URLSearchParams(query || "");
  const r = ST.route[0] || "";
  $$("nav a").forEach((a) => a.classList.toggle("on", (a.dataset.nav === "projects" && r === "") || a.dataset.nav === r));
  if (r !== "p") { ST.project = null; ST.planDirty = false; }
  try {
    if (r === "") await viewProjects();
    else if (r === "new") await viewNew();
    else if (r === "talk") await viewNewTalking();
    else if (r === "p") await viewProject(ST.route[1]);
    else if (r === "prompts") await viewPrompts();
    else if (r === "setup") await viewSetup();
    else await viewProjects();
  } catch (e) { view.innerHTML = `<div class="banner err">${esc(e.message)}</div>`; }
  window.scrollTo(0, 0);
}
window.addEventListener("hashchange", route);

// ---------------- live events ----------------
function connectEvents() {
  const es = new EventSource("/api/events");
  es.onmessage = (m) => {
    const ev = JSON.parse(m.data);
    if (ev.type === "project") {
      if (ST.project && ev.id === ST.project.id) { ST.project = ev.project; renderProjectSections(); }
      refreshSide();
      if (ST.route[0] === undefined) debounce("plist", viewProjectsSoft, 400);
    } else if (ev.type === "log") {
      if ((ST.project && ev.id === ST.project.id) || (ST.route[0] === "setup" && ev.id === "setup")) appendLog(ev.line, ev.t);
    } else if (ev.type === "job-done") {
      refreshSide();
      if (ST.route[0] === "setup" && ev.id === "setup") debounce("chk", loadChecks, 300);
    }
  };
  es.onerror = () => { $("#sideFoot").innerHTML = `<span class="muted">Reconnecting to Reel Studio…</span>`; };
  es.onopen = () => refreshSide();
}
const _deb = {};
const debounce = (k, fn, ms) => { clearTimeout(_deb[k]); _deb[k] = setTimeout(fn, ms); };
async function refreshSide() {
  try {
    ST.projects = await api("/api/projects");
    const busy = ST.projects.filter((p) => p.busy);
    $("#sideFoot").innerHTML = (busy.length ? busy.map((p) => `<a class="run" href="#/p/${p.id}"><span class="dot" style="width:8px;height:8px;border-radius:50%;background:currentColor"></span>${esc(p.busy)}: ${esc(p.title.slice(0, 22))}</a>`).join("") : "") +
      `<div>${ST.projects.length} reel${ST.projects.length === 1 ? "" : "s"} · engine: Claude Code</div>`;
  } catch { /* offline */ }
}

// ---------------- log panel ----------------
function logLineHtml(line, t) {
  const time = t ? `<span class="t">${new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span> ` : "";
  let cls = "";
  if (/^✔/.test(line)) cls = "ok"; else if (/^✖|error|failed/i.test(line)) cls = "bad"; else if (/^▸/.test(line)) cls = "tool"; else if (/^💬/.test(line)) cls = "say";
  return `<div class="${cls}">${time}${esc(line)}</div>`;
}
function appendLog(line, t) {
  const el = $("#log"); if (!el) return;
  const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  el.insertAdjacentHTML("beforeend", logLineHtml(line, t));
  while (el.childElementCount > 1500) el.firstElementChild.remove();
  if (atBottom) el.scrollTop = el.scrollHeight;
}

// ---------------- voice picker ----------------
function voicePicker(id, langId, v) {
  const voices = ST.app.voices;
  const isEn = langId === "en";
  const engines = Object.entries(voices).filter(([, e]) => e.languages.includes(langId));
  const engine = v && engines.some(([k]) => k === v.engine) ? v.engine : (isEn ? "kokoro" : "edge");
  const list = voices[engine].voices.filter((x) => engine !== "edge" || !x.lang || (isEn ? x.lang === "en" : x.lang === "ms"));
  const voice = v && list.some((x) => x.id === v.voice) ? v.voice : list[0].id;
  return `<div data-vp="${id}" data-lang="${esc(langId)}"><div class="grid3">
    <div><label class="f">Engine</label><select class="input" data-vpk="engine">${engines.map(([k, e]) => `<option value="${k}" ${k === engine ? "selected" : ""}>${esc(e.label)}</option>`).join("")}</select></div>
    <div><label class="f">Voice</label><select class="input" data-vpk="voice">${list.map((x) => `<option value="${x.id}" ${x.id === voice ? "selected" : ""}>${esc(x.label)}</option>`).join("")}</select></div>
    <div>${engine === "kokoro"
      ? `<label class="f">Speed <span class="muted" data-vpo>${(v && v.speed) || 1}×</span></label><input type="range" min="0.8" max="1.25" step="0.05" value="${(v && v.speed) || 1}" data-vpk="speed">`
      : `<label class="f">Pace</label><select class="input" data-vpk="rate">${["-15%", "-10%", "-5%", "+0%", "+5%", "+10%", "+15%"].map((r) => `<option ${r === ((v && v.rate) || "+0%") ? "selected" : ""}>${r}</option>`).join("")}</select>`}</div>
  </div>
  <div class="row" style="margin-top:10px"><button class="btn" type="button" data-vptest>▶ Test this voice</button><span data-vpaudio class="grow"></span></div></div>`;
}
function readVoice(id) {
  const box = $(`[data-vp="${id}"]`); if (!box) return null;
  const g = (k) => { const el = $(`[data-vpk="${k}"]`, box); return el ? el.value : undefined; };
  const v = { engine: g("engine"), voice: g("voice") };
  if (v.engine === "kokoro") v.speed = parseFloat(g("speed") || "1"); else v.rate = g("rate") || "+0%";
  return v;
}
function bindVoicePicker(id, onChange) {
  const box = $(`[data-vp="${id}"]`); if (!box) return;
  box.addEventListener("change", (e) => {
    if (e.target.dataset.vpk === "engine") {
      const v = { engine: e.target.value };
      box.outerHTML = voicePicker(id, box.dataset.lang, v);
      bindVoicePicker(id, onChange);
    }
    onChange && onChange(readVoice(id));
  });
  box.addEventListener("input", (e) => { if (e.target.dataset.vpk === "speed") $("[data-vpo]", box).textContent = `${e.target.value}×`; });
  const tb = $("[data-vptest]", box);
  tb.addEventListener("click", tryDo(async () => {
    const v = readVoice(id);
    const text = box.dataset.lang === "en" ? "Did you know you can turn one idea into a finished animated reel? Let me show you how it works." : "Tahukah korang, satu idea boleh jadi reel animasi siap? Jom saya tunjuk macam mana.";
    tb.disabled = true; tb.innerHTML = `<span class="spin"></span> Making a sample…`;
    try {
      const r = await api("/api/tts/test", { body: { ...v, text } });
      $("[data-vpaudio]", box).innerHTML = `<audio controls autoplay src="${r.url}"></audio>`;
    } finally { tb.disabled = false; tb.innerHTML = "▶ Test this voice"; }
  }));
}

// ---------------- Projects ----------------
async function viewProjects() {
  ST.projects = await api("/api/projects");
  view.innerHTML = `<div class="head"><div class="grow"><h1>Your reels</h1><p class="sub">Every reel is a folder of code that Claude writes and HyperFrames renders on your computer.</p></div>
    <a class="btn primary big" href="#/new">＋ New reel</a></div><div id="plist"></div>`;
  renderProjectList();
}
async function viewProjectsSoft() { if (ST.route[0] !== undefined) return; ST.projects = await api("/api/projects"); renderProjectList(); }
function renderProjectList() {
  const el = $("#plist"); if (!el) return;
  if (!ST.projects.length) {
    el.innerHTML = `<div class="card empty"><div class="big">🎬</div><h2>No reels yet</h2><p class="muted">Pick a topic and a style, approve the plan, and Reel Studio does the rest.</p><a class="btn primary big" href="#/new">Make your first reel</a></div>`;
    return;
  }
  el.innerHTML = `<div class="pgrid">${ST.projects.map((p) => {
    const st = p.kind === "talking" ? { name: "Talking video", emoji: "🎙" } : styleOf(p.form.styleId);
    const thumb = p.files.tiles ? `<img src="/files/${p.id}/renders/tiles.jpg?t=${encodeURIComponent(p.updatedAt)}">` : p.files.snapshots.length ? `<img src="/files/${p.id}/snapshots/${p.files.snapshots[0]}">` : st.emoji || "🎞";
    return `<a class="pcard" href="#/p/${p.id}"><div class="pthumb">${thumb}</div><div class="pbody"><b>${esc(p.title)}</b>
      <div class="row" style="gap:6px">${stBadge(p)}<span class="chip">${esc(st.name)}</span></div>
      <span class="muted small">${esc(langOf(p.form.language).label)} · ${p.kind === "talking" ? (p.edit ? p.edit.total.toFixed(0) : (p.sourceSeconds || 0).toFixed(0)) : p.form.length}s · ${ago(p.updatedAt)}</span></div></a>`;
  }).join("")}</div>`;
}

// ---------------- New reel ----------------
async function viewNew() {
  let base = { topic: "", styleId: "ivory", length: 40, cta: "", language: "en", voiceMode: "ai", voice: null, notes: "", productUrl: "", captionStyle: "box", music: { mode: "none", query: "" } };
  const from = ST.query.get("from");
  if (from) { try { const p = await api(`/api/projects/${from}`); base = { ...p.form, topic: "", notes: "" }; } catch { /* fresh */ } }
  const F = { ...base };
  view.innerHTML = `<div class="head"><div class="grow"><h1>New reel</h1><p class="sub">${from ? "Same setup as your last reel. Give it a new topic (and a new style if you like)." : "Tell Claude what the reel is about. It writes the hook and a scene-by-scene plan for you to approve; nothing gets built before you approve."}</p></div></div>
  <form id="nf">
    <div class="card"><div class="field"><label class="f">Topic <span class="muted">· what's the reel about?</span></label>
      <textarea class="input" name="topic" rows="3" placeholder="e.g. 3 free AI tools every Malaysian student should know" required>${esc(F.topic)}</textarea></div>
      <div class="field"><label class="f">Style</label><div class="styles">${ST.app.styles.map((s) => `<button type="button" class="style ${s.id === F.styleId ? "on" : ""}" data-style="${s.id}"><span class="e">${s.emoji || "🎞"}</span><b>${esc(s.name)}${s.engine === "canvas" ? ` <span class="chip" style="font-size:10px;padding:1px 6px">canvas</span>` : ""}</b><span>${esc(s.brief)}</span></button>`).join("")}</div></div>
      <div class="grid3">
        <div class="field"><label class="f">Length <span class="muted" id="lenv">${F.length} s</span></label><input type="range" name="length" min="15" max="60" step="5" value="${F.length}"><div class="muted small">30–50 s is the sweet spot</div></div>
        <div class="field"><label class="f">Language</label><select class="input" name="language">${ST.app.languages.map((l) => `<option value="${l.id}" ${l.id === F.language ? "selected" : ""}>${esc(l.label)}</option>`).join("")}</select></div>
        <div class="field"><label class="f">Call to action keyword <span class="muted">· optional</span></label><input class="input" name="cta" value="${esc(F.cta)}" placeholder="e.g. REELS → “Comment REELS”"></div>
      </div>
      <div class="field"><label class="f">Notes for Claude <span class="muted">· optional: facts, numbers, things to show or avoid</span></label><textarea class="input" name="notes" rows="2">${esc(F.notes)}</textarea></div>
      <div class="grid3">
        <div class="field" style="margin:0"><label class="f">Your product's website <span class="muted">· optional: real screens get animated in</span></label><input class="input" name="productUrl" value="${esc(F.productUrl || "")}" placeholder="https://bookingconvo.my"></div>
        <div class="field" style="margin:0"><label class="f">Background music</label><div class="row" style="flex-wrap:nowrap"><select class="input" name="musicMode" style="width:auto"><option value="none" ${(F.music || {}).mode !== "search" ? "selected" : ""}>None</option><option value="search" ${(F.music || {}).mode === "search" ? "selected" : ""}>Free music</option></select><input class="input" name="musicQuery" value="${esc((F.music || {}).query || "")}" placeholder="mood, e.g. chill lofi"></div><div class="muted small">Or upload your own song on the project page.</div></div>
        <div class="field" style="margin:0"><label class="f">Captions <span class="muted">· canvas styles</span></label><select class="input" name="captionStyle"><option value="box" ${F.captionStyle !== "pop" ? "selected" : ""}>Highlight box</option><option value="pop" ${F.captionStyle === "pop" ? "selected" : ""}>Pop &amp; colour</option></select></div>
      </div>
    </div>
    <div class="card"><div class="card-h"><h2>Voice</h2><div class="spacer"></div><div class="seg" id="vmode"><button type="button" data-m="ai" class="${F.voiceMode === "ai" ? "on" : ""}">🤖 AI voice (free)</button><button type="button" data-m="upload" class="${F.voiceMode === "upload" ? "on" : ""}">🎙 My recording</button></div></div>
      <div id="vbox"></div></div>
    <div class="row"><button class="btn primary big" type="submit" id="go">✨ Write the plan</button><span class="muted small">Claude writes the plan in about a minute. You review and approve it, then the reel builds and renders by itself.</span></div>
  </form>`;
  const form = $("#nf");
  const renderVBox = () => {
    $("#vbox").innerHTML = F.voiceMode === "ai"
      ? `<p class="muted small" style="margin-top:0">After you approve the plan, the AI voice reads it and everything else happens automatically. Kokoro runs offline (English); Edge TTS needs internet and also speaks Malay.</p>${voicePicker("new", F.language, F.voice)}`
      : `<p class="muted small" style="margin:0">After you approve the plan you'll get the script to read. Record it on your phone in one natural take (quiet room, ~20 cm away) and upload the MP3/M4A on the project page. The reel builds as soon as it's uploaded.</p>`;
    bindVoicePicker("new", (v) => (F.voice = v));
    if (F.voiceMode === "ai") F.voice = readVoice("new");
  };
  renderVBox();
  $$("[data-style]").forEach((b) => b.addEventListener("click", () => {
    $$("[data-style]").forEach((x) => x.classList.remove("on")); b.classList.add("on"); F.styleId = b.dataset.style;
    const s = styleOf(F.styleId); if (s.length) { form.length.value = s.length; $("#lenv").textContent = `${s.length} s`; }
  }));
  form.length.addEventListener("input", () => ($("#lenv").textContent = `${form.length.value} s`));
  form.language.addEventListener("change", () => { F.language = form.language.value; F.voice = null; renderVBox(); });
  $$("#vmode button").forEach((b) => b.addEventListener("click", () => { $$("#vmode button").forEach((x) => x.classList.remove("on")); b.classList.add("on"); F.voiceMode = b.dataset.m; renderVBox(); }));
  form.addEventListener("submit", tryDo(async (e) => {
    e.preventDefault();
    const body = { topic: form.topic.value, styleId: F.styleId, length: +form.length.value, language: form.language.value, cta: form.cta.value, notes: form.notes.value, productUrl: form.productUrl.value, captionStyle: form.captionStyle.value, music: { mode: form.musicMode.value, query: form.musicQuery.value }, voiceMode: F.voiceMode, voice: F.voiceMode === "ai" ? readVoice("new") : null };
    $("#go").disabled = true; $("#go").innerHTML = `<span class="spin"></span> Creating…`;
    try { const p = await api("/api/projects", { body }); location.hash = `#/p/${p.id}`; }
    finally { const g = $("#go"); if (g) { g.disabled = false; g.innerHTML = "✨ Write the plan"; } }
  }));
}

// ---------------- Project ----------------
async function viewProject(id) {
  const p = await api(`/api/projects/${id}`);
  if (p.kind === "talking") return viewTalking(p);
  ST.project = p; ST.planDraft = p.plan ? JSON.parse(JSON.stringify(p.plan)) : null; ST.planDirty = false; ST.planKey = JSON.stringify(p.plan);
  view.innerHTML = `<div id="phead"></div><div id="pbanner"></div><div id="pstepper"></div>
    <div class="card" id="cplan"><div class="card-h"><span class="num" id="n1">1</span><h2>Plan</h2><div class="spacer"></div><div id="planActions" class="row"></div></div><div id="planBody"></div><div id="planFoot"></div></div>
    <div class="card" id="cvoice"></div>
    <div class="card" id="cbuild"></div>
    <div class="card" id="crender"></div>
    <div class="card"><details class="logbox" id="logbox" open><summary>Live log <span class="muted small">· what Claude and the tools are doing</span></summary><div class="log" id="log"></div></details></div>`;
  renderProjectSections(true);
  const lg = await api(`/api/projects/${id}/log`);
  const el = $("#log");
  el.innerHTML = lg.lines.map((l) => { const m = l.match(/^\[(\d\d:\d\d:\d\d)\] (.*)$/); return m ? `<div class="${/^✔/.test(m[2]) ? "ok" : /^✖/.test(m[2]) ? "bad" : /^▸/.test(m[2]) ? "tool" : /^💬/.test(m[2]) ? "say" : ""}"><span class="t">${m[1]}</span> ${esc(m[2])}</div>` : `<div>${esc(l)}</div>`; }).join("") || `<div class="t">Nothing yet.</div>`;
  el.scrollTop = el.scrollHeight;
}

function stepState(p) {
  const done = [!!p.planApproved, !!(p.steps && p.steps.voice), !!(p.steps && p.steps.build), !!(p.steps && p.steps.render)];
  const now = done.indexOf(false);
  return { done, now: now === -1 ? 4 : now };
}

function renderProjectSections(first) {
  const p = ST.project; if (!p) return;
  if (p.kind === "talking") return renderTalkingSections(first);
  const st = styleOf(p.form.styleId), lang = langOf(p.form.language);
  const busy = !!p.busy;
  $("#phead").innerHTML = `<div class="head"><div class="grow"><div class="row" style="gap:8px;margin-bottom:6px">${stBadge(p)}<span class="chip">${st.emoji || ""} ${esc(st.name)}</span><span class="chip">${esc(lang.label)}</span><span class="chip">${p.form.length}s</span>${p.cost ? `<span class="chip" title="Equivalent API cost reported by Claude Code. On a Pro/Max plan this comes out of your subscription usage.">≈ $${p.cost.toFixed(2)} usage</span>` : ""}</div>
    <h1>${esc(p.title)}</h1><p class="sub" style="margin:0">${esc(p.form.topic)}</p></div>
    <div class="row"><button class="btn" data-a="open">📂 Open folder</button><button class="btn" data-a="claude" title="Open Claude Code in this project's folder, continuing the same session">⌨ Open in Claude Code</button><a class="btn" href="#/new?from=${p.id}">↻ Next reel, same setup</a><button class="btn ghost danger" data-a="delete">Delete</button></div></div>`;

  let banner = "";
  if (busy) banner = `<div class="banner run"><span class="spin"></span><div class="grow"><b>${esc(p.busy)}</b> · ${esc((STATUS[p.status] || [""])[0])} <span class="small">Leave this page open or come back later, it keeps going.</span></div><button class="btn" data-a="cancel">■ Stop</button></div>`;
  else if (p.status === "error" || p.status === "stopped") banner = `<div class="banner err"><div class="grow"><b>${p.status === "stopped" ? "Stopped." : "Something went wrong."}</b><pre>${esc(p.error || "")}</pre></div><button class="btn primary" data-a="continue">↻ Continue</button></div>`;
  else if (p.status === "needs_voice") banner = `<div class="banner warn"><div class="grow"><b>Your turn: upload the voice.</b> Read the script below in one natural take and upload it in step 2. The reel builds and renders by itself after that.</div></div>`;
  $("#pbanner").innerHTML = banner;

  const ss = stepState(p);
  const names = ["Plan", "Voice", "Build scenes", "Render"];
  $("#pstepper").innerHTML = `<div class="stepper">${names.map((n, i) => `<div class="${ss.done[i] ? "done" : i === ss.now ? "now" : ""}"><i>${ss.done[i] ? "✓" : i + 1}</i>${n}</div>`).join("")}</div>`;
  ["n1"].forEach(() => { const n = $("#n1"); n.className = "num " + (ss.done[0] ? "done" : ss.now === 0 ? "now" : ""); n.textContent = ss.done[0] ? "✓" : "1"; });

  // ---- plan ----
  $("#planActions").innerHTML = !p.plan ? "" : `
    <span class="muted small" id="planCount"></span>
    ${ST.planDirty ? `<button class="btn" data-a="saveplan">💾 Save edits</button>` : ""}
    <button class="btn" data-a="regen" ${busy ? "disabled" : ""}>↻ Regenerate</button>
    ${p.planApproved ? "" : `<button class="btn primary" data-a="approve" ${busy ? "disabled" : ""}>✓ Approve &amp; make the reel</button>`}`;
  const key = JSON.stringify(p.plan);
  if (first || (!ST.planDirty && key !== ST.planKey)) {
    ST.planKey = key; ST.planDraft = p.plan ? JSON.parse(JSON.stringify(p.plan)) : null;
    renderPlanBody();
  }
  updatePlanCount();
  $("#planFoot").innerHTML = !p.plan ? "" : p.planApproved
    ? `<div class="approved-bar" style="margin-top:12px">✓ Approved. Editing the plan un-approves it; approve again to rebuild.</div>`
    : `<div class="note-row"><input class="input" id="reviseNote" placeholder="Ask for changes, e.g. “make the hook punchier” or “add a scene about pricing”"><button class="btn" data-a="revise" ${busy ? "disabled" : ""}>✎ Revise with this note</button></div>`;

  // ---- voice ----
  const v = p.form.voice || {};
  const voiceDone = p.steps && p.steps.voice;
  const vt = Date.parse(p.updatedAt) || 0;
  $("#cvoice").innerHTML = `<div class="card-h"><span class="num ${voiceDone ? "done" : ss.now === 1 ? "now" : ""}">${voiceDone ? "✓" : 2}</span><h2>Voice</h2><div class="spacer"></div>
      <div class="seg" id="pvmode"><button data-m="ai" class="${p.form.voiceMode !== "upload" ? "on" : ""}">🤖 AI voice</button><button data-m="upload" class="${p.form.voiceMode === "upload" ? "on" : ""}">🎙 My recording</button></div></div>
    ${p.files.voice ? `<div class="row" style="margin-bottom:12px"><audio controls src="/files/${p.id}/assets/vo/voice.mp3?t=${vt}"></audio><span class="muted small">${p.voiceSource === "upload" ? "Your recording" : `AI voice${p.voiceInfo ? ` · ${esc(p.voiceInfo.voice || "")}` : ""}`}${p.voiceSeconds ? ` · ${p.voiceSeconds}s · ${p.wordCount} words timed` : ""}</span></div>` : ""}
    <div id="pvbox"></div>
    <p class="muted small" style="margin:10px 0 0">Changing the voice re-times the words and rebuilds the scenes automatically.</p>
    <div style="border-top:1px solid var(--line);margin-top:14px;padding-top:12px"><div class="row"><b>🎵 Music</b><span class="muted small">${(() => { const m = p.form.music || {}; return m.mode === "upload" ? `your song: ${esc(m.name || m.file || "")}` : m.mode === "search" ? `free music: “${esc(m.query || "")}”` : "none"; })()}${p.musicCredit ? ` · ${esc(p.musicCredit)}` : ""}</span></div>
      <div class="row" style="margin-top:8px"><select class="input" id="mmode" style="width:auto"><option value="none">None</option><option value="search">Free music (search)</option><option value="upload">My own song</option></select>
        <input class="input" id="mq" style="width:220px" placeholder="mood, e.g. upbeat corporate" value="${esc((p.form.music || {}).query || "")}"><input type="file" id="mfile" accept="audio/*,.mp3,.wav,.m4a"><button class="btn" data-a="music" ${busy ? "disabled" : ""}>Apply music</button></div>
      <p class="muted small" style="margin:6px 0 0">Music is ducked under the voice; Claude gets its beat map and lands cuts on the beats. Changing it after the build only re-mixes and re-renders.</p></div>`;
  const renderPV = (mode) => {
    if (mode === "upload") {
      $("#pvbox").innerHTML = `<div class="row"><input type="file" id="vfile" accept="audio/*,.m4a,.mp3,.wav,.aac,.ogg"><button class="btn primary" data-a="upload" ${busy ? "disabled" : ""}>⬆ Upload voice</button></div>`;
    } else {
      $("#pvbox").innerHTML = `${voicePicker("proj", p.form.language, v)}<div class="row" style="margin-top:10px"><button class="btn ${p.files.voice ? "" : "primary"}" data-a="genvoice" ${busy || !p.plan ? "disabled" : ""}>🤖 ${p.files.voice ? "Regenerate the voice" : "Generate the voice now"}</button>${p.plan ? "" : `<span class="muted small">Available once there's a plan.</span>`}</div>`;
      bindVoicePicker("proj");
    }
  };
  renderPV(p.form.voiceMode === "upload" ? "upload" : "ai");
  { const mm = $("#mmode"); if (mm) mm.value = (p.form.music || {}).mode || "none"; }
  $$("#pvmode button").forEach((b) => b.addEventListener("click", () => { $$("#pvmode button").forEach((x) => x.classList.remove("on")); b.classList.add("on"); renderPV(b.dataset.m); }));

  // ---- build ----
  const bDone = p.steps && p.steps.build;
  $("#cbuild").innerHTML = `<div class="card-h"><span class="num ${bDone ? "done" : ss.now === 2 ? "now" : ""}">${bDone ? "✓" : 3}</span><h2>Build scenes</h2><span class="muted small">Claude writes every scene in code, timed to your words, then lints and looks at snapshots.</span></div>
    ${p.buildSummary ? `<h3>Claude's summary</h3><div class="summary">${esc(p.buildSummary)}</div>` : `<p class="muted" style="margin:0">${p.status === "building" ? "Building now… watch the live log below." : "Starts automatically once the plan is approved and the voice is ready."}</p>`}
    ${p.lastFix ? `<h3 style="margin-top:14px">Last fix: ${esc(p.lastFix.note)}</h3><div class="summary">${esc(p.lastFix.text || "")}</div>` : ""}
    ${p.files.snapshots.length ? `<h3 style="margin-top:14px">Snapshots</h3><div class="snaps">${p.files.snapshots.map((f) => `<figure><img loading="lazy" src="/files/${p.id}/snapshots/${encodeURIComponent(f)}?t=${vt}" data-zoom><figcaption>${esc(f.replace(/\.png$/i, ""))}</figcaption></figure>`).join("")}</div>` : ""}`;

  // ---- render ----
  const r = p.render;
  const rDone = p.steps && p.steps.render;
  $("#crender").innerHTML = `<div class="card-h"><span class="num ${rDone ? "done" : ss.now === 3 ? "now" : ""}">${rDone ? "✓" : 4}</span><h2>Render</h2><div class="spacer"></div>
      ${p.files.reel ? `<a class="btn" href="/files/${p.id}/renders/reel.mp4" download="${esc((p.title || "reel").replace(/[^\w\- ]+/g, "").trim() || "reel")}.mp4">⬇ Download MP4</a>` : ""}
      ${bDone ? `<button class="btn" data-a="rerender" ${busy ? "disabled" : ""}>↻ Re-render</button>` : ""}</div>
    ${p.files.reel && r ? `<div class="media"><video class="reel" controls playsinline preload="metadata" src="/files/${p.id}/renders/reel.mp4?t=${encodeURIComponent(r.at)}#t=0.5"></video>
      <div><div class="stats"><div class="stat"><b>${r.duration.toFixed(1)} s</b><span>length</span></div><div class="stat"><b>${r.lufs === null ? "?" : r.lufs}</b><span>LUFS (aim ≈ -16)</span></div><div class="stat"><b>${r.sizeMB} MB</b><span>file size</span></div><div class="stat"><b>1080×1920</b><span>vertical</span></div></div>
        ${p.files.tiles ? `<h3>Frames from the MP4</h3><img class="tiles" data-zoom src="/files/${p.id}/renders/tiles.jpg?t=${encodeURIComponent(r.at)}">` : ""}
        ${p.qa ? `<h3 style="margin-top:12px">Claude's frame check</h3><div class="summary">${esc(p.qa.text)}</div>` : ""}
        <h3 style="margin-top:14px">Fix what you see</h3>
        <textarea class="input" id="fixNote" rows="2" placeholder="e.g. “the cards zoom too much, make them flat and just play” or “the title covers the footage at 0:12”"></textarea>
        <div class="row" style="margin-top:8px"><button class="btn primary" data-a="fix" ${busy ? "disabled" : ""}>🛠 Fix &amp; re-render</button><span class="muted small">Claude fixes it in the same session, then the app renders again.</span></div>
      </div></div>`
    : `<p class="muted" style="margin:0">${p.status === "rendering" ? "Rendering now…" : "The MP4 appears here when it's ready. Frames from the MP4 and the audio level are checked automatically."}</p>`}`;
}

function renderPlanBody() {
  const p = ST.project, d = ST.planDraft, el = $("#planBody");
  if (!d) {
    el.innerHTML = p.status === "planning" || p.busy ? `<p class="muted"><span class="spin"></span> Claude is writing the hook and the scene-by-scene plan…</p>`
      : `<p class="muted">No plan yet.</p><button class="btn primary" data-a="regen">✨ Write the plan</button>`;
    return;
  }
  const ta = (k, val, rows = 2) => `<textarea class="cell" rows="${rows}" data-k="${k}">${esc(val)}</textarea>`;
  el.innerHTML = `<div class="hook"><div><label>Hook · TEXT on screen</label>${ta("hook.text", d.hook.text)}</div><div><label>Hook · SPOKEN</label>${ta("hook.spoken", d.hook.spoken)}</div><div><label>Hook · VISUAL on frame 1</label>${ta("hook.visual", d.hook.visual)}</div></div>
    <table class="ptable"><thead><tr><th></th><th>Spoken</th><th>Text on screen</th><th>Visual</th><th></th></tr></thead><tbody>
    ${d.rows.map((r, i) => `<tr><td class="n">${i + 1}</td><td>${ta(`rows.${i}.spoken`, r.spoken, 3)}</td><td>${ta(`rows.${i}.text`, r.text, 3)}</td><td>${ta(`rows.${i}.visual`, r.visual, 3)}</td>
      <td class="x"><button class="btn ghost" title="Remove line" data-del="${i}">✕</button></td></tr>`).join("")}
    </tbody></table>
    <div class="row" style="margin:6px 0 14px"><button class="btn ghost" data-add>＋ Add a line</button></div>
    <details><summary class="small" style="cursor:pointer;font-weight:600">🎙 Voice script (with ElevenLabs v4 tags) · ${esc(d.title)}</summary>
      <div class="grid2" style="margin-top:10px"><div><label class="f">Title</label><input class="input" data-k="title" value="${esc(d.title)}"></div><div><label class="f">Notes</label><input class="input" data-k="notes" value="${esc(d.notes || "")}"></div></div>
      <textarea class="input" rows="4" data-k="voice_script" style="margin-top:10px">${esc(d.voice_script)}</textarea>
      <div class="row" style="margin-top:8px"><button class="btn" data-copy>📋 Copy script</button><span class="muted small">Recording yourself? Read the spoken lines without the [tags]. For ElevenLabs, paste this as is.</span></div></details>`;
}
function updatePlanCount() {
  const d = ST.planDraft, el = $("#planCount"); if (!d || !el) return;
  const words = d.rows.map((r) => r.spoken).join(" ").split(/\s+/).filter(Boolean).length;
  const wps = langOf(ST.project.form.language).wps || 2.5;
  el.textContent = `${d.rows.length} lines · ${words} words · ~${Math.round(words / wps)} s`;
}
function setDraft(k, val) {
  const parts = k.split(".");
  let o = ST.planDraft;
  for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]];
  o[parts[parts.length - 1]] = val;
  if (!ST.planDirty) { ST.planDirty = true; renderProjectSections(); }
  updatePlanCount();
}

// delegated actions on the project page
view.addEventListener("input", (e) => { if (e.target.dataset.k && ST.planDraft) setDraft(e.target.dataset.k, e.target.value); });
view.addEventListener("click", tryDo(async (e) => {
  const z = e.target.closest("[data-zoom]");
  if (z) { const lb = document.createElement("div"); lb.className = "lightbox"; lb.innerHTML = `<img src="${z.src}">`; lb.onclick = () => lb.remove(); document.body.append(lb); return; }
  if (!ST.project) return;
  const p = ST.project, id = p.id;
  if (e.target.closest("[data-add]")) { ST.planDraft.rows.push({ spoken: "", text: "", visual: "" }); ST.planDirty = true; renderPlanBody(); renderProjectSections(); return; }
  const del = e.target.closest("[data-del]");
  if (del) { ST.planDraft.rows.splice(+del.dataset.del, 1); ST.planDirty = true; renderPlanBody(); renderProjectSections(); return; }
  if (e.target.closest("[data-copy]")) { await navigator.clipboard.writeText(ST.planDraft.voice_script); toast("Script copied"); return; }
  const a = e.target.closest("[data-a]"); if (!a) return;
  const act = a.dataset.a;
  const savePlan = async () => { if (!ST.planDirty) return; const r = await api(`/api/projects/${id}/plan`, { method: "PUT", body: { plan: ST.planDraft } }); ST.planDirty = false; ST.planKey = JSON.stringify(r.plan); ST.project = r; };
  if (act === "saveplan") { await savePlan(); renderProjectSections(); toast("Plan saved"); }
  else if (act === "approve") { await savePlan(); await api(`/api/projects/${id}/approve`, { body: {} }); toast("Approved, making the reel"); }
  else if (act === "regen") { if (ST.planDirty && !confirm("Throw away your edits and write a new plan?")) return; ST.planDirty = false; await api(`/api/projects/${id}/plan/generate`, { body: {} }); }
  else if (act === "revise") { await savePlan(); await api(`/api/projects/${id}/plan/revise`, { body: { note: $("#reviseNote").value } }); }
  else if (act === "continue") await api(`/api/projects/${id}/continue`, { body: {} });
  else if (act === "cancel") await api(`/api/projects/${id}/cancel`, { body: {} });
  else if (act === "rerender") await api(`/api/projects/${id}/rerender`, { body: {} });
  else if (act === "fix") await api(`/api/projects/${id}/fix`, { body: { note: $("#fixNote").value } });
  else if (act === "open") await api(`/api/projects/${id}/open`, { body: {} });
  else if (act === "claude") await api(`/api/projects/${id}/claude`, { body: {} });
  else if (act === "music") {
    const fd = new FormData(); fd.append("mode", $("#mmode").value); fd.append("query", $("#mq").value);
    if ($("#mfile").files[0]) fd.append("song", $("#mfile").files[0]);
    ST.project = await api(`/api/projects/${id}/music`, { body: fd }); renderProjectSections(); toast("Music updated");
  }
  else if (act === "genvoice") { await savePlan(); await api(`/api/projects/${id}/voice/generate`, { body: { voice: readVoice("proj") } }); }
  else if (act === "upload") {
    const f = $("#vfile").files[0]; if (!f) throw new Error("Choose an audio file first");
    const fd = new FormData(); fd.append("voice", f);
    a.disabled = true; a.innerHTML = `<span class="spin"></span> Uploading…`;
    try { ST.project = await api(`/api/projects/${id}/voice/upload`, { body: fd }); renderProjectSections(); toast("Voice uploaded"); }
    finally { a.disabled = false; }
  } else if (act === "delete") {
    if (!confirm(`Delete “${p.title}”? It moves to the ReelStudio trash folder.`)) return;
    await api(`/api/projects/${id}`, { method: "DELETE" }); location.hash = "#/";
  }
}));

// ---------------- Prompts ----------------
async function viewPrompts() {
  const data = await api("/api/prompts");
  let tab = ST.query.get("t") || "system";
  view.innerHTML = `<div class="head"><div class="grow"><h1>Prompts &amp; styles</h1><p class="sub">These are the instructions Reel Studio sends to Claude Code at each step. Edit them to change how every new reel is made.</p></div></div>
    <div class="ptabs" id="ptabs">${data.prompts.map((x) => `<button data-t="${x.name}">${esc(x.label)}${x.custom ? " •" : ""}</button>`).join("")}<button data-t="styles">🎨 Styles</button></div><div id="pedit"></div>`;
  const show = () => {
    $$("#ptabs button").forEach((b) => b.classList.toggle("on", b.dataset.t === tab));
    if (tab === "styles") return showStyles(data.styles);
    const x = data.prompts.find((y) => y.name === tab);
    if (data.packed) {
      $("#pedit").innerHTML = `<div class="card"><div class="card-h"><h2>${esc(x.label)}</h2>${x.custom ? `<span class="chip">your instructions</span>` : ""}<div class="spacer"></div><button class="btn" id="preset">Clear</button><button class="btn primary" id="psave">Save</button></div>
        <p class="muted small" style="margin-top:0">Reel Studio's built-in instructions for this step are included automatically. Anything you write here is added after them, e.g. "Always use my brand colour #0E7C66" or "Keep sentences under 12 words".</p>
        <textarea class="input code" id="ptext" placeholder="Your extra instructions for this step (optional)">${esc(x.text)}</textarea></div>`;
      $("#psave").onclick = tryDo(async () => { await api(`/api/prompts/${tab}`, { method: "PUT", body: { text: $("#ptext").value } }); x.text = $("#ptext").value; x.custom = !!x.text.trim(); toast("Saved"); show(); });
      $("#preset").onclick = tryDo(async () => { await api(`/api/prompts/${tab}`, { method: "DELETE" }); x.text = ""; x.custom = false; toast("Cleared"); show(); });
      return;
    }
    $("#pedit").innerHTML = `<div class="card"><div class="card-h"><h2>${esc(x.label)}</h2>${x.custom ? `<span class="chip">customised</span>` : `<span class="chip">default</span>`}<div class="spacer"></div><button class="btn" id="preset">Reset to default</button><button class="btn primary" id="psave">Save</button></div>
      <textarea class="input code" id="ptext">${esc(x.text)}</textarea>
      <p class="muted small">Variables filled in by the app: <code>{{topic}}</code> <code>{{length}}</code> <code>{{words_target}}</code> <code>{{style_name}}</code> <code>{{style_brief}}</code> <code>{{style_prompt}}</code> <code>{{language_label}}</code> <code>{{language_rules}}</code> <code>{{cta_line}}</code> <code>{{notes}}</code> <code>{{python}}</code> <code>{{hf}}</code> <code>{{title}}</code>, plus per step: <code>{{plan_md}}</code> <code>{{plan_json}}</code> <code>{{note}}</code> <code>{{word_count}}</code> <code>{{voice_seconds}}</code> <code>{{duration}}</code> <code>{{frames}}</code> <code>{{step}}</code> <code>{{lufs}}</code>. Changes apply to the next step that runs (the system prompt is rewritten into each project's CLAUDE.md before every build).</p></div>`;
    $("#psave").onclick = tryDo(async () => { await api(`/api/prompts/${tab}`, { method: "PUT", body: { text: $("#ptext").value } }); x.text = $("#ptext").value; x.custom = true; toast("Saved"); show(); });
    $("#preset").onclick = tryDo(async () => { if (!confirm("Reset this prompt to the default?")) return; await api(`/api/prompts/${tab}`, { method: "DELETE" }); const d = await api("/api/prompts"); Object.assign(data, d); toast("Reset"); show(); });
  };
  $$("#ptabs button").forEach((b) => b.addEventListener("click", () => { tab = b.dataset.t; show(); }));
  show();
}
function showStyles(styles) {
  const builtins = styles.filter((x) => x.builtin);
  const S2 = JSON.parse(JSON.stringify(styles.filter((x) => !x.builtin)));
  const draw = () => {
    $("#pedit").innerHTML = `<div class="card"><div class="card-h"><h2>Styles</h2><span class="muted small">Each style's brief goes into the system prompt; its starter prompt guides the plan.</span><div class="spacer"></div><button class="btn" id="sreset">${builtins.length ? "Remove my styles" : "Reset to defaults"}</button><button class="btn" id="sadd">＋ Add style</button><button class="btn primary" id="ssave">Save styles</button></div>
      ${builtins.length ? `<p class="muted small" style="margin-top:0">Built-in styles: ${builtins.map((b) => `<span class="chip">${esc(b.emoji || "")} ${esc(b.name)}</span>`).join(" ")}. Add your own styles below.</p>` : ""}
      ${S2.map((s, i) => `<div class="card" style="box-shadow:none;background:var(--panel2)"><div class="grid3"><div class="field"><label class="f">Name</label><input class="input" data-si="${i}" data-sk="name" value="${esc(s.name)}"></div><div class="field"><label class="f">Emoji · id</label><div class="row" style="flex-wrap:nowrap"><input class="input" style="width:70px" data-si="${i}" data-sk="emoji" value="${esc(s.emoji || "")}"><input class="input" data-si="${i}" data-sk="id" value="${esc(s.id)}"></div></div><div class="field"><label class="f">Default length (s)</label><input class="input" type="number" data-si="${i}" data-sk="length" value="${s.length || 40}"></div></div>
        <div class="field"><label class="f">Look &amp; motion brief</label><textarea class="input" rows="3" data-si="${i}" data-sk="brief">${esc(s.brief)}</textarea></div>
        <div class="field"><label class="f">Starter prompt (from the guide)</label><textarea class="input" rows="2" data-si="${i}" data-sk="prompt">${esc(s.prompt)}</textarea></div>
        <button class="btn ghost danger" data-sdel="${i}">Remove style</button></div>`).join("")}</div>`;
    $$("[data-si]").forEach((el) => el.addEventListener("input", () => { const s = S2[+el.dataset.si]; s[el.dataset.sk] = el.dataset.sk === "length" ? +el.value : el.value; }));
    $$("[data-sdel]").forEach((b) => b.addEventListener("click", () => { S2.splice(+b.dataset.sdel, 1); draw(); }));
    $("#sadd").onclick = () => { S2.push({ id: `style${S2.length + 1}`, name: "New style", emoji: "✨", length: 40, brief: "", prompt: "" }); draw(); };
    $("#ssave").onclick = tryDo(async () => { await api("/api/styles", { method: "PUT", body: { styles: S2 } }); ST.app = await api("/api/state"); toast("Styles saved"); });
    $("#sreset").onclick = tryDo(async () => { if (!confirm(builtins.length ? "Remove all the styles you added?" : "Reset all styles to the defaults?")) return; await api("/api/styles", { method: "DELETE" }); ST.app = await api("/api/state"); showStyles(ST.app.styles); toast("Reset"); });
  };
  draw();
}

// ---------------- Setup ----------------
async function viewSetup() {
  ST.app = await api("/api/state");
  const s = ST.app.settings;
  view.innerHTML = `<div class="head"><div class="grow"><h1>Setup &amp; settings</h1><p class="sub">One-time checks for your computer, and the defaults every new reel starts from.</p></div><button class="btn" id="recheck">↻ Re-check</button></div>
    ${licenseCard(ST.app.license || {})}
    <div class="card"><div class="card-h"><h2>Your computer</h2></div><div id="checks" class="checks"><p class="muted"><span class="spin"></span> Checking…</p></div>
      <div class="row" style="margin-top:14px"><button class="btn primary" data-s="install-all">⚡ Install everything</button><button class="btn" data-s="install-python">🐍 Install Python packages</button><button class="btn" data-s="whisper">⬇ Download Whisper models</button><button class="btn" data-s="doctor">🩺 Run HyperFrames doctor</button><button class="btn" data-s="skills">🧩 Install HyperFrames skills for Claude Code</button></div>
      <p class="muted small">Whisper models are about 1.5 GB each the first time (English + multilingual for Malay). Doctor's optional items (whisper-cpp, MusicGen, Docker) aren't needed.</p>
      <div class="log" id="log" style="height:220px;margin-top:10px"></div></div>
    <form class="card" id="sf"><div class="card-h"><h2>Settings</h2><div class="spacer"></div><button class="btn primary" type="submit">Save settings</button></div>
      <div class="grid2">
        <div class="field"><label class="f">Projects folder</label><input class="input" name="projectsDir" value="${esc(s.projectsDir)}"></div>
        <div class="field"><label class="f">Python command <span class="muted">· detected: ${esc(ST.app.python)}</span></label><input class="input" name="python" value="${esc(s.python)}" placeholder="auto (${esc(ST.app.python)})"></div>
        <div class="field"><label class="f">Claude Code command</label><input class="input" name="claudeCmd" value="${esc(s.claudeCmd)}"></div>
        <div class="field"><label class="f">Claude model <span class="muted">· blank = Claude Code's default</span></label><input class="input" name="claudeModel" value="${esc(s.claudeModel)}" placeholder="e.g. opus or sonnet"></div>
        <div class="field"><label class="f">Whisper model</label><select class="input" name="whisperModel">${["small", "medium", "large-v3"].map((m) => `<option ${m === s.whisperModel ? "selected" : ""}>${m}</option>`).join("")}</select><div class="muted small">medium is what the kit uses; small is faster, large-v3 is most accurate.</div></div>
        <div class="field"><label class="f">Browser for rendering <span class="muted">· blank = HyperFrames' own</span></label><input class="input" name="browserPath" value="${esc(s.browserPath || "")}" placeholder="e.g. C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"><div class="muted small">Filled in automatically if HyperFrames can't download its own Chrome.</div></div>
        <div class="field"><label class="f">HyperFrames version</label><input class="input" name="hf" value="${esc(s.hf)}"><div class="muted small">The kit is pinned to 0.8.145.</div></div>
      </div>
      <h3>Talking video: free stock media &amp; music</h3>
      <p class="muted small" style="margin-top:0">Free keys: <a href="https://www.pexels.com/api/" target="_blank">Pexels</a> · <a href="https://pixabay.com/api/docs/" target="_blank">Pixabay</a> · <a href="https://unsplash.com/developers" target="_blank">Unsplash</a> · <a href="https://freesound.org/apiv2/apply/" target="_blank">Freesound</a>. Wikimedia and NASA work without keys.</p>
      <div class="grid2">
        <div class="field"><label class="f">Pexels API key</label><input class="input" name="pexelsKey" type="password" value="${esc(s.pexelsKey || "")}"></div>
        <div class="field"><label class="f">Pixabay API key</label><input class="input" name="pixabayKey" type="password" value="${esc(s.pixabayKey || "")}"></div>
        <div class="field"><label class="f">Unsplash access key</label><input class="input" name="unsplashKey" type="password" value="${esc(s.unsplashKey || "")}"></div>
        <div class="field"><label class="f">Freesound API key</label><input class="input" name="freesoundKey" type="password" value="${esc(s.freesoundKey || "")}"></div>
        <div class="field"><label class="f">Accent colour</label><input class="input" name="accent" type="color" value="${esc(s.accent || "#ff6a2b")}" style="height:42px;padding:4px"></div>
      </div>
      <label class="check field"><input type="checkbox" name="colorGrade" ${s.colorGrade !== false ? "checked" : ""}> Warm colour grade on talking videos by default</label>
      <label class="check field"><input type="checkbox" name="autoQA" ${s.autoQA ? "checked" : ""}> After rendering, let Claude check frames from the MP4 and fix problems it sees (one extra pass)</label>
      <label class="check field"><input type="checkbox" name="openBrowser" ${s.openBrowser ? "checked" : ""}> Open the browser when Reel Studio starts</label>
      <h3>Default English voice</h3>${voicePicker("en", "en", s.voiceEn)}
      <h3 style="margin-top:16px">Default Malay voice</h3>${voicePicker("ms", "ms-casual", s.voiceMs)}
      <p class="muted small" style="margin-top:14px">Data folder: <code>${esc(ST.app.dataDir)}</code> (settings, custom prompts, trash).</p>
    </form>`;
  bindVoicePicker("en"); bindVoicePicker("ms");
  $("#recheck").onclick = loadChecks;
  const da = $("#licdeact");
  if (da) da.onclick = tryDo(async () => { if (!confirm("Deactivate Reel Studio on this computer? You'll need your key to use it here again.")) return; const s = await api("/api/license/deactivate", { body: {} }); viewLicense(s); });
  $$("[data-s]").forEach((b) => b.addEventListener("click", tryDo(async () => { $("#log").innerHTML = ""; await api(`/api/setup/${b.dataset.s}`, { body: {} }); toast("Started, see the log"); })));
  $("#sf").addEventListener("submit", tryDo(async (e) => {
    e.preventDefault(); const f = e.target;
    const body = { projectsDir: f.projectsDir.value.trim(), python: f.python.value.trim(), claudeCmd: f.claudeCmd.value.trim() || "claude", claudeModel: f.claudeModel.value.trim(), whisperModel: f.whisperModel.value, hf: f.hf.value.trim() || "0.8.145", browserPath: f.browserPath.value.trim(), pexelsKey: f.pexelsKey.value.trim(), pixabayKey: f.pixabayKey.value.trim(), unsplashKey: f.unsplashKey.value.trim(), freesoundKey: f.freesoundKey.value.trim(), accent: f.accent.value, colorGrade: f.colorGrade.checked, autoQA: f.autoQA.checked, openBrowser: f.openBrowser.checked, voiceEn: readVoice("en"), voiceMs: readVoice("ms") };
    await api("/api/settings", { method: "PUT", body }); ST.app = await api("/api/state"); toast("Settings saved");
  }));
  loadChecks();
}
async function loadChecks() {
  const el = $("#checks"); if (!el) return;
  el.innerHTML = `<p class="muted"><span class="spin"></span> Checking…</p>`;
  const r = await api("/api/setup/check");
  el.innerHTML = r.items.map((c) => `<div class="ck"><span class="ic">${c.ok ? "✅" : c.optional ? "⚪" : "❌"}</span><div><b>${esc(c.name)}</b>${c.optional ? ` <span class="chip">optional</span>` : ""}<div class="muted small">${esc(c.detail)}</div>${c.ok ? "" : `<div class="small" style="margin-top:4px">Fix: <code>${esc(c.fix)}</code></div>`}</div></div>`).join("");
}

// ---------------- licence ----------------
function viewLicense(info = {}) {
  document.body.classList.add("locked");
  const buy = info.buyUrl && !/yourstore|x{6}/.test(info.buyUrl) ? info.buyUrl : "";
  view.innerHTML = `<div class="lic-wrap"><div class="card lic">
      <div class="lic-logo">${$(".brand .logo").innerHTML}</div>
      <h1>Activate Reel Studio</h1>
      <p class="sub">Paste the licence key from your purchase email. You only need to do this once on this computer.</p>
      ${info.message ? `<div class="banner warn">${esc(info.message)}</div>` : ""}
      <form id="licf"><input class="input" name="key" placeholder="XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX" autocomplete="off" spellcheck="false" autofocus>
        <button class="btn primary" type="submit" id="licgo">Activate</button></form>
      <div class="lic-foot muted small">${info.reason === "offline" ? `<button class="btn" id="licre">↻ Check again</button> ` : ""}${buy ? `No key yet? <a href="${esc(buy)}" target="_blank">Buy Reel Studio</a> · ` : ""}Lost your key? Search your email for "Reel Studio" or "Lemon Squeezy".</div>
    </div></div>`;
  $("#licf").addEventListener("submit", tryDo(async (e) => {
    e.preventDefault();
    const b = $("#licgo"); b.disabled = true; b.innerHTML = `<span class="spin"></span> Checking…`;
    try {
      await api("/api/license/activate", { body: { key: $("#licf").key.value } });
      toast("Activated. Welcome to Reel Studio!");
      document.body.classList.remove("locked");
      ST.app = await api("/api/state"); connectEvents(); location.hash = "#/setup"; route();
    } finally { b.disabled = false; b.textContent = "Activate"; }
  }));
  const re = $("#licre");
  if (re) re.addEventListener("click", tryDo(async () => { const s = await api("/api/license/check", { body: {} }); if (s.ok) location.reload(); else viewLicense(s); }));
}
function licenseCard(l) {
  return `<div class="card"><div class="card-h"><h2>Licence</h2></div>
    ${l.dev ? `<p class="muted">Developer mode (REEL_STUDIO_DEV=1): licence checks are off.</p>` :
    `<p>Active for <b>${esc(l.name || l.email || "you")}</b>${l.email ? ` · ${esc(l.email)}` : ""} · key <code>${esc(l.key)}</code> · last checked ${esc(ago(l.lastValid))}</p>
     <div class="row"><button class="btn" id="licdeact">Deactivate on this computer</button><span class="muted small">Frees this activation so you can use the key on another computer.</span></div>`}
  </div>`;
}

// ---------------- boot ----------------
(async () => {
  try { ST.app = await api("/api/state"); }
  catch { view.innerHTML = `<div class="banner err">Can't reach the Reel Studio server. Is the window running?</div>`; return; }
  if (!ST.app.license || !ST.app.license.ok) return viewLicense(ST.app.license || {});
  connectEvents();
  route();
})();
