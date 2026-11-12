// ElevenLabs text-to-speech with the user's own API key (https://elevenlabs.io/docs/api-reference).
const fs = require("fs");
const path = require("path");
const S = require("./store");
const R = require("./runner");

// REEL_STUDIO_EL_API lets tests point at a mock server
const API = (process.env.REEL_STUDIO_EL_API || "https://api.elevenlabs.io").replace(/\/$/, "");

const MODELS = [
  { id: "eleven_v4", label: "Eleven v4 (best quality)", lang: true, limit: 9000 },
  { id: "eleven_multilingual_v2", label: "Multilingual v2 (steady, proven)", lang: false, limit: 9000 },
  { id: "eleven_flash_v2_5", label: "Flash v2.5 (fast, half the credits)", lang: true, limit: 9000 },
];
const DEFAULT_MODEL = "eleven_v4";

function key() {
  const k = (S.getSettings().elevenlabsKey || "").trim();
  if (!k) throw new Error("Add your ElevenLabs API key first (Setup → API keys → ElevenLabs).");
  return k;
}

async function call(pathname, { method = "GET", body, query } = {}) {
  const url = `${API}${pathname}${query ? "?" + new URLSearchParams(query) : ""}`;
  let res;
  try {
    res = await fetch(url, {
      method, headers: { "xi-api-key": key(), Accept: method === "GET" ? "application/json" : "audio/mpeg", ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(120000),
    });
  } catch (e) {
    if (/ElevenLabs API key/.test(e.message)) throw e;
    throw new Error(`Couldn't reach ElevenLabs (${e.cause ? e.cause.code || e.cause.message : e.message}). Check your internet connection.`);
  }
  if (!res.ok) {
    let msg = "";
    try { const j = await res.json(); msg = (j.detail && (j.detail.message || j.detail.status || (typeof j.detail === "string" ? j.detail : ""))) || j.message || ""; } catch { /* not json */ }
    if (res.status === 401) throw new Error("ElevenLabs rejected the API key. Check it in Setup → API keys (it needs Text to Speech and Voices permissions).");
    if (/quota|credits|limit/i.test(msg) || res.status === 429) throw new Error(`ElevenLabs: ${msg || "out of credits or too many requests"}. Check your plan at elevenlabs.io.`);
    throw new Error(`ElevenLabs error ${res.status}${msg ? `: ${msg}` : ""}`);
  }
  return res;
}

// ---- voices (cached for 10 minutes) ----
let cache = { at: 0, key: "", voices: null };
async function listVoices(refresh = false) {
  const k = key();
  if (!refresh && cache.voices && cache.key === k && Date.now() - cache.at < 600000) return cache.voices;
  const out = [];
  let token = null;
  for (let page = 0; page < 6; page++) {
    const q = { page_size: "100", include_total_count: "false" };
    if (token) q.next_page_token = token;
    const j = await (await call("/v2/voices", { query: q })).json();
    for (const v of j.voices || []) {
      const lab = v.labels || {};
      const langs = [...new Set((v.verified_languages || []).map((l) => l.language).filter(Boolean))];
      out.push({
        id: v.voice_id, name: v.name, category: v.category || "", preview: v.preview_url || "",
        gender: lab.gender || "", accent: lab.accent || "", age: lab.age || "", desc: lab.descriptive || lab.description || lab.use_case || "",
        languages: langs,
      });
    }
    if (!j.has_more || !j.next_page_token) break;
    token = j.next_page_token;
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  cache = { at: Date.now(), key: k, voices: out };
  return out;
}

async function account() {
  const j = await (await call("/v1/user/subscription")).json();
  return { tier: j.tier, used: j.character_count, limit: j.character_limit, resetsAt: j.next_character_count_reset_unix ? new Date(j.next_character_count_reset_unix * 1000).toISOString() : null };
}

// ---- speech ----
// split a long script on sentence ends so each request stays under the model's limit
function chunks(text, max) {
  const parts = text.replace(/\s+\n/g, "\n").split(/(?<=[.!?…])\s+|\n+/).filter((x) => x.trim());
  const out = []; let cur = "";
  for (const p of parts) {
    if ((cur + " " + p).length > max && cur) { out.push(cur.trim()); cur = p; } else cur = cur ? cur + " " + p : p;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const LANG = { en: "en", "ms-casual": "ms", "ms-formal": "ms" }; // "mixed" = let the model detect

async function speak({ text, voice, model, lang, stability, similarity, style, speed, out, log = () => {} }) {
  if (!voice) throw new Error("Pick an ElevenLabs voice first.");
  const m = MODELS.find((x) => x.id === model) || MODELS.find((x) => x.id === DEFAULT_MODEL);
  const parts = chunks(text, m.limit);
  log(`Generating the voice with ElevenLabs (${m.id}, ${text.length} characters${parts.length > 1 ? `, ${parts.length} parts` : ""})…`);
  const files = [];
  for (let i = 0; i < parts.length; i++) {
    const body = {
      text: parts[i], model_id: m.id,
      voice_settings: {
        stability: clamp(stability, 0, 1, 0.5), similarity_boost: clamp(similarity, 0, 1, 0.75),
        style: clamp(style, 0, 1, 0), use_speaker_boost: true, speed: clamp(speed, 0.7, 1.2, 1),
      },
    };
    if (m.lang && LANG[lang]) body.language_code = LANG[lang];
    if (parts.length > 1) { if (i > 0) body.previous_text = parts[i - 1].slice(-300); if (i < parts.length - 1) body.next_text = parts[i + 1].slice(0, 300); }
    const res = await call(`/v1/text-to-speech/${encodeURIComponent(voice)}`, { method: "POST", body, query: { output_format: "mp3_44100_128" } });
    const f = out.replace(/\.mp3$/i, `.el${i}.mp3`);
    fs.writeFileSync(f, Buffer.from(await res.arrayBuffer()));
    files.push(f);
  }
  // one clean mono file, like the other voices
  if (files.length === 1) {
    await R.runOk("ffmpeg", ["-v", "error", "-y", "-i", files[0], "-ar", "44100", "-ac", "1", "-b:a", "192k", out]);
  } else {
    const list = out.replace(/\.mp3$/i, ".el-list.txt");
    fs.writeFileSync(list, files.map((f) => `file '${f.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`).join("\n"));
    await R.runOk("ffmpeg", ["-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", list, "-ar", "44100", "-ac", "1", "-b:a", "192k", out]);
    fs.rmSync(list, { force: true });
  }
  for (const f of files) fs.rmSync(f, { force: true });
  log(`✔ ElevenLabs voice ready (${text.length} characters used).`);
}
const clamp = (v, lo, hi, d) => { const n = parseFloat(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };

module.exports = { MODELS, DEFAULT_MODEL, listVoices, account, speak, chunks };
