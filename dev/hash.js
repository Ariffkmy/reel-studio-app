// prints the installer's SHA-256 so you can paste it into the landing page (CONFIG.installerSha256)
const f = require("path").join(__dirname, "..", "dist", "ReelStudio-Setup.exe");
const h = require("crypto").createHash("sha256").update(require("fs").readFileSync(f)).digest("hex");
console.log(`\nSHA-256 of ReelStudio-Setup.exe:\n${h}\nPaste it into installerSha256 in the landing page's CONFIG.\n`);
