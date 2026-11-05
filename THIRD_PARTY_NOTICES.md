# Third-party notices

Reel Studio is (c) Reel Studio. It includes or downloads the following third-party components.

| Component | Where | Licence |
|---|---|---|
| Fonts: Inter, Inter Tight, Geist, Geist Mono, Instrument Serif, Caveat, Anton, Space Grotesk, JetBrains Mono | `kit/assets/fonts`, `kit-talking/assets/motion-fonts` | SIL Open Font License 1.1 (`OFL.txt` in each folder) |
| animate (canvas styles engine) by cth9191 | `kit-canvas/animate` | MIT (`kit-canvas/animate/LICENSE`) |
| OpenCut motion renderer (presets, captions), with lottie-web and fflate | bundled in `kit-talking/assets/rs-motion.js` | MIT (OpenCut, Airbnb lottie-web, fflate) |
| Express, Multer and other npm packages | `node_modules` | see each package's licence |
| Electron | the desktop shell | MIT |

Downloaded on the user's computer at setup (not shipped in the installer):

| Component | Licence |
|---|---|
| GSAP (from its official npm package) | GSAP Standard "No Charge" License, https://gsap.com/standard-license |
| HyperFrames CLI (via npx) | Apache-2.0 |
| Claude Code (Anthropic's official installer; each user signs in with their own Claude account) | Anthropic terms |
| Node.js, FFmpeg, Python and pip packages (faster-whisper, numpy, kokoro-onnx, soundfile, edge-tts, requests) | their own licences |
| Whisper and Kokoro model weights | MIT / Apache-2.0 |

Sound effects in `shared/sfx` are synthesized by Reel Studio (`dev/make_sfx.py`).
Stock media and music found through the user's own Pexels, Pixabay, Unsplash, Freesound, Wikimedia or NASA searches keep their original licences; Reel Studio shows the licence and author of each item.
