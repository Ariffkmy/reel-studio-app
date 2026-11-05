"""Whisper word timings for a talking video, KEEPING filler sounds (uhm, mmm, aaa) so they can be cut.
usage: whisper-words.py in.wav out.json [language] [model]
  language: en | ms | auto (mixed Malay/English)        model: medium (default) | small | large-v3
Output: [[word, start, end, probability], ...]"""
import json, sys, subprocess, shutil
import numpy as np
from faster_whisper import WhisperModel

FF = shutil.which("ffmpeg") or "ffmpeg"
src, dst = sys.argv[1], sys.argv[2]
lang = sys.argv[3] if len(sys.argv) > 3 else "en"
size = sys.argv[4] if len(sys.argv) > 4 else "medium"
x = np.frombuffer(subprocess.run([FF, "-v", "error", "-i", src, "-ac", "1", "-ar", "16000", "-f", "f32le", "-"],
                                 capture_output=True, check=True).stdout, dtype=np.float32)
# A disfluent prompt makes Whisper write the fillers instead of silently dropping them.
PROMPTS = {
    "en": "Umm, so, uh, I was like, hmm... okay. Mm, let me, uh, let me think.",
    "ms": "Emm, aaa, so macam ni, kan... err, okay. Hmm, jadi, eh, apa nama...",
    "auto": "Umm, so, aaa, macam ni kan... uh, okay. Emm, let me, err, jadi...",
}
name = f"{size}.en" if lang == "en" and not size.startswith("large") else size
print(f"loading whisper {name} (first run downloads the model)...", flush=True)
m = WhisperModel(name, device="cpu", compute_type="int8")
kw = dict(word_timestamps=True, beam_size=5, initial_prompt=PROMPTS.get(lang, PROMPTS["auto"]), condition_on_previous_text=False, vad_filter=False)
if lang not in ("en", "auto"):
    kw["language"] = lang
segs, info = m.transcribe(x, **kw)
out = []
for s in segs:
    for w in s.words:
        t = w.word.strip()
        if t:
            out.append([t, round(w.start, 3), round(w.end, 3), round(float(w.probability or 0), 3)])
    print(f"  {s.end:6.1f}s  {s.text.strip()}", flush=True)
json.dump(out, open(dst, "w", encoding="utf-8"), indent=0, ensure_ascii=False)
print(len(out), "words, detected language", getattr(info, "language", "?"), flush=True)
