# Reel Studio

A local app that makes animated 9:16 reels in code. It turns the whole reel workflow into one screen per step. **Claude Code** (on your Claude subscription) is the engine that writes the plans and the animation code, and **HyperFrames** renders the MP4 on your computer. There are no video-AI credits.

## Start it

1. Double-click **`start.bat`**. The first run installs two small packages.
2. Your browser opens at **http://localhost:4477**. Keep the black window open while you use the app; close it to stop the app.
3. The first time, go to **Setup & settings**:
   - Fix anything marked ❌. Each item shows the exact command to run.
   - Click **Install everything** (Node, FFmpeg, Python, Claude Code, the Python packages and GSAP; Windows uses winget).
   - Click **Download Whisper models** (about 1.5 GB each; needed once).

You need these installed: Node 22+, FFmpeg, Python 3, and Claude Code (logged in: run `claude` once in a terminal).

## Make a reel

1. **New reel**: enter a topic, pick a style, a length, a language (English, Bahasa Melayu santai, or formal) and a call-to-action keyword. Then choose the voice:
   - **AI voice**: Kokoro (free, offline, English), Edge TTS (free, needs internet; English and Malay), or **ElevenLabs** (your own ElevenLabs API key, set in Setup → API keys; English and Malay, choose voice, model, speed, stability and similarity).
   - **My recording**: you upload it after approving the plan.
2. Claude writes the **plan**: the hook (headline, spoken line, first visual) and one row per spoken line. You can edit any cell, ask for changes with a note, or regenerate it.
3. Click **Approve & make the reel**. Nothing gets built before this. From here it runs by itself:
   1. voice (AI voice, or it waits for your upload)
   2. Whisper word timings
   3. Claude builds every scene, lints it and checks snapshots
   4. render
   5. frame and loudness check of the MP4 (Claude fixes anything it sees, then the app renders once more)
4. Watch, download, or type a note in **Fix what you see**. Claude fixes it and the app renders again.
5. **Next reel, same setup** starts a new reel with the same style, voice and language.

The live log on each project shows exactly what Claude and the tools are doing.

## Talking video mode

**🎙 Talking video:** upload a portrait clip of you talking.

1. **Prep (automatic):** Reel Studio transcribes every word with Whisper, keeping the uhm's.
2. **Edit plan (Claude):**
   - **Cuts:** fillers, long pauses and retakes. Untick any you want to keep.
   - **Hook headline:** for the first 2–3 seconds.
   - **Segments:** one row per idea, each with its layout:
     - **Overlay on you:** an opencut-motion preset in the empty space.
     - **Split screen:** stock media on top, you below.
     - **B-roll cutaway:** a free stock video or image.
     - **Full motion:** an animated scene Claude writes.
   - Each segment also has a punch-in zoom, a "text behind me" cut-out, a sound effect and a stock clip you can swap.
   - **Music:** a background track.
3. **Approve.** The app then cuts and colour grades the footage, downloads B-roll and music (ducked under your voice), cuts you out of the background where needed, builds the composition, lets Claude write the full-motion scenes and check snapshots, then renders.

Free media sources:
- **With a free key** (Setup → Settings): Pexels (imported from your MoneyPrinterTurbo config), Pixabay, Unsplash, and Freesound for music.
- **Without a key:** Wikimedia Commons and NASA, plus Coverr, Mixkit and Archive.org, and Pixabay Music through your local OpenMontage folder.

Credits for everything used are saved to each project's `credits.txt`.

The motion presets are opencut-motion's own renderer (MIT), bundled in `kit-talking/assets/rs-motion.js`. To rebuild it, run `cd motion-engine && npm i && npx esbuild src/entry.ts --bundle --minify --format=iife --outfile=../kit-talking/assets/rs-motion.js`.

## Where things are

| What | Where |
|---|---|
| Your reels (each one is a normal HyperFrames project folder) | `Documents\ReelStudio\projects\` |
| Final video | `<project>\renders\reel.mp4` (older renders in `renders\history\`) |
| Settings, your edited prompts, deleted reels | `Documents\ReelStudio\` |
| The kit every reel starts from | `kit\` in this folder |
| Default prompts | `prompts\` in this folder |

**Open in Claude Code** on a project opens a terminal in that project folder, continuing the same Claude session, for when you'd rather talk to Claude directly.

## Prompts & styles

Everything Reel Studio sends to Claude is on the **Prompts & styles** page and can be edited:

| Prompt | Used for |
|---|---|
| System prompt | Reel Studio's reel rules (voice timing, phone layout, hooks, scene craft). It's written into each project as `CLAUDE.md`. |
| Plan | Writing the plan (guide prompt 2) |
| Revise | Changing the plan with your note |
| Build | Timing, captions, SFX, scenes, lint and snapshots (guide prompts 3–4) |
| Fix | Fixing what you describe (guide prompt 5) |
| QA | Checking frames from the MP4 (guide prompt 6) |

The page also holds the 5 styles: ivory explainer, bedtime story, glowing kids' animation, watercolor koi pond and illustrated short film.

**Reset to default** brings back the originals at any time.

## Notes

- How long it takes depends on your computer. Building the scenes usually takes Claude 10–30 minutes, and rendering takes a few minutes.
- The cost chip on a project is the equivalent API price that Claude Code reports. On a Pro or Max plan it comes out of your subscription usage, not your wallet.
- GSAP (the animation library) is bundled in the kit, so rendering works offline. Claude Code, Edge TTS and the first Whisper model download still need internet.
- HyperFrames is pinned to 0.8.145, the version the kit was made with. You can change it in Settings.

## Selling it (desktop installer)

- `npm install` then `npm run dist` builds `dist/ReelStudio-Setup.exe` (Windows, NSIS). On Linux/macOS the build needs Wine.
- `npm run dist` first runs `dev/protect.js`: it copies the app to `build/app`, scrambles all our JavaScript (javascript-obfuscator), seals `prompts/` into an encrypted `prompts.bin`, and the installer packs the code into `app.asar`. Your source folder is never changed. In the installed app the built-in prompts are hidden; the Prompts page only adds the buyer's extra instructions.
- Running from source (`start.bat` / `start.sh`) sets `REEL_STUDIO_DEV=1`, which turns licence checks off. The installed app always asks for a licence key.
- Licence keys: Lemon Squeezy License API (`server/license.js`). Put your Store ID, Product ID and checkout link in `license.config.json` before building.
- The installer does not contain GSAP; the app downloads it from the official npm package on first run. See `THIRD_PARTY_NOTICES.md` and `EULA.txt`.
- Scene engine: `kit/` (own builder `tools/build.py`, scene helpers `assets/rs-lib.js`, themes `assets/themes.css`, guide `GUIDE.md`). Sound effects are synthesized by `dev/make_sfx.py`.
