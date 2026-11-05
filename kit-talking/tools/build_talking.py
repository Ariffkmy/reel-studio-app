"""Build a talking-video reel (HyperFrames) from edit.json.

edit.json is written by Reel Studio after you approve the edit plan. Times are on the EDITED
timeline (after fillers, pauses and retakes were cut). Layouts per segment:
  overlay     your footage full screen + a motion preset (opencut-motion engine) in the empty space
  split       B-roll / graphic in the top half, your footage in the bottom half
  broll       full-screen stock video or image while your voice continues
  fullmotion  full-screen animated scene: compositions/fm-<id>.html (written by Claude; a
              preset-based fallback is generated if it doesn't exist yet)
Every segment can also have: zoom (punch-in), behind (text behind you, needs assets/matte/<id>.webm),
sfx (whoosh|pop|ding|click|none).
usage: python tools/build_talking.py      then: npx hyperframes render -o renders/reel.mp4
"""
import json, os, html, subprocess, shutil

R = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
E = json.load(open(os.path.join(R, "edit.json"), encoding="utf-8"))
FP = shutil.which("ffprobe") or "ffprobe"
W, H = 1080, 1920
TOTAL = round(float(E["total"]), 3)
SEGS = E["segments"]
ACCENT = E.get("accent") or "#ff6a2b"
CAP_Y = float(E.get("captionY", 0.22))
SFX_FILES = {"whoosh": "whoosh_short", "whoosh_big": "whoosh_big", "pop": "pop2", "ding": "ding", "click": "click3", "swish": "swish1", "sparkle": "sparkle", "thud": "thud", "typing": "typing2"}


def dur(f):
    try:
        return float(subprocess.run([FP, "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f], capture_output=True, text=True).stdout)
    except Exception:  # noqa: BLE001
        return 0.0


def r3(x):
    return round(float(x), 3)


# ---------------------------------------------------------------- overlays (motion engine)
front, behind = [], []
for s in SEGS:
    if s.get("layout") in ("overlay", "split") and s.get("preset") and s["preset"] != "none":
        st = r3(s.get("at", s["start"]))
        o = {"preset": s["preset"], "content": s.get("content", ""), "start": st, "duration": r3(max(0.6, s["end"] - st)), "accent": ACCENT}
        for k in ("x", "y", "fontSize", "assetId", "playback", "color", "entrance"):
            if s.get(k) is not None:
                o[k] = s[k]
        if s.get("layout") == "split":
            o.setdefault("y", -0.27)          # top half
            o.setdefault("fontSize", 6)
        (behind if s.get("behind") and os.path.exists(os.path.join(R, "assets", "matte", f"{s['id']}.webm")) else front).append(o)
hook = E.get("hook") or {}
if hook.get("text"):
    lines = hook["text"].strip()
    front.append({"preset": hook.get("preset", "headline"), "content": lines, "start": r3(hook.get("start", 0)), "duration": r3(max(1.2, hook["end"] - hook.get("start", 0))), "accent": ACCENT})

# captions: words of the edited timeline, minus the hook and full-motion segments that turn them off
no_caps = [(0, hook.get("end", 0))] if hook.get("text") else []
no_caps += [(s["start"], s["end"]) for s in SEGS if s.get("captions") is False]
# presets that sit in the lower part of the frame would collide with the caption band
LOWER = {"lower-third", "location", "cta"}
no_caps += [(o["start"], o["start"] + o["duration"]) for o in front + behind if o["preset"] in LOWER or float(o.get("y", 0) or 0) > 0.1]
cap_words = [w for w in E.get("words", []) if not any(a - 0.01 <= w[1] < b for a, b in no_caps)]

# ---------------------------------------------------------------- media + layout timeline
media, tl = [], []
track = 10
fm_comps = []
os.makedirs(os.path.join(R, "compositions"), exist_ok=True)
for s in SEGS:
    sid, a, b = s["id"], r3(s["start"]), r3(s["end"])
    d = r3(b - a)
    lay = s.get("layout", "overlay")
    if lay in ("broll", "split") and s.get("broll"):
        f = s["broll"]["file"]
        box = "top:0;height:960px" if lay == "split" else "top:0;height:1920px"
        if s["broll"].get("kind") == "image":
            inner = f'<img src="{html.escape(f)}" style="width:100%;height:100%;object-fit:cover">'
        else:
            track += 1
            inner = f'<video id="v-{sid}" src="{html.escape(f)}" muted playsinline data-start="{a}" data-duration="{d}" data-track-index="{track}" style="width:100%;height:100%;object-fit:cover"></video>'
        media.append(f'<div class="broll" id="b-{sid}" style="{box}">{inner}</div>')
        tl.append(f'tl.set("#b-{sid}", {{autoAlpha: 1}}, {a}); tl.set("#b-{sid}", {{autoAlpha: 0}}, {b});')
        tl.append(f'tl.fromTo("#b-{sid}", {{opacity: 0}}, {{opacity: 1, duration: 0.18, ease: "power1.out", immediateRender: false}}, {a});')
        kb = "#b-%s > *" % sid
        tl.append(f'tl.fromTo("{kb}", {{scale: 1.0}}, {{scale: 1.08, duration: {d}, ease: "none", immediateRender: false}}, {a});')
    if lay == "split":
        tl.append(f'tl.set(["#fw", "#mw"], {{top: 960, height: 960}}, {a}); tl.set(["#fw", "#mw"], {{top: 0, height: 1920}}, {b});')
        tl.append(f'tl.set("#splitline", {{autoAlpha: 1}}, {a}); tl.set("#splitline", {{autoAlpha: 0}}, {b});')
    if lay == "fullmotion":
        fid = f"fm-{sid}"
        path = os.path.join(R, "compositions", f"{fid}.html")
        if not os.path.exists(path):
            content = s.get("content") or s.get("text", "")
            preset = s.get("preset") if s.get("preset") not in (None, "none") else "bigword"
            ctx = {"dur": d, "preset": preset, "content": content, "accent": ACCENT, "bg": E.get("fmBackground", "#141110")}
            open(path, "w", encoding="utf-8").write(f'''<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"></head><body>
<template id="{fid}-template">
  <div id="{fid}-root" data-composition-id="{fid}" data-width="1080" data-height="1920" style="position:absolute;inset:0;overflow:hidden;background:{ctx["bg"]}">
    <div class="fm-dots" style="position:absolute;inset:-60px;background-image:radial-gradient(circle, rgba(255,255,255,.08) 2px, transparent 2.6px);background-size:44px 44px"></div>
  </div>
  <script>
    (function () {{
      /* AUTO-GENERATED FALLBACK for segment {sid}. Claude replaces this file with a custom scene. */
      const ctx = {json.dumps(ctx)};
      const root = document.querySelector('[data-composition-id="{fid}"]');
      const tl = gsap.timeline({{ paused: true }});
      tl.fromTo(root.querySelector(".fm-dots"), {{ y: 0 }}, {{ y: -88, duration: ctx.dur, ease: "none" }}, 0);
      const o = [{{ preset: ctx.preset, content: ctx.content, start: 0, duration: ctx.dur, y: -0.12, accent: ctx.accent }}];
      RSMotion.ready(o).then(() => {{ RSMotion.layer(root, tl, o, {{ total: ctx.dur }}); tl.set({{}}, {{}}, ctx.dur); window.__timelines["{fid}"] = tl; }});
    }})();
  </script>
</template>
</body></html>
''')
        track += 1
        fm_comps.append(f'<div id="{fid}" class="fm" data-composition-id="{fid}" data-composition-src="compositions/{fid}.html" data-start="{a}" data-duration="{d}" data-track-index="{track}" data-width="1080" data-height="1920"></div>')
    if s.get("zoom") and lay in ("overlay", "broll", "fullmotion") and d > 1.0:
        zin = r3(s.get("at", a))
        hold = max(0.3, min(2.2, b - zin - 0.8))
        tl.append(f'tl.fromTo(["#fw", "#mw"], {{scale: 1}}, {{scale: 1.12, duration: 0.35, ease: "power2.out", immediateRender: false}}, {zin});')
        tl.append(f'tl.to(["#fw", "#mw"], {{scale: 1, duration: 0.4, ease: "power2.inOut"}}, {r3(zin + 0.35 + hold)});')

# mattes for "text behind you"
mattes = []
for s in SEGS:
    m = os.path.join("assets", "matte", f"{s['id']}.webm")
    if s.get("behind") and os.path.exists(os.path.join(R, m)):
        track += 1
        mattes.append(f'<video id="m-{s["id"]}" class="matte" src="{m}" muted playsinline data-start="{r3(s["start"])}" data-duration="{r3(s["end"] - s["start"])}" data-track-index="{track}"></video>')

# sound effects
sfx = []
for s in SEGS:
    name = s.get("sfx") or "none"
    f = SFX_FILES.get(name)
    if not f:
        continue
    p = os.path.join("assets", "sfx", f + ".mp3")
    if not os.path.exists(os.path.join(R, p)):
        continue
    t = r3(max(0.02, s.get("at", s["start"]) - 0.06))
    track += 1
    sfx.append(f'<audio id="sfx-{s["id"]}" src="{p}" data-start="{t}" data-duration="{r3(dur(os.path.join(R, p)) or 1)}" data-volume="0.32" data-track-index="{track}"></audio>')

mix = "assets/audio/mix.wav"
foot = "assets/footage/main.mp4"
doc = f'''<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=1080, height=1920">
  <script src="assets/gsap.min.js"></script>
  <script src="assets/rs-motion.js"></script>
  <style>
    * {{ margin: 0; padding: 0; box-sizing: border-box; }}
    html, body {{ width: 1080px; height: 1920px; overflow: hidden; background: #000; }}
    #main {{ position: relative; width: 1080px; height: 1920px; overflow: hidden; background: #000; }}
    #fw, #mw {{ position: absolute; left: 0; top: 0; width: 1080px; height: 1920px; overflow: hidden; transform-origin: 50% 38%; }}
    #fw video, #mw video {{ position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: 50% 40%; }}
    #mw {{ z-index: 3; pointer-events: none; }}
    .broll {{ position: absolute; left: 0; width: 1080px; overflow: hidden; z-index: 5; opacity: 0; visibility: hidden; background: #000; }}
    .broll > * {{ transform-origin: 50% 50%; }}
    #splitline {{ position: absolute; left: 0; right: 0; top: 957px; height: 6px; background: {ACCENT}; z-index: 5; opacity: 0; visibility: hidden; }}
    .fm {{ z-index: 7; }}
  </style>
</head>
<body>
  <div id="main" data-composition-id="main" data-start="0" data-duration="{TOTAL}" data-width="1080" data-height="1920">
    <div id="fw"><video id="foot" src="{foot}" muted playsinline data-start="0" data-duration="{TOTAL}" data-track-index="1"></video></div>
    <div id="behind" style="position:absolute;inset:0;z-index:2"></div>
    <div id="mw">{"".join(mattes)}</div>
    <div id="front" style="position:absolute;inset:0;z-index:6"></div>
    {"".join(media)}
    <div id="splitline"></div>
    {"".join(fm_comps)}
    <div id="caps" style="position:absolute;inset:0;z-index:9"></div>
    <audio id="mix" src="{mix}" data-start="0" data-duration="{TOTAL}" data-volume="1" data-track-index="2"></audio>
    {"".join(sfx)}
  </div>
  <script>
    (function () {{
      const front = {json.dumps(front)};
      const behind = {json.dumps(behind)};
      const caps = RSMotion.captions({json.dumps(cap_words)}, {{ style: {json.dumps(E.get("captionStyle", "box"))}, y: {CAP_Y}, fontSize: {float(E.get("captionSize", 4.2))}, accent: {json.dumps(ACCENT)} }});
      const tl = gsap.timeline({{ paused: true }});
      RSMotion.ready(front.concat(behind)).then(() => {{
        RSMotion.layer(document.getElementById("behind"), tl, behind, {{ total: {TOTAL} }});
        RSMotion.layer(document.getElementById("front"), tl, front, {{ total: {TOTAL} }});
        RSMotion.layer(document.getElementById("caps"), tl, caps, {{ total: {TOTAL} }});
        {chr(10).join("        " + x for x in tl).strip()}
        tl.set({{}}, {{}}, {TOTAL});
        window.__timelines["main"] = tl;
      }});
    }})();
  </script>
</body>
</html>
'''
open(os.path.join(R, "index.html"), "w", encoding="utf-8").write(doc)
lay = {k: sum(1 for s in SEGS if s.get("layout") == k) for k in ("overlay", "split", "broll", "fullmotion")}
print(f"built index.html: {TOTAL}s, {len(SEGS)} segments {lay}, {len(front) + len(behind)} overlays, {len(cap_words)} caption words, {len(sfx)} sfx")
