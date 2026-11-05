/* Reel Studio: talking-video mode UI (loaded after app.js; uses its helpers). */
const TK = { words: [], presets: [], draft: null, dirty: false, key: "" };
const LAYOUT_LABEL = { overlay: "🙂 Overlay on you", split: "🌓 Split screen", broll: "🎞 B-roll cutaway", fullmotion: "✨ Full motion" };
const SFX = ["none", "pop", "whoosh", "whoosh_big", "ding", "click", "swish", "sparkle", "thud", "typing"];
const fmt = (t) => { t = Math.max(0, +t || 0); const m = Math.floor(t / 60); return `${m}:${(t - m * 60).toFixed(1).padStart(4, "0")}`; };

// ---------------- new talking video ----------------
async function viewNewTalking() {
  view.innerHTML = `<div class="head"><div class="grow"><h1>Talking video</h1><p class="sub">Upload a clip of you talking (portrait 9:16 from your phone). Reel Studio trims the uhm's, pauses and retakes, then Claude plans motion graphics, typography, B-roll and full-motion cutaways around what you say. You approve the edit plan, the rest is automatic.</p></div></div>
  <form id="tf">
    <div class="card"><div class="field"><label class="f">Your video</label>
      <input type="file" name="video" accept="video/*,.mp4,.mov,.m4v,.webm" required class="input"></div>
      <div class="grid3">
        <div class="field"><label class="f">Language you speak</label><select class="input" name="language">
          <option value="mixed">Malay + English (mixed)</option><option value="ms-casual">Bahasa Melayu</option><option value="en">English</option></select></div>
        <div class="field"><label class="f">Captions</label><div class="seg" id="cstyle"><button type="button" data-c="box" class="on">Highlight box</button><button type="button" data-c="pop">Pop &amp; colour</button></div></div>
        <div class="field"><label class="f">Call to action keyword <span class="muted">· optional</span></label><input class="input" name="cta" placeholder="e.g. GAJI"></div>
      </div>
      <div class="field"><label class="f">Topic <span class="muted">· optional, helps Claude pick visuals</span></label><input class="input" name="topic" placeholder="e.g. Is RM3K salary enough in KL?"></div>
      <div class="field" style="margin:0"><label class="f">Notes for Claude <span class="muted">· optional</span></label><textarea class="input" name="notes" rows="2" placeholder="e.g. show a rent vs food comparison; keep my face for the ending"></textarea></div>
    </div>
    <div class="row"><button class="btn primary big" type="submit" id="tgo">⬆ Upload &amp; plan the edit</button><span class="muted small" id="tprog">Transcribing + planning takes a few minutes (the first time also downloads Whisper).</span></div>
  </form>`;
  let cstyle = "box";
  $$("#cstyle button").forEach((b) => b.addEventListener("click", () => { $$("#cstyle button").forEach((x) => x.classList.remove("on")); b.classList.add("on"); cstyle = b.dataset.c; }));
  $("#tf").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = e.target, fd = new FormData();
    if (!f.video.files[0]) return toast("Choose your video", true);
    fd.append("language", f.language.value); fd.append("captionStyle", cstyle); fd.append("cta", f.cta.value);
    fd.append("topic", f.topic.value); fd.append("notes", f.notes.value); fd.append("video", f.video.files[0]);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/talking");
    xhr.upload.onprogress = (ev) => { if (ev.lengthComputable) $("#tprog").textContent = `Uploading… ${Math.round((ev.loaded / ev.total) * 100)}%`; };
    xhr.onload = () => {
      let j = {}; try { j = JSON.parse(xhr.responseText); } catch { /* ignore */ }
      if (xhr.status >= 400) { toast(j.error || "Upload failed", true); $("#tgo").disabled = false; return; }
      location.hash = `#/p/${j.id}`;
    };
    xhr.onerror = () => { toast("Upload failed", true); $("#tgo").disabled = false; };
    $("#tgo").disabled = true; $("#tgo").innerHTML = `<span class="spin"></span> Uploading…`;
    xhr.send(fd);
  });
}

// ---------------- project page ----------------
async function viewTalking(p) {
  ST.project = p;
  TK.draft = p.tplan ? JSON.parse(JSON.stringify(p.tplan)) : null; TK.dirty = false; TK.key = JSON.stringify(p.tplan);
  if (!TK.presets.length) TK.presets = await api("/api/motion-presets").catch(() => []);
  TK.words = await api(`/api/projects/${p.id}/words`).catch(() => []);
  view.innerHTML = `<div id="phead"></div><div id="pbanner"></div><div id="pstepper"></div>
    <div class="card" id="tsrc"></div>
    <div class="card" id="tplan"><div class="card-h"><span class="num" id="tn1">1</span><h2>Edit plan</h2><div class="spacer"></div><div id="tplanActions" class="row"></div></div><div id="tplanBody"></div></div>
    <div class="card" id="cbuild"></div>
    <div class="card" id="crender"></div>
    <div class="card"><details class="logbox" open><summary>Live log</summary><div class="log" id="log"></div></details></div>`;
  renderTalkingSections(true);
  const lg = await api(`/api/projects/${p.id}/log`);
  $("#log").innerHTML = lg.lines.map((l) => { const m = l.match(/^\[(\d\d:\d\d:\d\d)\] (.*)$/); return m ? `<div class="${/^✔/.test(m[2]) ? "ok" : /^✖/.test(m[2]) ? "bad" : /^▸/.test(m[2]) ? "tool" : /^💬/.test(m[2]) ? "say" : ""}"><span class="t">${m[1]}</span> ${esc(m[2])}</div>` : `<div>${esc(l)}</div>`; }).join("") || `<div class="t">Nothing yet.</div>`;
  $("#log").scrollTop = 1e9;
}

function talkingSteps(p) {
  const st = p.steps || {};
  const done = [!!p.tplan, !!p.planApproved, !!(st.cut && st.assets), !!st.build, !!st.render];
  const now = done.indexOf(false);
  return { done, now: now === -1 ? 5 : now };
}

function renderTalkingSections(first) {
  const p = ST.project; if (!p) return;
  const busy = !!p.busy;
  const vt = Date.parse(p.updatedAt) || 0;
  $("#phead").innerHTML = `<div class="head"><div class="grow"><div class="row" style="gap:8px;margin-bottom:6px">${stBadge(p)}<span class="chip">🎙 Talking video</span><span class="chip">${esc(langOf(p.form.language).label)}</span>${p.sourceSeconds ? `<span class="chip">${p.sourceSeconds.toFixed(0)}s source${p.edit ? ` → ${p.edit.total.toFixed(0)}s` : ""}</span>` : ""}${p.cost ? `<span class="chip">≈ $${p.cost.toFixed(2)} usage</span>` : ""}</div>
    <h1>${esc(p.title)}</h1>${p.form.topic ? `<p class="sub" style="margin:0">${esc(p.form.topic)}</p>` : ""}</div>
    <div class="row"><button class="btn" data-a="open">📂 Open folder</button><button class="btn" data-a="claude">⌨ Open in Claude Code</button><button class="btn ghost danger" data-a="delete">Delete</button></div></div>`;
  let banner = "";
  if (busy) banner = `<div class="banner run"><span class="spin"></span><div class="grow"><b>${esc(p.busy)}</b> · ${esc((STATUS[p.status] || [p.status])[0])}</div><button class="btn" data-a="cancel">■ Stop</button></div>`;
  else if (p.status === "error" || p.status === "stopped") banner = `<div class="banner err"><div class="grow"><b>${p.status === "stopped" ? "Stopped." : "Something went wrong."}</b><pre>${esc(p.error || "")}</pre></div><button class="btn primary" data-a="continue">↻ Continue</button></div>`;
  $("#pbanner").innerHTML = banner;
  const ss = talkingSteps(p);
  const names = ["Transcribe & plan", "Approve edit", "Cut & assets", "Build scenes", "Render"];
  $("#pstepper").innerHTML = `<div class="stepper">${names.map((n, i) => `<div class="${ss.done[i] ? "done" : i === ss.now ? "now" : ""}"><i>${ss.done[i] ? "✓" : i + 1}</i>${n}</div>`).join("")}</div>`;

  $("#tsrc").innerHTML = `<div class="card-h"><h2>Your footage</h2><span class="muted small">${TK.words.length ? `${TK.words.length} words transcribed` : "transcribing…"}${p.cutSeconds ? ` · ${p.cutSeconds}s of fillers/pauses/retakes removed` : ""}</span></div>
    <div class="media" style="grid-template-columns:220px 1fr"><video id="srcvid" class="reel" controls playsinline preload="metadata" src="/files/${p.id}/source/main.mp4#t=0.3"></video>
    <div class="small muted">Click a cut or a segment's time in the plan below to hear that moment here.<br><br>${p.credits && p.credits.length ? `<b>Stock credits</b> (also in credits.txt):<br>${p.credits.map(esc).join("<br>")}` : ""}</div></div>`;

  // plan
  const n1 = $("#tn1"); n1.className = "num " + (p.planApproved ? "done" : ss.now <= 1 ? "now" : ""); n1.textContent = p.planApproved ? "✓" : "1";
  $("#tplanActions").innerHTML = !p.tplan ? "" : `<span class="muted small" id="tsum"></span>
    ${TK.dirty ? `<button class="btn" data-t="save">💾 Save edits</button>` : ""}
    <button class="btn" data-t="regen" ${busy ? "disabled" : ""}>↻ Regenerate</button>
    ${p.planApproved ? "" : `<button class="btn primary" data-t="approve" ${busy ? "disabled" : ""}>✓ Approve &amp; edit the video</button>`}`;
  const key = JSON.stringify(p.tplan);
  if (first || (!TK.dirty && key !== TK.key)) { TK.key = key; TK.draft = p.tplan ? JSON.parse(JSON.stringify(p.tplan)) : null; renderPlanTable(); }
  updateTSum();

  // build + render cards (shared look)
  const st = p.steps || {};
  $("#cbuild").innerHTML = `<div class="card-h"><span class="num ${st.build ? "done" : ss.now === 3 ? "now" : ""}">${st.build ? "✓" : 4}</span><h2>Build scenes</h2><span class="muted small">Claude writes the full-motion scenes, tunes overlays and checks snapshots.</span></div>
    ${p.buildSummary ? `<div class="summary">${esc(p.buildSummary)}</div>` : `<p class="muted" style="margin:0">Starts automatically after the cut and the assets are ready.</p>`}
    ${p.lastFix ? `<h3 style="margin-top:14px">Last fix: ${esc(p.lastFix.note)}</h3><div class="summary">${esc(p.lastFix.text || "")}</div>` : ""}
    ${p.files.snapshots.length ? `<h3 style="margin-top:14px">Snapshots</h3><div class="snaps">${p.files.snapshots.map((f) => `<figure><img loading="lazy" src="/files/${p.id}/snapshots/${encodeURIComponent(f)}?t=${vt}" data-zoom><figcaption>${esc(f.replace(/\.png$/i, ""))}</figcaption></figure>`).join("")}</div>` : ""}`;
  const r = p.render;
  $("#crender").innerHTML = `<div class="card-h"><span class="num ${st.render ? "done" : ss.now === 4 ? "now" : ""}">${st.render ? "✓" : 5}</span><h2>Render</h2><div class="spacer"></div>
      ${p.files.reel ? `<a class="btn" href="/files/${p.id}/renders/reel.mp4" download="${esc((p.title || "reel").replace(/[^\w\- ]+/g, "").trim() || "reel")}.mp4">⬇ Download MP4</a>` : ""}
      ${st.build ? `<button class="btn" data-a="rerender" ${busy ? "disabled" : ""}>↻ Re-render</button>` : ""}</div>
    ${p.files.reel && r ? `<div class="media"><video class="reel" controls playsinline preload="metadata" src="/files/${p.id}/renders/reel.mp4?t=${encodeURIComponent(r.at)}#t=0.5"></video>
      <div><div class="stats"><div class="stat"><b>${r.duration.toFixed(1)} s</b><span>length</span></div><div class="stat"><b>${r.lufs === null ? "?" : r.lufs}</b><span>LUFS (aim ≈ -16)</span></div><div class="stat"><b>${r.sizeMB} MB</b><span>file size</span></div></div>
        ${p.files.tiles ? `<h3>Frames from the MP4</h3><img class="tiles" data-zoom src="/files/${p.id}/renders/tiles.jpg?t=${encodeURIComponent(r.at)}">` : ""}
        ${p.qa ? `<h3 style="margin-top:12px">Claude's frame check</h3><div class="summary">${esc(p.qa.text)}</div>` : ""}
        <h3 style="margin-top:14px">Fix what you see</h3>
        <textarea class="input" id="fixNote" rows="2" placeholder="e.g. “the B-roll at 0:12 doesn't match, use a graphic instead” or “text covers my face at 0:20”"></textarea>
        <div class="row" style="margin-top:8px"><button class="btn primary" data-a="fix" ${busy ? "disabled" : ""}>🛠 Fix &amp; re-render</button></div></div></div>`
    : `<p class="muted" style="margin:0">The MP4 appears here when it's ready.</p>`}`;
}

function wordsText(a, b) { return TK.words.slice(a, b + 1).map((w) => w[0]).join(" "); }
function updateTSum() {
  const d = TK.draft, el = $("#tsum"); if (!d || !el) return;
  const cutWords = new Set(); d.cuts.forEach((c) => { if (c.on) for (let i = c.from; i <= c.to; i++) cutWords.add(i); });
  const secs = [...cutWords].reduce((a, i) => a + (TK.words[i] ? TK.words[i][2] - TK.words[i][1] : 0), 0);
  const lay = {}; d.segments.forEach((s) => (lay[s.layout] = (lay[s.layout] || 0) + 1));
  el.textContent = `${d.segments.length} segments (${Object.entries(lay).map(([k, v]) => `${v} ${k}`).join(", ")}) · cuts ≈ ${secs.toFixed(1)} s + pauses`;
}
function presetOptions(sel) {
  const groups = {};
  TK.presets.forEach((x) => (groups[x.category] = groups[x.category] || []).push(x));
  return `<option value="none" ${sel === "none" || !sel ? "selected" : ""}>— none (just you) —</option>` + Object.entries(groups).map(([g, list]) => `<optgroup label="${esc(g)}">${list.map((x) => `<option value="${x.id}" ${x.id === sel ? "selected" : ""}>${esc(x.label)}</option>`).join("")}</optgroup>`).join("");
}

function renderPlanTable() {
  const p = ST.project, d = TK.draft, el = $("#tplanBody");
  if (!d) {
    el.innerHTML = p.busy ? `<p class="muted"><span class="spin"></span> ${esc((STATUS[p.status] || ["Working"])[0])} Watch the live log below.</p>` : `<p class="muted">No edit plan yet.</p><button class="btn primary" data-a="continue">↻ Continue</button>`;
    return;
  }
  const W = TK.words;
  const t = (i) => (W[i] ? W[i][1] : 0);
  const cuts = d.cuts.map((c, k) => `<label class="check small" style="padding:4px 0;align-items:flex-start"><input type="checkbox" data-cut="${k}" ${c.on ? "checked" : ""}>
      <span><a href="#" data-seek="${t(c.from)}" class="muted">${fmt(t(c.from))}</a> <b>${esc(c.reason)}</b> · <span class="muted">“${esc(wordsText(c.from, c.to).slice(0, 120))}”</span></span></label>`).join("");
  const segs = d.segments.map((s, k) => {
    const b = s.broll;
    const cands = b && b.candidates && b.candidates.length ? `<div class="snaps" style="margin-top:6px">${b.candidates.map((c, i) => `<figure style="width:96px;cursor:pointer" data-pick="${k}:${i}" title="${esc(`${c.title} · ${c.source} · ${c.license}`)}"><img src="${esc(c.thumb || "")}" style="width:96px;aspect-ratio:9/12;${i === (b.pick || 0) ? "outline:3px solid var(--accent);outline-offset:1px;" : ""}" onerror="this.style.opacity=.3"><figcaption>${esc(c.source)}${c.duration ? ` · ${c.duration.toFixed(0)}s` : ""}</figcaption></figure>`).join("")}</div>`
      : b ? `<div class="muted small" style="margin-top:6px">No results yet: search, or it falls back to a motion overlay.</div>` : "";
    return `<div class="card" style="box-shadow:none;background:var(--panel2);padding:12px 14px;margin-bottom:10px">
      <div class="row" style="gap:10px;margin-bottom:8px"><b>${s.id}</b><a href="#" data-seek="${t(s.from)}" class="muted small">${fmt(t(s.from))}–${fmt(W[s.to] ? W[s.to][2] : 0)}</a>
        <span class="small grow" style="min-width:200px">“${esc(wordsText(s.from, s.to))}”</span></div>
      <div class="grid3">
        <div><label class="f">Layout</label><select class="input" data-sk="${k}.layout">${Object.entries(LAYOUT_LABEL).map(([v, l]) => `<option value="${v}" ${v === s.layout ? "selected" : ""}>${l}</option>`).join("")}</select></div>
        <div><label class="f">Motion preset</label><select class="input" data-sk="${k}.preset">${presetOptions(s.preset)}</select></div>
        <div class="row" style="gap:12px;align-items:flex-end"><label class="check small"><input type="checkbox" data-sk="${k}.zoom" ${s.zoom ? "checked" : ""}> Punch-in zoom</label>
          <label class="check small" title="Cuts you out of the background so big text sits behind you (overlay + bigword/stamp/headline)"><input type="checkbox" data-sk="${k}.behind" ${s.behind ? "checked" : ""}> Text behind me</label>
          <select class="input" style="width:auto" data-sk="${k}.sfx" title="Sound effect">${SFX.map((x) => `<option ${x === s.sfx ? "selected" : ""}>${x}</option>`).join("")}</select></div>
      </div>
      ${s.preset && s.preset !== "none" ? `<div style="margin-top:8px"><label class="f">On-screen content <span class="muted">· ${esc((TK.presets.find((x) => x.id === s.preset) || {}).help || "")}</span></label><textarea class="cell" rows="2" data-sk="${k}.content">${esc(s.content)}</textarea></div>` : ""}
      ${s.layout === "fullmotion" ? `<div style="margin-top:8px"><label class="f">Full-motion scene brief</label><textarea class="cell" rows="2" data-sk="${k}.brief">${esc(s.brief || "")}</textarea></div>` : ""}
      ${s.layout === "split" || s.layout === "broll" ? `<div style="margin-top:8px"><label class="f">Stock ${b && b.kind === "image" ? "image" : "video"} <span class="muted">· pick one, or search again</span></label>
        <div class="row" style="flex-wrap:nowrap"><input class="input" data-q="${k}" value="${esc((b && b.query) || "")}" placeholder="2–4 English words, e.g. city traffic night"><select class="input" style="width:auto" data-qk="${k}"><option value="video" ${!b || b.kind !== "image" ? "selected" : ""}>video</option><option value="image" ${b && b.kind === "image" ? "selected" : ""}>image</option></select><button class="btn" data-search="${k}">🔍 Search</button></div>${cands}</div>` : ""}
    </div>`;
  }).join("");
  const m = d.music || {};
  const tracks = (m.candidates || []).map((c, i) => `<label class="check small" style="padding:3px 0"><input type="radio" name="mpick" data-mpick="${i}" ${i === (m.pick || 0) ? "checked" : ""}> <span class="grow">${esc(c.title)} <span class="muted">· ${esc(c.author || "")} · ${esc(c.source)} · ${c.duration ? c.duration.toFixed(0) + "s" : ""} · ${esc(c.license)}</span></span><audio controls preload="none" src="${esc(c.url)}" style="height:30px;width:220px"></audio></label>`).join("");
  el.innerHTML = `
    <div class="grid2"><div><label class="f">Hook headline <span class="muted">· first 2–3 s, over your face (// kicker, BIG LINE, ~accent)</span></label><textarea class="cell" rows="3" data-tk="hook.text">${esc(d.hook.text)}</textarea></div>
      <div><label class="f">Options</label><label class="check small"><input type="checkbox" data-tk="tightenPauses" ${d.tightenPauses ? "checked" : ""}> Tighten pauses longer than 0.45 s</label>
        <label class="check small"><input type="checkbox" data-tk="grade" ${d.grade ? "checked" : ""}> Warm colour grade (opencut-motion)</label>
        ${d.notes ? `<p class="small muted" style="margin:8px 0 0">Claude: ${esc(d.notes)}</p>` : ""}</div></div>
    <details style="margin:14px 0" ${d.cuts.length < 25 ? "open" : ""}><summary style="cursor:pointer;font-weight:600">✂ Cuts (${d.cuts.filter((c) => c.on).length} of ${d.cuts.length} on) · untick anything you want to keep</summary><div style="margin-top:8px;max-height:280px;overflow:auto">${cuts || `<p class="muted small">No fillers or retakes found.</p>`}</div></details>
    <h3>Segments</h3>${segs}
    <div class="card" style="box-shadow:none;background:var(--panel2);padding:12px 14px"><div class="row"><b>🎵 Music</b><label class="check small"><input type="checkbox" data-tk="music.on" ${m.on !== false ? "checked" : ""}> use music</label>
      <span class="small muted">volume</span><input type="range" min="0.05" max="0.35" step="0.01" value="${m.volume || 0.16}" data-tk="music.volume" style="width:120px"></div>
      <div class="row" style="flex-wrap:nowrap;margin-top:8px"><input class="input" id="mq" value="${esc(m.query || "")}" placeholder="mood, e.g. chill lofi hip hop"><button class="btn" data-t="music">🔍 Search music</button></div>
      <div style="margin-top:8px">${tracks || `<p class="muted small">No tracks yet. Music search needs a free Freesound key (Setup → API keys), or upload your own track.</p>`}</div></div>
    <div class="note-row"><input class="input" id="tnote" placeholder="Ask for changes, e.g. “more B-roll in the middle” or “keep my face for the ending”"><button class="btn" data-t="revise" ${p.busy ? "disabled" : ""}>✎ Revise with this note</button></div>`;
}

function setTDraft(path, val) {
  const parts = path.split(".");
  let o = TK.draft;
  for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]];
  o[parts[parts.length - 1]] = val;
  if (!TK.dirty) { TK.dirty = true; renderTalkingSections(); }
  updateTSum();
}
async function saveT() {
  if (!TK.dirty) return;
  const r = await api(`/api/projects/${ST.project.id}/tplan`, { method: "PUT", body: { plan: TK.draft } });
  TK.dirty = false; TK.key = JSON.stringify(r.tplan); ST.project = r;
}

view.addEventListener("change", (e) => {
  if (!ST.project || ST.project.kind !== "talking" || !TK.draft) return;
  const el = e.target;
  if (el.dataset.cut !== undefined) { TK.draft.cuts[+el.dataset.cut].on = el.checked; setTDraft("tightenPauses", TK.draft.tightenPauses); return; }
  if (el.dataset.mpick !== undefined) { TK.draft.music.pick = +el.dataset.mpick; setTDraft("music.pick", +el.dataset.mpick); return; }
  if (el.dataset.tk) { if (el.tagName === "TEXTAREA") return; setTDraft(el.dataset.tk, el.type === "checkbox" ? el.checked : el.type === "range" ? +el.value : el.value); return; }
  if (el.dataset.sk) {
    if (el.tagName === "TEXTAREA") return; // handled on input; re-rendering on blur would eat the next click
    const [k, f] = el.dataset.sk.split(".");
    const s = TK.draft.segments[+k];
    s[f] = el.type === "checkbox" ? el.checked : el.value;
    if (f === "layout" && (el.value === "split" || el.value === "broll") && !s.broll) s.broll = { query: "", kind: "video", candidates: [], pick: 0 };
    if (f === "preset" && el.value !== "none" && !s.content) s.content = (TK.presets.find((x) => x.id === el.value) || {}).example || "";
    TK.dirty = true; renderPlanTable(); renderTalkingSections(); updateTSum();
  }
});
view.addEventListener("input", (e) => {
  if (!ST.project || ST.project.kind !== "talking" || !TK.draft) return;
  const el = e.target;
  if (el.tagName === "TEXTAREA" && el.dataset.sk) { const [k, f] = el.dataset.sk.split("."); TK.draft.segments[+k][f] = el.value; if (!TK.dirty) { TK.dirty = true; renderTalkingSections(); } }
  else if (el.tagName === "TEXTAREA" && el.dataset.tk) setTDraft(el.dataset.tk, el.value);
});
view.addEventListener("click", tryDo(async (e) => {
  if (!ST.project || ST.project.kind !== "talking") return;
  const id = ST.project.id;
  const seek = e.target.closest("[data-seek]");
  if (seek) { e.preventDefault(); const v = $("#srcvid"); if (v) { v.currentTime = Math.max(0, +seek.dataset.seek - 0.4); v.play(); v.scrollIntoView({ behavior: "smooth", block: "center" }); } return; }
  const pick = e.target.closest("[data-pick]");
  if (pick) { const [k, i] = pick.dataset.pick.split(":").map(Number); TK.draft.segments[k].broll.pick = i; TK.dirty = true; renderPlanTable(); renderTalkingSections(); return; }
  const sb = e.target.closest("[data-search]");
  if (sb) { const k = +sb.dataset.search; await saveT(); await api(`/api/projects/${id}/tplan/search`, { body: { segId: TK.draft.segments[k].id, query: $(`[data-q="${k}"]`).value, kind: $(`[data-qk="${k}"]`).value } }); toast("Searching…"); return; }
  const b = e.target.closest("[data-t]"); if (!b) return;
  const t = b.dataset.t;
  if (t === "save") { await saveT(); renderTalkingSections(); toast("Edit plan saved"); }
  else if (t === "approve") { await saveT(); await api(`/api/projects/${id}/approve`, { body: {} }); toast("Approved: editing your video"); }
  else if (t === "regen") { if (TK.dirty && !confirm("Throw away your edits and plan again?")) return; TK.dirty = false; await api(`/api/projects/${id}/tplan/generate`, { body: {} }); }
  else if (t === "revise") { await saveT(); await api(`/api/projects/${id}/tplan/revise`, { body: { note: $("#tnote").value } }); }
  else if (t === "music") { await saveT(); await api(`/api/projects/${id}/tplan/music`, { body: { query: $("#mq").value } }); toast("Searching music…"); }
}));
