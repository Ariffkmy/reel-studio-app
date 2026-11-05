"""Build a canvas-style reel: the cth9191/animate engine (MIT, vendored in animate/) drawn frame by frame
inside HyperFrames, timed to the voice-over, with word captions, SFX and (optional) music.

The piece lives in piece/:
  piece.json   {"style": "riso", "captions": "box"|"pop"|"none", "captionY": 0.22, "accent": "#ff6a2b"}
  head.js      constants + ERA_LIST + SHOTS + TIMELINE (use DURATION = TOTAL; cue on spoken words with wt(i))
  scenes.js    one function per era, drawn with core.js + the style kit (animate/styles/<style>/kit.js)
  bridges.js   ERA_BG, pieceCam(), BRIDGES (shape morphs between eras; [] for none)
  sfx.json     [[time, "pop", 0.3], ...]  (files in assets/sfx)
Globals the build injects before head.js: VO = {lead, total, words: [[word, start, end], ...]} (timeline seconds,
voice already offset by the lead), wt(i) = start of word i, we(i) = end of word i, TOTAL (seconds).
usage: python tools/build_canvas.py     then: npx hyperframes snapshot / render
"""
import json, os, subprocess, shutil, html

R = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
FF = shutil.which("ffmpeg") or "ffmpeg"; FP = shutil.which("ffprobe") or "ffprobe"
fdur = lambda f: float(subprocess.run([FP, "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f], capture_output=True, text=True).stdout or 0)
P = lambda *a: os.path.join(R, *a)
LEAD = 0.25

meta = json.load(open(P("piece", "piece.json"), encoding="utf-8"))
style = meta.get("style", "cut-paper")
words = json.load(open(P("assets", "vo", "words.json"), encoding="utf-8"))

# ---- audio: voice normalised to -16 LUFS, music (optional) ducked under it
VO = P("assets", "vo", "vo.wav")
src = P("assets", "vo", "voice.mp3")
music = P("assets", "vo", "music.wav")
stamp = max(os.path.getmtime(src), os.path.getmtime(music) if os.path.exists(music) else 0)
if not os.path.exists(VO) or os.path.getmtime(VO) < stamp:
    if os.path.exists(music):
        graph = ("[0:a]loudnorm=I=-16:TP=-1.5,aresample=48000,asplit=2[v1][v2];"
                 f"[1:a]aresample=48000,volume={float(meta.get('musicVolume', 0.16))}[m];[m][v1]sidechaincompress=threshold=0.04:ratio=6:attack=15:release=350[md];"
                 "[v2][md]amix=inputs=2:duration=longest:normalize=0,alimiter=limit=0.95[out]")
        subprocess.run([FF, "-v", "error", "-y", "-i", src, "-i", music, "-filter_complex", graph, "-map", "[out]", "-ac", "2", VO], check=True)
    else:
        subprocess.run([FF, "-v", "error", "-y", "-i", src, "-af", "loudnorm=I=-16:TP=-1.5", "-ar", "48000", "-ac", "2", VO], check=True)
voice_len = fdur(src)
TOTAL = round(LEAD + voice_len + float(meta.get("tail", 1.2)), 2)
audio_len = round(min(fdur(VO), TOTAL - LEAD), 3)

# ---- the piece script: one IIFE so the engine's globals never clash with HyperFrames
def read(*a):
    return open(P(*a), encoding="utf-8").read()
W = [[w[0], round(LEAD + w[1], 3), round(LEAD + w[2], 3)] for w in words]
pre = f'''"use strict";
const VO = {json.dumps({"lead": LEAD, "total": TOTAL, "words": W}, ensure_ascii=False)};
const TOTAL = {TOTAL};
const wt = (i) => VO.words[Math.max(0, Math.min(i, VO.words.length - 1))][1];
const we = (i) => VO.words[Math.max(0, Math.min(i, VO.words.length - 1))][2];
'''
parts = [("piece/head.js", read("piece", "head.js")), ("animate/kit/core.js", read("animate", "kit", "core.js")),
         (f"animate/styles/{style}/kit.js", read("animate", "styles", style, "kit.js")),
         ("piece/scenes.js", read("piece", "scenes.js")), ("piece/bridges.js", read("piece", "bridges.js")),
         ("animate/kit/morph.js", read("animate", "kit", "morph.js"))]
body = "\n".join(f"// ===== {name} =====\n{txt}" for name, txt in parts)
js = "(function () {\n" + pre + body + "\nwindow.RS_PIECE = { renderFrame: renderFrame, TIMELINE: TIMELINE, style: " + json.dumps(style) + " };\n})();\n"
open(P("assets", "piece.js"), "w", encoding="utf-8").write(js)
node = shutil.which("node")
if node:
    chk = subprocess.run([node, "--check", P("assets", "piece.js")], capture_output=True, text=True)
    if chk.returncode != 0:
        print(chk.stderr.strip()[-1500:])
        raise SystemExit("piece.js has a syntax error (see above). Fix piece/*.js and run the build again.")

# ---- captions + sfx
cap = meta.get("captions", "box")
cap_words = [w for w in W if not any(a <= w[1] < b for a, b in meta.get("noCaptions", []))]
sfx = json.load(open(P("piece", "sfx.json"), encoding="utf-8")) if os.path.exists(P("piece", "sfx.json")) else []
aud, track = [], 10
for i, (t, name, vol) in enumerate(sorted(sfx)):
    f = os.path.join("assets", "sfx", f"{name}.mp3")
    if not os.path.exists(P(f)) or not (0 <= t < TOTAL - 0.2):
        continue
    track += 1
    aud.append(f'<audio id="sfx{i}" src="{f}" data-start="{round(t, 3)}" data-duration="{round(fdur(P(f)) or 1, 2)}" data-volume="{vol}" data-track-index="{track}"></audio>')

doc = f'''<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=1080, height=1920">
  <script src="assets/gsap.min.js"></script>
  <script src="assets/rs-motion.js"></script>
  <script src="assets/piece.js"></script>
  <style>
    * {{ margin: 0; padding: 0; box-sizing: border-box; }}
    html, body {{ width: 1080px; height: 1920px; overflow: hidden; background: #000; }}
    #main {{ position: relative; width: 1080px; height: 1920px; overflow: hidden; }}
    #art {{ position: absolute; left: 0; top: 0; width: 1080px; height: 1920px; }}
  </style>
</head>
<body>
  <div id="main" data-composition-id="main" data-start="0" data-duration="{TOTAL}" data-width="1080" data-height="1920">
    <canvas id="art" width="1080" height="1920"></canvas>
    <div id="caps" style="position:absolute;inset:0;z-index:5"></div>
    <audio id="vo" src="assets/vo/vo.wav" data-start="{LEAD}" data-duration="{audio_len}" data-volume="1" data-track-index="2"></audio>
    {"".join(aud)}
  </div>
  <script>
    (function () {{
      const tl = gsap.timeline({{ paused: true }});
      const art = document.getElementById("art");
      let cur = -1;
      const drv = {{ get t() {{ return cur; }}, set t(v) {{ cur = v; try {{ window.RS_PIECE.renderFrame(Math.min(v, {TOTAL} - 0.001), art); }} catch (e) {{ console.error("[piece] frame failed at " + v.toFixed(2) + "s", e); }} }} }};
      const caps = {json.dumps(cap != "none")} ? RSMotion.captions({json.dumps(cap_words, ensure_ascii=False)}, {{ style: {json.dumps("pop" if cap == "pop" else "box")}, y: {float(meta.get("captionY", 0.22))}, fontSize: {float(meta.get("captionSize", 4.2))}, accent: {json.dumps(meta.get("accent", "#ff6a2b"))} }}) : [];
      Promise.all([document.fonts.ready, RSMotion.ready(caps)]).then(() => {{
        tl.fromTo(drv, {{ t: 0 }}, {{ t: {TOTAL}, duration: {TOTAL}, ease: "none", immediateRender: true }}, 0);
        RSMotion.layer(document.getElementById("caps"), tl, caps, {{ total: {TOTAL} }});
        tl.set({{}}, {{}}, {TOTAL});
        window.__timelines["main"] = tl;
      }});
    }})();
  </script>
</body>
</html>
'''
open(P("index.html"), "w", encoding="utf-8").write(doc)
print(f"built index.html: {TOTAL}s, style {style}, {len(W)} words, captions {cap}, {len(aud)} sfx, music {'yes' if os.path.exists(music) else 'no'}")
