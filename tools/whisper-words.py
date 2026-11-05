"""Reel Studio: word-level timings for a voiceover with faster-whisper.
usage: whisper-words.py <audio> <out.json> [language=en] [model=medium]
writes [[word, start, end], ...]; English uses the smaller-and-faster <model>.en weights."""
import json
import shutil
import subprocess
import sys

import numpy as np
from faster_whisper import WhisperModel


def pcm16k(path):
    ff = shutil.which("ffmpeg") or "ffmpeg"
    raw = subprocess.run([ff, "-v", "error", "-i", path, "-ac", "1", "-ar", "16000", "-f", "f32le", "-"],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32)


def main():
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    audio, out_path = sys.argv[1], sys.argv[2]
    lang = sys.argv[3] if len(sys.argv) > 3 else "en"
    model = sys.argv[4] if len(sys.argv) > 4 else "medium"
    weights = model + ".en" if lang == "en" and not model.startswith("large") else model
    print(f"Whisper {weights}: loading (the first run downloads the model)", flush=True)
    asr = WhisperModel(weights, device="cpu", compute_type="int8")
    opts = {"word_timestamps": True, "beam_size": 5}
    if lang != "en":
        opts["language"] = lang
    segments, _info = asr.transcribe(pcm16k(audio), **opts)
    words = []
    for seg in segments:
        print(f"  {seg.end:7.2f}s  {seg.text.strip()}", flush=True)
        words += [[w.word.strip(), round(w.start, 3), round(w.end, 3)] for w in seg.words if w.word.strip()]
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(words, f, ensure_ascii=False, indent=0)
    print(f"{len(words)} words, voice ends at {words[-1][2] if words else 0}s", flush=True)


if __name__ == "__main__":
    main()
