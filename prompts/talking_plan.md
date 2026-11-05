Plan the edit of this talking video. Don't edit any files.

Video: {{duration}} s of the creator talking. Language: {{language_label}}.
Topic / notes from the creator: {{notes}}
Call to action: {{cta_line}}
Caption style chosen: {{caption_style}}.

## Transcript (word index, then word; a line starts at its time in seconds)
Words marked ⟨filler⟩ are already proposed for cutting by the app. Gaps over 0.45 s between words are cut automatically (keeping a short breath).
{{transcript}}

## Motion presets you can use (opencut-motion engine)
Write each preset's `content` exactly in its own line format (shown in `help`, example in `example`; lines separated with \n).
{{presets}}

## Your job
1. **Cuts.** Find retakes and false starts: when the creator repeats a sentence or restarts a phrase, cut the weaker/earlier attempt and keep the best one (usually the last complete take). Also cut stray fillers the app missed (e.g. "macam", "kan", "you know", "like" only when they are pure fillers) and any off-topic chatter at the start/end ("okay recording", "dah ke?"). Never cut words that carry meaning. If an auto ⟨filler⟩ is actually a real word in context, list its index in `keep`.
2. **Hook.** The first sentence is the hook. Make a headline for the first 2–3 s (TEXT = the creator's own first words, short: kicker `// ...`, a BIG line, optional `~accent` line), shown over the footage with the `headline` preset.
3. **Segments.** Split the KEPT speech into segments on sentence or clause boundaries (one idea each, usually 2–6 s). For every segment choose the layout (overlay | split | broll | fullmotion) and what appears, following the balanced density and the phone-screen rules in CLAUDE.md:
   - overlay/split: a preset + its content using the creator's words (numbers → `counter`, lists → `chips`/`list`, comparisons → `versus`/`strike`, key phrase → `highlight`/`bigword`/`stamp`, place → `location`, name → `lower-third`, chat/app talk → `chat`/`notification`/`terminal`, a small reaction → `lottie`). Use `"none"` when the face alone is best (then maybe `zoom: true`).
   - split / broll: `broll.query` = 2–4 concrete English search words for stock footage that literally shows what is said (e.g. "city traffic night", "woman paying groceries"), `broll.kind` = video (default) or image.
   - fullmotion: `brief` = what the animated scene shows, plus a preset + content as its fallback.
   - `at` = the word index where the overlay should enter (a key word), `zoom` = punch-in on emphasis, `behind` = true for 1–2 big single-word moments where text behind the creator looks premium (bigword/stamp/headline only, overlay layout only), `sfx` = whoosh (cutaways), pop (overlays), ding (numbers, ticks), click (buttons), thud (stamps), none.
4. **Music.** A short English search query for background music that fits the mood (e.g. "chill lofi hip hop", "upbeat corporate", "emotional piano").
5. End with a CTA segment if the creator says one ({{cta_line}}): `cta` preset or a `highlight`.

Reply with ONLY one JSON object (no markdown fences):
{
  "title": "short title",
  "hook": { "text": "// kicker\nBIG LINE\n~accent", "preset": "headline" },
  "cuts": [ { "from": 12, "to": 19, "reason": "retake" } ],
  "keep": [ ],
  "segments": [
    { "from": 0, "to": 8, "layout": "overlay", "preset": "none", "content": "", "at": 0, "zoom": false, "behind": false, "sfx": "none" },
    { "from": 9, "to": 17, "layout": "split", "preset": "counter", "content": "RM 1,200\n~sewa sebulan", "at": 14, "zoom": false, "behind": false, "sfx": "ding", "broll": { "query": "apartment rent keys", "kind": "video" } },
    { "from": 18, "to": 30, "layout": "fullmotion", "preset": "list", "content": "#3 TIPS\n...", "at": 18, "brief": "three tips appear one by one as numbered cards", "sfx": "whoosh" }
  ],
  "music": { "query": "chill lofi hip hop" },
  "notes": "one or two lines on the editing approach"
}
`from`/`to` are inclusive word indices of the ORIGINAL transcript; segments go in order and together cover every word you keep.
