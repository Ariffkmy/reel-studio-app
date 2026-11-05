// Build step for the installer: copies the app into build/app, scrambles the JavaScript,
// and seals the built-in prompts/styles into an encrypted prompts.bin. Source files stay untouched.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const JO = require("javascript-obfuscator");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "build", "app");
const COPY = ["electron", "server", "public", "tools", "shared", "kit", "kit-canvas", "kit-talking", "license.config.json", "THIRD_PARTY_NOTICES.md", "EULA.txt"];
const SKIP = /(__pycache__|\.pyc$|^icon\.png$)/;

function copy(src, dst) {
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    fs.mkdirSync(dst, { recursive: true });
    for (const f of fs.readdirSync(src)) if (!SKIP.test(f)) copy(path.join(src, f), path.join(dst, f));
  } else fs.copyFileSync(src, dst);
}

const OPTS = {
  compact: true, simplify: true,
  controlFlowFlattening: true, controlFlowFlatteningThreshold: 0.4,
  deadCodeInjection: false,
  stringArray: true, stringArrayEncoding: ["base64"], stringArrayThreshold: 0.8, stringArrayRotate: true, stringArrayShuffle: true,
  splitStrings: true, splitStringsChunkLength: 10,
  identifierNamesGenerator: "hexadecimal", renameGlobals: false, selfDefending: false,
  transformObjectKeys: false, unicodeEscapeSequence: false, numbersToExpressions: true,
};
function scramble(file, target) {
  const code = fs.readFileSync(file, "utf8");
  const out = JO.obfuscate(code, { ...OPTS, target, sourceMap: false }).getObfuscatedCode();
  fs.writeFileSync(file, out);
}

fs.rmSync(path.join(ROOT, "build"), { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
for (const c of COPY) copy(path.join(ROOT, c), path.join(OUT, c));
fs.copyFileSync(path.join(ROOT, "electron", "icon.png"), path.join(OUT, "electron", "icon.png"));

// 1) scramble our JavaScript (MIT bundles like rs-motion.js and the canvas engine stay as they are)
const js = [
  ...fs.readdirSync(path.join(OUT, "server")).filter((f) => f.endsWith(".js")).map((f) => ["server/" + f, "node"]),
  ...fs.readdirSync(path.join(OUT, "electron")).filter((f) => f.endsWith(".js")).map((f) => ["electron/" + f, "node"]),
  ...fs.readdirSync(path.join(OUT, "public")).filter((f) => f.endsWith(".js")).map((f) => ["public/" + f, "browser"]),
  ["kit/assets/rs-lib.js", "browser"], ["kit/assets/presenter.js", "browser"],
];
for (const [f, target] of js) { scramble(path.join(OUT, f), target); console.log("  scrambled", f); }

// 2) seal the built-in prompts, styles and presets
const bundle = {};
for (const f of fs.readdirSync(path.join(ROOT, "prompts"))) bundle[f] = fs.readFileSync(path.join(ROOT, "prompts", f), "utf8");
const key = crypto.createHash("sha256").update(["rs", "reel", "studio", String(0x5eed), "prompts"].join(":")).digest();
const iv = crypto.randomBytes(12);
const c = crypto.createCipheriv("aes-256-gcm", key, iv);
const enc = Buffer.concat([c.update(JSON.stringify(bundle), "utf8"), c.final()]);
fs.writeFileSync(path.join(OUT, "prompts.bin"), Buffer.concat([iv, c.getAuthTag(), enc]));
console.log(`  sealed ${Object.keys(bundle).length} prompt/style files into prompts.bin`);

// 3) the app's own package.json (runtime dependencies only)
const pkg = require(path.join(ROOT, "package.json"));
fs.writeFileSync(path.join(OUT, "package.json"), JSON.stringify({
  name: pkg.name, productName: pkg.productName, version: pkg.version, description: pkg.description, author: pkg.author,
  main: pkg.main, dependencies: pkg.dependencies,
}, null, 2));
console.log("build/app ready");
