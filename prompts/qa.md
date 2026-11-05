The app rendered the reel to `renders/reel.mp4` ({{duration}} s) and put {{frames}} frames from the MP4 into one tile sheet, `renders/tiles.jpg` (left to right, top to bottom, one frame every {{step}} s). Voice loudness: {{lufs}} LUFS (target about -16).

Automatic checks on the MP4 (fix every real problem they report):
{{checks}}

Read `renders/tiles.jpg`. Look for frozen stretches, blank frames, text that is cut off, outside the safe area or covered by captions, overlapping elements, or anything broken.
- If something is wrong, fix it in `assets/scenes.js` / `reel.json`, rebuild with `{{build_cmd}}` and lint (0 errors). Don't render. End with the line `RESULT: FIXED`.
- If it looks right, end with the line `RESULT: OK`.
Give a 1–3 line verdict before the RESULT line.
