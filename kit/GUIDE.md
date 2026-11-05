# Reel Studio scene guide

A reel is a list of scenes. `reel.json` says where each scene starts (a word index in `assets/vo/words.json`);
`assets/scenes.js` says what each scene shows. `python tools/build.py` turns both into `index.html` + `compositions/`.

## reel.json
```json
{
  "scenes": [{"id": "hook", "from": 0}, {"id": "leak", "from": 8}, {"id": "fix", "from": 21}, {"id": "cta", "from": 34}],
  "captions": ["Most people *lose*", "money *here.*"],
  "sfx": [{"word": 12, "name": "ding", "vol": 0.25}, {"scene": "fix", "t": 0.4, "name": "pop1"}],
  "cut_whoosh": true,
  "clips": []
}
```
- `from` = global index of the scene's first word. Scenes cut on sentence boundaries.
- `captions` cover the words from the 2nd scene's first word up to (not including) the last scene's first word, in order, spelled like `words.json` (punctuation may differ). `*word*` = highlighted. `"auto"` = automatic chunks.
- The build stops with a clear message if captions don't match the voice. Read it and fix.

## scenes.js
```js
RS.scene("hook", (s) => {
  // s.w(i)  = time of this scene's i-th word (seconds, scene-local). s.t("money") = time of a word by text.
  const h = s.headline("Your bank *quietly* takes *RM40* a month", { y: 330 });
  const card = s.card({ x: 140, y: 820, w: 800, title: "Account fees", body: "RM 3.50 · RM 12 · RM 25" });
  s.enter(card, s.t("takes"), "pop");
  s.idle(card, { amp: 8 });
});

RS.scene("leak", (s) => {
  const jar = s.el(`<svg width="420" height="520" viewBox="0 0 420 520">
      <rect x="40" y="60" width="340" height="440" rx="60" fill="none" stroke="var(--rs-ink)" stroke-width="12"/>
      <rect id="lv" x="52" y="140" width="316" height="348" rx="48" fill="var(--rs-accent)"/></svg>`, { x: 330, y: 300 });
  s.enter(jar, 0.1, "up");
  s.tl.fromTo(jar.querySelector("#lv"), { scaleY: 1, transformOrigin: "50% 100%" }, { scaleY: 0.35, duration: 2, ease: "power1.in" }, s.t("leaks"));
  const n = s.stat({ x: 140, y: 880, w: 800, from: 1200, to: 480, at: s.t("leaks"), prefix: "RM ", label: "left after a year" });
  s.enter(n, s.t("leaks") - 0.2, "up");
});

RS.scene("fix", (s) => {
  s.checklist(["Switch to a free account", "Turn off SMS alerts", "Use DuitNow, not IBG"], [s.w(2), s.t("SMS"), s.t("DuitNow")], { x: 110, y: 380, w: 860 });
  const t = s.term({ x: 70, y: 860, title: "savings.js" });
  s.enter(t.box, s.w(0), "up");
  s.type(t.body, s.w(3), "fees: RM480 → RM0", 18);
});

RS.scene("cta", (s) => {
  s.headline("Comment *SAVE* for the list", { y: 520 });
  const c = s.chip("💬  SAVE", { x: 380, y: 900 });
  s.enter(c, s.t("SAVE"), "pop");
  s.punch(c, s.t("list"));
});
```

## The `s` toolkit
| Helper | What it does |
|---|---|
| `s.root`, `s.tl`, `s.dur`, `s.words` | scene element, its paused GSAP timeline, length, words |
| `s.w(i)`, `s.t("word", shift)`, `s.find("word", from)` | word times / indexes |
| `s.el(html or tag, {x, y, w, h, z, cls, css, center, parent})` | add an element (absolute when x/y given; `center` spans x 70–1010) |
| `s.enter(el, at, kind, {d, stagger})` | entrance: `up down left right pop drop fade zoom wipe rise spin` |
| `s.leave(el, at, kind)` | exit: `up down left right pop fade shrink` |
| `s.show / s.hide / s.swap(a, b, at)` | instant visibility changes (seek-safe) |
| `s.punch(el, at)`, `s.shake(el, at)`, `s.push(el, at, scale, d)` | emphasis, error shake, slow camera push |
| `s.idle(el or [els], {amp, period, rot})` | gentle idle bob for the whole scene |
| `s.path(el, at, [[x,y],...], d)` | move through points |
| `s.headline(text, {y, size, from, cls})` | big headline revealed word by word on the voice; `*word*` = accent |
| `s.count(el, at, from, to, d, {prefix, suffix, dec, sep})` | number counter |
| `s.type(el, at, text, cps)` | typewriter with caret |
| `s.strike(el, at)`, `s.mark(el, at)` | strike-through / marker highlight |
| `s.draw(path or [paths], at, d)` | draw SVG strokes on |
| `s.card({x,y,w,h,title,body,icon})`, `s.chip(text, {...})`, `s.stat({...})` | ready-made pieces in the theme |
| `s.term({x,y,title})` → `{box, body}` | terminal window |
| `s.checklist(items, ats, {...})`, `s.bars(data, at, {...})`, `s.progress({at, d, pct, ...})` | lists, bar charts, progress bars |
| `s.phone({x,y,html})` → `{box, screen}`, `s.chat(msgs, {...})` | phone frame, chat bubbles |
| `s.arrow(x1, y1, x2, y2, at, {bend})`, `s.burst(x, y, at, {n, r})` | drawn arrow, particle burst |
| `s.presenter({x, y, shirt, hair, skin})` → el with `.parts` | flat cartoon presenter (head, eyes, mouth, arm, wave) |

Plain GSAP on `s.tl` works too (`s.tl.fromTo(el, {...}, {...}, at)`). Theme CSS variables: `--rs-bg --rs-ink --rs-muted --rs-accent --rs-accent-ink --rs-accent2 --rs-card --rs-line`.
Extra component classes: `bp-*` (blueprint.css), `po-*` (poster.css), `ne-*` (neon.css).
