"""Reel Studio builder (c) Reel Studio.
Turns this project into a HyperFrames composition:

  assets/vo/voice.mp3     the voiceover (the clock of the reel)
  assets/vo/words.json    [[word, start, end], ...]  (Whisper; you may fix spellings, never times)
  assets/vo/music.wav     optional background music (ducked under the voice)
  assets/style.txt        theme: paper | blueprint | poster | neon | storybook
  reel.json               scenes, captions, sound effects, clips   (you edit this)
  assets/scenes.js        RS.scene("<id>", (s) => {...}) per scene  (you write this)

reel.json:
{
  "scenes":   [{"id": "hook", "from": 0}, {"id": "why", "from": 9}, ...],   # from = global word index where the scene starts
  "captions": ["Most people *lose*", "money *here.*", ...],                # optional; body only (2nd scene .. before last scene)
  "sfx":      [{"word": 12, "name": "pop1", "vol": 0.3, "shift": -0.05},   # at a global word
               {"scene": "why", "t": 0.4, "name": "ding"}],                  # or seconds into a scene
  "cut_whoosh": true,                                                        # soft whoosh on every scene cut (default true)
  "clips":    [{"scene": "proof", "file": "demo.mp4", "t": 0.5, "x": 70, "y": 300, "w": 940, "h": 700}]
}
usage: python tools/build.py      (then the app renders; you only lint + snapshot)"""
import html, json, os, re, shutil, subprocess, sys

R = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
P = lambda *a: os.path.join(R, *a)
FF = shutil.which("ffmpeg") or "ffmpeg"
FP = shutil.which("ffprobe") or "ffprobe"
LEAD = 0.2      # silence before the first word
TAIL = 1.8      # hold after the last word


def die(msg):
    print("BUILD ERROR:", msg, file=sys.stderr)
    sys.exit(1)


def dur(f):
    try:
        return float(subprocess.run([FP, "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f],
                                    capture_output=True, text=True).stdout.strip())
    except ValueError:
        return 0.0


def load(name, default=None):
    if not os.path.exists(P(name)):
        if default is not None:
            return default
        die(f"{name} is missing")
    try:
        return json.load(open(P(name), encoding="utf-8"))
    except json.JSONDecodeError as e:
        die(f"{name} is not valid JSON: {e}")


norm = lambda w: re.sub(r"[^\w']+", "", w.lower())

# ------------------------------------------------------------------ audio
words = load("assets/vo/words.json")
if not words:
    die("assets/vo/words.json is empty")
G = [(w, round(LEAD + s, 3), round(LEAD + e, 3)) for w, s, e in words]
voice, music, mixf = P("assets/vo/voice.mp3"), P("assets/vo/music.wav"), P("assets/vo/mix.wav")
src_time = max(os.path.getmtime(voice), os.path.getmtime(music) if os.path.exists(music) else 0, os.path.getmtime(__file__))
if not os.path.exists(mixf) or os.path.getmtime(mixf) < src_time:
    if os.path.exists(music):
        graph = ("[0:a]loudnorm=I=-16:TP=-1.5,aresample=48000,asplit=2[v][key];"
                 "[1:a]aresample=48000,volume=0.16[m];[m][key]sidechaincompress=threshold=0.04:ratio=6:attack=15:release=350[duck];"
                 "[v][duck]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[out]")
        cmd = [FF, "-v", "error", "-y", "-i", voice, "-stream_loop", "-1", "-i", music, "-filter_complex", graph, "-map", "[out]", "-ac", "2", mixf]
    else:
        cmd = [FF, "-v", "error", "-y", "-i", voice, "-af", "loudnorm=I=-16:TP=-1.5", "-ar", "48000", "-ac", "2", mixf]
    subprocess.run(cmd, check=True)
vo_len = round(dur(mixf), 3)
TOTAL = round(LEAD + vo_len + TAIL, 2)

# ------------------------------------------------------------------ plan
reel = load("reel.json")
style = open(P("assets/style.txt")).read().strip() if os.path.exists(P("assets/style.txt")) else "paper"
scenes = reel.get("scenes") or []
if not scenes:
    die("reel.json has no scenes")
ids = [s["id"] for s in scenes]
if len(set(ids)) != len(ids):
    die(f"scene ids must be unique: {ids}")
if any(not re.fullmatch(r"[a-z][a-z0-9_-]*", i) for i in ids):
    die(f"scene ids must be lowercase letters/digits: {ids}")
froms = [int(s["from"]) for s in scenes]
if froms[0] != 0 or froms != sorted(froms) or len(set(froms)) != len(froms) or froms[-1] >= len(G):
    die(f"scene 'from' word indexes must start at 0, increase, and stay below {len(G)}: {froms}")

rows = []  # (id, start, end, local word times, words)
for k, s in enumerate(scenes):
    i0, i1 = froms[k], froms[k + 1] if k + 1 < len(froms) else len(G)
    st = 0.0 if k == 0 else round(G[i0][1] - 0.12, 3)
    rows.append([s["id"], st, None, i0, i1])
for k in range(len(rows)):
    rows[k][2] = rows[k + 1][1] if k + 1 < len(rows) else TOTAL
SCN = {r[0]: r for r in rows}

# ------------------------------------------------------------------ theme
THEME = {
    "paper":     dict(bg="#F6F1EA", ink="#1B1A17", halo="246,241,234", hi="#E4572E", hiInk="#FFFFFF", font='800 68px/1.14 "Geist", "Inter", sans-serif', ls="-0.035em", case="none"),
    "blueprint": dict(bg="#EEF0F3", ink="#0F1420", halo="238,240,243", hi="#2463EB", hiInk="#FFFFFF", font='700 64px/1.16 "Space Grotesk", "Inter", sans-serif', ls="-0.035em", case="none"),
    "poster":    dict(bg="#ECEAE6", ink="#121212", halo="236,234,230", hi="#E5392C", hiInk="#FFFFFF", font='400 78px/1.08 "Anton", "Impact", sans-serif', ls="0.01em", case="uppercase"),
    "neon":      dict(bg="#0A0A0C", ink="#F4F4F5", halo="0,0,0", hi="#FF5E5E", hiInk="#0A0A0C", font='700 64px/1.16 "Space Grotesk", "Inter", sans-serif', ls="-0.03em", case="none"),
    "storybook": dict(bg="#13203F", ink="#FFF4DC", halo="19,32,63", hi="#FFC857", hiInk="#13203F", font='600 80px/1.08 "Caveat", cursive', ls="0", case="none"),
}
if style not in THEME:
    style = "paper"
TH = THEME[style]

import random
rnd = random.Random(11)
dots = lambda n, color, sizes: "".join(
    f'<i style="position:absolute;left:{rnd.randint(0, 1080)}px;top:{rnd.randint(0, 1920)}px;width:{(z := rnd.choice(sizes))}px;height:{z}px;border-radius:50%;background:{color};opacity:{rnd.uniform(.25, .9):.2f}"></i>'
    for _ in range(n))
BG = {  # (css, html, js)
    "paper": ("""#bg-rule { position:absolute; inset:-80px; background-image: linear-gradient(rgba(120,95,70,.10) 2px, transparent 2px); background-size: 100% 80px; }
      #bg-sun { position:absolute; width:1300px; height:1300px; left:-300px; top:-520px; border-radius:50%; background: radial-gradient(closest-side, rgba(228,87,46,.16), rgba(228,87,46,0)); }
      #bg-sea { position:absolute; width:1300px; height:1300px; right:-640px; bottom:-420px; border-radius:50%; background: radial-gradient(closest-side, rgba(47,125,109,.14), rgba(47,125,109,0)); }
      #bg-grain { position:absolute; inset:0; background-image: radial-gradient(rgba(60,40,20,.07) 1px, transparent 1.4px); background-size: 7px 7px; }""",
              '<div id="bg-rule"></div><div id="bg-sun"></div><div id="bg-sea"></div><div id="bg-grain"></div>',
              'tl.fromTo("#bg-rule",{y:0},{y:-160,duration:T,ease:"none"},0); tl.fromTo("#bg-sun",{x:0,y:0},{x:220,y:300,duration:T,ease:"sine.inOut"},0); tl.fromTo("#bg-sea",{x:0,y:0},{x:-260,y:-380,duration:T,ease:"sine.inOut"},0);'),
    "blueprint": ("""#bg-grid { position:absolute; inset:-96px; background-image: linear-gradient(rgba(28,42,68,.085) 2px, transparent 2px), linear-gradient(90deg, rgba(28,42,68,.085) 2px, transparent 2px), linear-gradient(rgba(28,42,68,.05) 1px, transparent 1px), linear-gradient(90deg, rgba(28,42,68,.05) 1px, transparent 1px); background-size: 96px 96px, 96px 96px, 24px 24px, 24px 24px; }
      #bg-fade { position:absolute; inset:0; background: linear-gradient(180deg, rgba(238,240,243,.9) 0%, rgba(238,240,243,0) 14%, rgba(238,240,243,0) 80%, rgba(238,240,243,.92) 100%); }""",
                  '<div id="bg-grid"></div><div id="bg-fade"></div>',
                  'tl.fromTo("#bg-grid",{y:0},{y:-96,duration:T,ease:"none"},0);'),
    "poster": ("""#bg-tone { position:absolute; inset:-40px; background-image: radial-gradient(circle, rgba(18,18,18,.16) 1.6px, transparent 2.2px); background-size: 9px 9px; -webkit-mask-image: radial-gradient(ellipse at 50% 46%, rgba(0,0,0,.08) 30%, rgba(0,0,0,.95) 95%); mask-image: radial-gradient(ellipse at 50% 46%, rgba(0,0,0,.08) 30%, rgba(0,0,0,.95) 95%); }
      #bg-light { position:absolute; inset:0; background: radial-gradient(ellipse at 50% 38%, rgba(255,255,255,.7), rgba(255,255,255,0) 60%); }""",
               '<div id="bg-tone"></div><div id="bg-light"></div>',
               'tl.fromTo("#bg-tone",{y:0},{y:-27,duration:T,ease:"none"},0);'),
    "neon": ("""#bg-grid { position:absolute; inset:-80px; background-image: linear-gradient(rgba(255,255,255,.04) 1.5px, transparent 1.5px), linear-gradient(90deg, rgba(255,255,255,.04) 1.5px, transparent 1.5px); background-size: 80px 80px; }
      #bg-pts i { box-shadow: 0 0 10px rgba(255,94,94,.8); }
      #bg-vig { position:absolute; inset:0; background: radial-gradient(ellipse at 50% 40%, rgba(10,10,12,0) 40%, rgba(0,0,0,.75) 100%); }""",
             '<div id="bg-grid"></div><div id="bg-pts" style="position:absolute;inset:0">' + dots(56, "#FF5E5E", [4, 5, 6, 8]) + '</div><div id="bg-vig"></div>',
             'tl.fromTo("#bg-grid",{y:0},{y:-80,duration:T,ease:"none"},0); tl.fromTo("#bg-pts",{y:0},{y:-240,duration:T,ease:"none"},0);'),
    "storybook": ("""#bg-sky { position:absolute; inset:0; background: linear-gradient(180deg, #0D1631 0%, #13203F 55%, #1C2E57 100%); }
      #bg-stars { position:absolute; inset:0; }
      #bg-moon { position:absolute; width:180px; height:180px; right:120px; top:250px; border-radius:50%; background:#FFF4DC; box-shadow: 0 0 80px 30px rgba(255,200,87,.25); }
      #bg-hill { position:absolute; left:-200px; right:-200px; bottom:-260px; height:620px; border-radius:50% 50% 0 0; background:#0B1430; }""",
                  '<div id="bg-sky"></div><div id="bg-stars">' + dots(70, "#FFF4DC", [3, 4, 5, 7]) + '</div><div id="bg-moon"></div><div id="bg-hill"></div>',
                  'tl.fromTo("#bg-stars",{y:0},{y:-60,duration:T,ease:"none"},0); tl.fromTo("#bg-moon",{y:0},{y:40,duration:T,ease:"sine.inOut"},0);'),
}
bg_css, bg_html, bg_js = BG[style]

# ------------------------------------------------------------------ documents
os.makedirs(P("compositions"), exist_ok=True)
for f in os.listdir(P("compositions")):
    if f.endswith(".html"):
        os.remove(P("compositions", f))
LINKS = '<link rel="stylesheet" href="../assets/themes.css">' + "".join(
    f'<link rel="stylesheet" href="../assets/{c}.css">' for c in ("blueprint", "poster", "neon") if os.path.exists(P("assets", f"{c}.css")))


def sub(cid, body, script, extra_css=""):
    return f'''<!DOCTYPE html>
<html lang="en">
  <head><meta charset="UTF-8"></head>
  <body>
    <template id="{cid}-template">
      {LINKS}
      <style>#{cid}-root {{ position: absolute; inset: 0; overflow: hidden; }} {extra_css}</style>
      <div id="{cid}-root" data-composition-id="{cid}" data-theme="{style}" data-width="1080" data-height="1920">
{body}
      </div>
      <script>
{script}
      </script>
    </template>
  </body>
</html>
'''


# background
open(P("compositions", "bg.html"), "w", encoding="utf-8").write(sub(
    "bg", bg_html,
    f'(function () {{ const T = {TOTAL}; const tl = gsap.timeline({{ paused: true }}); {bg_js} window.__timelines["bg"] = tl; }})();',
    f"#bg-root {{ background: {TH['bg']}; }} {bg_css}"))

# scenes
clips = reel.get("clips") or []
for sid, st, en, i0, i1 in rows:
    d = round(en - st, 3)
    ctx = {"W": [round(G[j][1] - st, 3) for j in range(i0, i1)], "words": [G[j][0] for j in range(i0, i1)], "dur": d, "from": i0}
    vids = []
    for k, c in enumerate(x for x in clips if x.get("scene") == sid):
        f = P("assets", "clips", c["file"])
        if not os.path.exists(f):
            print(f"  warning: clip {c['file']} not found, skipped")
            continue
        at = round(float(c.get("t", 0)), 3)
        ln = round(min(dur(f) - 0.04, d - at), 3)
        box = f'left:{c.get("x", 70)}px;top:{c.get("y", 300)}px;width:{c.get("w", 940)}px;height:{c.get("h", 700)}px'
        vids.append(f'        <video id="{sid}-clip{k}" class="clip rs-clip" src="../assets/clips/{c["file"]}" muted playsinline data-start="{at}" data-duration="{ln}" data-track-index="{k + 1}" style="position:absolute;{box};object-fit:cover;border-radius:28px"></video>')
    script = f'''        (function () {{
          const ctx = {json.dumps(ctx, ensure_ascii=False)};
          const root = document.getElementById("{sid}-root");
          window.__timelines["{sid}"] = RS.build("{sid}", root, ctx);
        }})();'''
    open(P("compositions", f"{sid}.html"), "w", encoding="utf-8").write(sub(sid, "\n".join(vids), script))

# captions (body only: hook has its own headline, the last scene is the call to action)
body0 = froms[1] if len(froms) > 1 else 0
body1 = froms[-1] if len(froms) > 2 else len(G)
caps = reel.get("captions")
if caps is None or caps == "auto":
    caps, j = [], body0
    while j < body1:
        n = 3 if body1 - j != 4 else 2
        caps.append(" ".join(G[x][0] for x in range(j, min(j + n, body1)))); j += n
chunks, j = [], body0
for c in caps:
    toks = c.split()
    for k, tk in enumerate(toks):
        if j + k >= len(G) or norm(G[j + k][0]) != norm(tk.strip("*")):
            got = " ".join(G[x][0] for x in range(j, min(j + len(toks) + 2, len(G))))
            die(f'caption "{c}" does not match the voice at word {j}. The voice says: "{got}". '
                f"Captions must spell the spoken words in order (fix the caption, or the spelling in words.json).")
    chunks.append((toks, [G[j + k][1] for k in range(len(toks))]))
    j += len(toks)
if caps and j != body1:
    die(f"captions end at word {j}, but the body ends at word {body1} ('{G[min(body1, len(G) - 1)][0]}'). Cover every body word exactly once.")
lines = []
for k, (toks, ts) in enumerate(chunks):
    nxt = chunks[k + 1][1][0] if k + 1 < len(chunks) else ts[-1] + 0.9
    st = round(ts[0] - 0.06, 2)
    d = round(min(nxt - 0.03, ts[-1] + 0.95) - st, 2)
    spans = "".join(f'<span class="w{" hi" if t.startswith("*") else ""}" data-t="{tt:.3f}">{html.escape(t.strip("*"))}</span>' for t, tt in zip(toks, ts))
    lines.append(f'        <div id="cap{k}" class="cap clip" data-start="{st}" data-duration="{d}" data-track-index="1">{spans}</div>')
cap_css = f'''.cap {{ position: absolute; left: 70px; right: 70px; top: 1300px; height: 220px; display: flex; flex-wrap: wrap; justify-content: center; align-content: flex-start; gap: 4px 18px; font: {TH["font"]}; letter-spacing: {TH["ls"]}; text-transform: {TH["case"]}; color: {TH["ink"]}; text-align: center; }}
      .cap .w {{ display: inline-block; text-shadow: 0 0 26px rgba({TH["halo"]},.95), 0 0 10px rgba({TH["halo"]},.9); }}
      .cap .w.hi {{ color: {TH["hiInk"]}; text-shadow: none; background: {TH["hi"]}; border-radius: 14px; padding: 0 12px; margin: 0 -12px; }}'''
open(P("compositions", "captions.html"), "w", encoding="utf-8").write(sub("captions", "\n".join(lines), '''        (function () {
          const tl = gsap.timeline({ paused: true });
          document.querySelectorAll("#captions-root .cap").forEach((line) => {
            const st = parseFloat(line.dataset.start), d = parseFloat(line.dataset.duration), ws = line.querySelectorAll(".w");
            ws.forEach((el) => tl.fromTo(el, { autoAlpha: 0, y: 26, scale: 0.9 }, { autoAlpha: 1, y: 0, scale: 1, duration: 0.26, ease: "back.out(2.2)" }, Math.max(st, parseFloat(el.dataset.t) - 0.04)));
            tl.to(ws, { autoAlpha: 0, y: -14, duration: 0.16, ease: "power2.in" }, st + d - 0.17);
          });
          window.__timelines["captions"] = tl;
        })();''', cap_css))

# sound effects
SFXDIR = P("assets", "sfx")
have = {f[:-4] for f in os.listdir(SFXDIR) if f.endswith(".mp3")} if os.path.isdir(SFXDIR) else set()
cues = []
if reel.get("cut_whoosh", True):
    cues += [(r[1] - 0.08, "whoosh_short", 0.22) for r in rows[1:]]
for c in reel.get("sfx") or []:
    name = c.get("name", "")
    if name not in have:
        print(f"  warning: sfx '{name}' not in assets/sfx, skipped")
        continue
    if "word" in c:
        wi = int(c["word"])
        if not 0 <= wi < len(G):
            print(f"  warning: sfx word {wi} out of range, skipped"); continue
        t = G[wi][1]
    elif c.get("scene") in SCN:
        t = SCN[c["scene"]][1] + float(c.get("t", 0))
    else:
        t = float(c.get("t", 0))
    cues.append((t + float(c.get("shift", 0)), name, float(c.get("vol", 0.3))))
starts = [g[1] for g in G]
near = lambda t: any(abs(t - x) < 0.3 for x in starts)
auds = []
for k, (t, name, v) in enumerate(sorted(cues)):
    if not 0 < t < TOTAL - 0.3:
        continue
    f = P("assets", "sfx", name + ".mp3")
    auds.append(f'    <audio id="sfx{k:02d}" src="assets/sfx/{name}.mp3" data-start="{round(t, 3)}" data-duration="{round(dur(f), 2)}" data-track-index="{20 + k}" data-volume="{round(v * (0.7 if near(t) else 1), 2)}"></audio>')

# index
lay = lambda cid, tr, s0, d: f'    <div id="{cid}"{' data-track-kind="captions"' if cid == "captions" else ""} data-composition-id="{cid}" data-composition-src="compositions/{cid}.html" data-start="{s0}" data-duration="{d}" data-track-index="{tr}" data-width="1080" data-height="1920"></div>'
scripts = "".join(f'\n  <script src="assets/{f}"></script>' for f in ("presenter.js", "rs-lib.js", "scenes.js") if os.path.exists(P("assets", f)))
if not os.path.exists(P("assets", "gsap.min.js")):
    die("assets/gsap.min.js is missing (Reel Studio copies it when the project is created)")
open(P("index.html"), "w", encoding="utf-8").write(f'''<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=1080, height=1920">
  <script src="assets/gsap.min.js"></script>{scripts}
  {LINKS.replace("../assets/", "assets/")}
  <style>
    * {{ margin: 0; padding: 0; box-sizing: border-box; }}
    html, body {{ width: 1080px; height: 1920px; overflow: hidden; background: {TH["bg"]}; }}
    #main {{ position: relative; width: 100%; height: 100%; overflow: hidden; background: {TH["bg"]}; }}
  </style>
</head>
<body>
  <div id="main" data-composition-id="main" data-start="0" data-duration="{TOTAL}" data-width="1080" data-height="1920">
{lay("bg", 0, 0, TOTAL)}
{chr(10).join(lay(sid, 1, st, round(en - st, 3)) for sid, st, en, *_ in rows)}
{lay("captions", 3, 0, TOTAL)}
    <audio id="voice" src="assets/vo/mix.wav" data-start="{LEAD}" data-duration="{vo_len}" data-track-index="10" data-volume="1"></audio>
{chr(10).join(auds)}
  </div>
  <script>window.__timelines["main"] = gsap.timeline({{ paused: true }});</script>
</body>
</html>
''')
json.dump({"total": TOTAL, "style": style, "scenes": [[sid, st, en] for sid, st, en, *_ in rows]}, open(P("layout.json"), "w"), indent=1)
print(f"built {len(rows)} scenes, {TOTAL}s, style {style}, {len(chunks)} caption lines, {len(auds)} sfx:",
      " ".join(f"{sid}@{st}" for sid, st, *_ in rows))
