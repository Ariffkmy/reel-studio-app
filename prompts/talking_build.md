The edit is APPROVED and the app has prepared everything: `edit.json`, the cut + graded footage, the voice/music mix, the B-roll, the speaker cut-outs and a first `index.html` (built by `tools/build_talking.py`). Finish the reel now, without asking anything.

Segments that need a full-motion scene: {{fm_list}}

## Do this, in order
1. Read `edit.json` and `index.html` (skim) so you know the timeline.
2. **Full-motion scenes.** For each segment above, replace `compositions/fm-<id>.html` with a real animated scene following the contract in CLAUDE.md: it SHOWS the segment's idea (its `brief`, `content` and the words spoken in it), timed to those words (local time = word start − segment start), full-screen 1080×1920, safe area respected, accent {{accent}}, constant motion, entrances on spoken words. Match a cohesive look across scenes (dark warm background or light paper, the motion fonts).
3. **Tune overlays if needed.** You may edit `edit.json` segment fields (`content`, `preset`, `y`, `fontSize`, `at`, `zoom`, `sfx`) to fix collisions or weak choices. Don't change `start`/`end`/`total`/`words`/`broll` and don't add segments.
4. Run `{{python}} tools/build_talking.py`, then `npx hyperframes@{{hf}} lint` until 0 errors.
5. **Look at it.** Run `npx hyperframes@{{hf}} snapshot --at <one time inside every segment>` and Read every PNG in `snapshots/` (and `snapshots/contact-sheet.jpg`). Check: the face is never covered by graphics, text inside the safe area, captions readable and not colliding with overlays, B-roll fills the frame, full-motion scenes look finished (not blank, not the fallback), split screens look balanced. Fix, rebuild, re-snapshot. Up to 3 rounds.
6. Don't render; the app renders next. End with a 3–6 line summary.
