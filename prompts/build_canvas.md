The plan below is APPROVED. Build the whole reel in the {{style_name}} canvas style now, without asking anything.

The voice is at `assets/vo/voice.mp3`; Whisper word timings are in `assets/vo/words.json` ({{word_count}} words, {{voice_seconds}} s). The build exposes them to the piece as `VO.words` / `wt(i)` / `we(i)` (already offset onto the timeline).
{{assets_note}}

## Approved plan
{{plan_md}}

## Do this, in order
1. Read `animate/styles/{{canvas_style}}/STYLE.md` (and look at its `sample.png`), `animate/grammar/FRAME.md`, `animate/grammar/STORY.md`, `animate/craft.md`, and the starter piece in `piece/` (the style's demo) with the kit files it calls.
2. Fix Whisper spellings in `assets/vo/words.json` (word text only, never the times).
3. Rewrite `piece/head.js`, `piece/scenes.js`, `piece/bridges.js` for THIS plan: one era per plan row or idea (merge short rows), cut on sentence boundaries with `wt()`, every entrance on a spoken word, one hero carried through, the style's medium visible in every frame, a callback ending. Use shape-morph bridges where one idea becomes the next (≤ 3 in a reel under 40 s), hard cuts elsewhere. Write `piece/sfx.json` (soft, on key words) and `piece/piece.json` (captions style {{caption_style_id}}, keep in-world text above y 1250).
4. Run `{{python}} tools/build_canvas.py` until it builds with no syntax error, then `npx hyperframes@{{hf}} lint` (0 errors).
5. Look: `npx hyperframes@{{hf}} snapshot --at <1–2 times inside every era>` and Read every PNG in `snapshots/` (and `contact-sheet.jpg`). Check against the style's checklist and FRAME.md: the medium shows, the hero is there, nothing important outside x 60–1010 / y 230–1500, in-world text not under the captions, every era looks different and alive. Fix, rebuild, re-snapshot (up to 3 rounds).
6. Don't render; the app renders next. End with a 3–6 line summary.
