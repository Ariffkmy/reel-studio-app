// Licence keys via the Lemon Squeezy License API (no secret API key needed; safe to ship in the app).
// Docs: https://docs.lemonsqueezy.com/api/license-api
const fs = require("fs");
const os = require("os");
const path = require("path");
const https = require("https");
const http = require("http");
// REEL_STUDIO_LS_API lets tests point at a mock server, e.g. http://127.0.0.1:5555
const API = new URL(process.env.REEL_STUDIO_LS_API || "https://api.lemonsqueezy.com");
const S = require("./store");

const CONFIG_FILE = path.join(S.APP_ROOT, "license.config.json");
const STATE_FILE = path.join(S.DATA, "license.json");
const GRACE_DAYS = 14;          // keep working offline this long after the last good check
const RECHECK_HOURS = 24;       // validate online at most once a day

const config = () => ({ storeId: 0, productId: 0, buyUrl: "", ...S.readJSON(CONFIG_FILE, {}) });
const state = () => S.readJSON(STATE_FILE, null);
const save = (st) => { S.writeJSON(STATE_FILE, st); return st; };
const devBypass = () => process.env.REEL_STUDIO_DEV === "1";

function post(endpoint, form) {
  const body = new URLSearchParams(form).toString();
  return new Promise((resolve, reject) => {
    const req = (API.protocol === "http:" ? http : https).request({
      hostname: API.hostname, port: API.port || undefined, path: `/v1/licenses/${endpoint}`, method: "POST", timeout: 15000,
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded", "Content-Length": Buffer.byteLength(body) },
    }, (res) => {
      let d = ""; res.on("data", (c) => (d += c));
      res.on("end", () => { let j = {}; try { j = JSON.parse(d); } catch { /* not json */ } resolve({ status: res.statusCode, json: j }); });
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end(body);
  });
}

// the key must belong to this product (stops keys from other Lemon Squeezy stores)
function wrongProduct(meta) {
  const c = config();
  if (!meta) return false;
  if (c.storeId && Number(meta.store_id) !== Number(c.storeId)) return true;
  if (c.productId && Number(meta.product_id) !== Number(c.productId)) return true;
  return false;
}

const friendly = (e) => {
  const m = String(e || "");
  if (/activation limit/i.test(m)) return "This key is already active on the maximum number of computers. Deactivate it on the old computer (Setup → Licence), or contact support.";
  if (/not found|invalid/i.test(m)) return "That licence key wasn't found. Check it against your purchase email (copy and paste it).";
  if (/disabled|expired/i.test(m)) return "This licence key is disabled. Contact support if you think that's a mistake.";
  return m || "The licence server didn't accept this key.";
};

function status() {
  if (devBypass()) return { ok: true, dev: true, buyUrl: config().buyUrl };
  const st = state();
  const buyUrl = config().buyUrl;
  if (!st || !st.key || !st.instanceId) return { ok: false, reason: "none", buyUrl };
  if (st.revoked) return { ok: false, reason: "revoked", message: st.message || "This licence is no longer valid.", buyUrl };
  const age = (Date.now() - new Date(st.lastValid || 0)) / 864e5;
  if (age > GRACE_DAYS) return { ok: false, reason: "offline", message: `Reel Studio needs to check your licence online (last check ${Math.floor(age)} days ago). Connect to the internet and click Check again.`, buyUrl };
  return { ok: true, email: st.email, name: st.name, key: mask(st.key), lastValid: st.lastValid, buyUrl };
}
const mask = (k) => (k ? k.slice(0, 4) + "…" + k.slice(-4) : "");

async function activate(key) {
  key = String(key || "").trim();
  if (!key) throw new Error("Paste your licence key first.");
  const r = await post("activate", { license_key: key, instance_name: `${os.hostname()} (${os.platform()})` }).catch(() => null);
  if (!r) throw new Error("Couldn't reach the licence server. Check your internet connection and try again.");
  const j = r.json;
  if (!j.activated) throw new Error(friendly(j.error));
  if (wrongProduct(j.meta)) {
    await post("deactivate", { license_key: key, instance_id: j.instance.id }).catch(() => {});
    throw new Error("That key is for a different product.");
  }
  save({ key, instanceId: j.instance.id, email: j.meta && j.meta.customer_email, name: j.meta && j.meta.customer_name, lastValid: new Date().toISOString(), lastCheck: new Date().toISOString() });
  return status();
}

// call at startup and once a day; network errors keep the grace period running
async function validate(force = false) {
  if (devBypass()) return status();
  const st = state();
  if (!st || !st.key || !st.instanceId) return status();
  if (!force && st.lastCheck && (Date.now() - new Date(st.lastCheck)) / 36e5 < RECHECK_HOURS) return status();
  const r = await post("validate", { license_key: st.key, instance_id: st.instanceId }).catch(() => null);
  st.lastCheck = new Date().toISOString();
  if (r && r.json && typeof r.json.valid === "boolean") {
    const ok = r.json.valid && r.json.license_key && r.json.license_key.status !== "disabled" && !wrongProduct(r.json.meta);
    if (ok) { st.lastValid = st.lastCheck; st.revoked = false; }
    else if (r.status === 404 || r.status === 400 || r.json.valid === false) { st.revoked = true; st.message = friendly(r.json.error || "This licence is no longer valid (refunded or disabled)."); }
  }
  save(st);
  return status();
}

async function deactivate() {
  const st = state();
  if (st && st.key && st.instanceId) await post("deactivate", { license_key: st.key, instance_id: st.instanceId }).catch(() => null);
  try { fs.unlinkSync(STATE_FILE); } catch { /* none */ }
  return status();
}

// express middleware: everything under /api needs a licence, except these
const OPEN = [/^\/api\/license/, /^\/api\/state$/, /^\/api\/events$/, /^\/api\/setup\//];
function guard(req, res, next) {
  if (!req.path.startsWith("/api/") || OPEN.some((rx) => rx.test(req.path)) || status().ok) return next();
  res.status(402).json({ error: "Activate your licence first (Setup → Licence).", license: false });
}

module.exports = { status, activate, validate, deactivate, guard, config };
