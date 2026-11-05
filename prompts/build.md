The plan below is approved. Build the whole reel now without asking anything.

The voiceover is ready: `assets/vo/voice.mp3`, word timings in `assets/vo/words.json` ({{word_count}} words, {{voice_seconds}} s).

## Approved plan
{{plan_md}}

## Steps
1. **Read `GUIDE.md`** (the scene helpers and an example).
2. **Check the words.** Compare `assets/vo/words.json` with the plan. Fix spellings only (numbers like "11" + ",000" → "11,000", brand names, Malay spellings) by editing the word text; never change times or merge/split entries. If the voice says something different from the plan, the voice wins.
3. **Write `reel.json`:**
   - `scenes`: one scene per plan row (merge rows shorter than ~2 s), `{"id": "short-lowercase", "from": <global word index of the scene's first word>}`. The first scene starts at 0.
   - `captions`: chunks of 2–4 words covering every word from the 2nd scene's first word up to (not including) the last scene's first word, spelled exactly like `words.json`; wrap 1–2 key words per chunk in `*stars*`. Or use `"auto"`.
   - `sfx`: a few soft cues on key words (`{"word": 23, "name": "pop1", "vol": 0.25}`). Cuts already get a soft whoosh.
4. **Write `assets/scenes.js`**: one `RS.scene("<id>", (s) => { ... })` per scene in the {{style_name}} style, every entrance on its spoken word. The hook scene shows the hook headline with `s.headline(...)` (its only text). The last scene shows the call to action. Stay inside x 70–1010, y 230–1260.
5. Run `{{build_cmd}}`, then `npx hyperframes@{{hf}} lint`. Fix until the build passes and lint has 0 errors.
6. **Look at it.** Read `layout.json` for the scene times, run `npx hyperframes@{{hf}} snapshot --at <one or two times inside every scene>` and Read every PNG in `snapshots/`. Check: inside the safe area, nothing cropped or overlapping the caption band, text readable, each scene visibly different and moving, matches the plan. Fix, rebuild, re-snapshot (up to 3 rounds).
7. Don't render. Finish with a 3–6 line summary: the scenes and anything you couldn't fix.
