Plan a {{length}}-second vertical reel about: {{topic}}

Style: {{style_name}}. {{style_brief}}
Style starter idea (adapt it to the topic): {{style_prompt}}
Language: {{language_label}}. {{language_rules}}
Call to action: {{cta_line}}
Extra notes from the user: {{notes}}

Write the plan:
- **hook**: the opening. `spoken` is the first sentence the viewer hears, `text` is the headline on screen (use the same words as `spoken`, shortened if needed but never reworded), `visual` is what is on screen in the first second. A good hook is a surprising fact, a direct question, or a promise of a quick win.
- **rows**: one row per spoken sentence, in order. Row 1 is the hook sentence; the last row is the call to action.
  - `spoken`: the sentence, written the way it is said (numbers in words where a voice would say them).
  - `text`: the 1–4 key words of that sentence that matter on screen (taken from the sentence).
  - `visual`: a concrete picture to animate in HTML/SVG in this style (objects, cards, numbers, a character, a diagram) and what moves on which word.
- About {{words_target}} spoken words in total so it lands near {{length}} seconds. Short sentences.
- Keep one recurring element (a character, an object or a place) through the reel, and let the final visual echo the first one.
- Facts and numbers must be accurate; don't invent statistics.

Don't build anything and don't edit files.
Reply with ONLY one JSON object (no markdown fences) in exactly this shape:
{
  "title": "short reel title",
  "hook": { "text": "...", "spoken": "...", "visual": "..." },
  "rows": [ { "spoken": "...", "text": "...", "visual": "..." } ],
  "voice_script": "all rows' spoken sentences in order, as one script",
  "notes": "one or two lines on pacing, colour or motion"
}
