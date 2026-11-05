"""Beat map of a music track (numpy only): tempo, beats, downbeats and the biggest hits.
usage: beats.py music.wav out.json
Times are seconds from the start of the track (the same clock as words.json when the music starts with the voice).
Idea from cth9191/animate tools/beats.mjs: cut on the song's beats and land the payoff on its biggest hit."""
import json, sys, subprocess, shutil
import numpy as np

FF = shutil.which("ffmpeg") or "ffmpeg"
SR, HOP, NFFT = 22050, 512, 2048
x = np.frombuffer(subprocess.run([FF, "-v", "error", "-i", sys.argv[1], "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"],
                                 capture_output=True, check=True).stdout, dtype=np.float32)
if len(x) < SR * 3:
    json.dump({"bpm": 0, "beats": [], "downbeats": [], "hits": []}, open(sys.argv[2], "w")); sys.exit(0)
fps = SR / HOP
# onset envelope = positive spectral flux on a log-magnitude spectrogram
win = np.hanning(NFFT).astype(np.float32)
n = 1 + (len(x) - NFFT) // HOP
frames = np.lib.stride_tricks.as_strided(x, shape=(n, NFFT), strides=(x.strides[0] * HOP, x.strides[0]))
mag = np.log1p(np.abs(np.fft.rfft(frames * win, axis=1)) * 10)
flux = np.maximum(0, np.diff(mag, axis=0)).sum(axis=1)
env = np.concatenate([[0], flux])
env = (env - env.mean()) / (env.std() + 1e-9)
env = np.convolve(env, np.ones(3) / 3, mode="same")
# tempo: autocorrelation over 60-180 BPM, weighted toward ~115 BPM
ac = np.correlate(env, env, mode="full")[len(env) - 1:]
lags = np.arange(len(ac))
bpm_of = lambda lag: 60 * fps / np.maximum(lag, 1)
lo, hi = int(60 * fps / 180), int(60 * fps / 60)
cand = np.arange(lo, min(hi, len(ac) - 1))
weight = np.exp(-0.5 * (np.log2(bpm_of(cand) / 115) / 0.9) ** 2)
lag = int(cand[np.argmax(ac[cand] * weight)])
# parabolic interpolation around the peak for a sub-frame period
y0, y1, y2 = ac[lag - 1], ac[lag], ac[lag + 1]
den = y0 - 2 * y1 + y2
flag = lag + (0.5 * (y0 - y2) / den if den != 0 else 0)
bpm = float(60 * fps / flag)
# beat phase: the offset whose comb of beats collects the most onset energy
period = 60 * fps / bpm
offs = np.arange(0, int(period))
score = [env[np.arange(o, len(env), period).astype(int)].sum() for o in offs]
o = offs[int(np.argmax(score))]
beats_f = np.arange(o, len(env), period)
# nudge each beat to the strongest onset within ±8% of a period
w = max(1, int(period * 0.08))
refined = []
for b in beats_f.astype(int):
    a, z = max(0, b - w), min(len(env), b + w + 1)
    refined.append(a + int(np.argmax(env[a:z])))
beats = [round(b / fps, 3) for b in refined]
# downbeats: the phase (of 4) with the most energy
phase = int(np.argmax([sum(env[refined[i]] for i in range(k, len(refined), 4)) for k in range(4)])) if len(refined) >= 8 else 0
downbeats = beats[phase::4]
# hits: loudest 0.5 s windows, at least 3 s apart, snapped to the nearest beat
rms_hop = int(SR * 0.25)
rms = np.array([np.sqrt(np.mean(x[i:i + rms_hop * 2] ** 2)) for i in range(0, len(x) - rms_hop * 2, rms_hop)])
order = np.argsort(rms)[::-1]
hits = []
for i in order:
    t = i * 0.25 + 0.25
    if all(abs(t - h) >= 3 for h in hits):
        hits.append(t)
    if len(hits) >= 5:
        break
snap = lambda t: min(beats, key=lambda b: abs(b - t)) if beats else t
hits = sorted({round(float(snap(t)), 3) for t in hits})
out = {"bpm": round(bpm, 1), "beats": beats, "downbeats": downbeats, "hits": hits, "duration": round(len(x) / SR, 2)}
json.dump(out, open(sys.argv[2], "w"), indent=0)
print(f"{out['bpm']} BPM, {len(beats)} beats, {len(downbeats)} downbeats, hits at {hits}")
