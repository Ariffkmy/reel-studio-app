"""Synthesize Reel Studio's own sound-effect set (no samples, no third-party audio).
usage: python dev/make_sfx.py <out_dir>    -> <out_dir>/<name>.mp3 for every name in SFX
Every sound is generated from noise, sines and envelopes, so the set can ship with the app."""
import os, sys, subprocess, shutil, wave
import numpy as np

SR = 48000
rng = np.random.default_rng(20261105)


def t(d):
    return np.arange(int(SR * d)) / SR


def env(n, a=0.002, r=0.1, curve=4.0):
    """attack (s) then exponential-ish release (s); length n samples"""
    x = np.arange(n) / SR
    att = np.clip(x / max(a, 1e-4), 0, 1)
    rel = np.exp(-curve * np.clip(x - a, 0, None) / max(r, 1e-4))
    return att * rel


def lp(x, cut):
    """one-pole low-pass; cut may be an array (sweep)"""
    cut = np.broadcast_to(np.asarray(cut, dtype=float), x.shape)
    a = 1 - np.exp(-2 * np.pi * cut / SR)
    y = np.empty_like(x); s = 0.0
    for i in range(len(x)):
        s += a[i] * (x[i] - s); y[i] = s
    return y


def hp(x, cut):
    return x - lp(x, cut)


def bp(x, f, q=4.0):
    """two-pole resonant band-pass (state variable filter); f may sweep"""
    f = np.broadcast_to(np.asarray(f, dtype=float), x.shape)
    y = np.empty_like(x); low = band = 0.0
    damp = 1.0 / q
    for i in range(len(x)):
        k = 2 * np.sin(np.pi * min(f[i], SR / 6) / SR)
        low += k * band
        high = x[i] - low - damp * band
        band += k * high
        y[i] = band
    return y


def noise(d):
    return rng.standard_normal(int(SR * d))


def sine(f, d, ph=0.0):
    f = np.broadcast_to(np.asarray(f, dtype=float), t(d).shape)
    return np.sin(2 * np.pi * np.cumsum(f) / SR + ph)


def norm(x, peak=0.8):
    m = np.max(np.abs(x)) or 1
    return x / m * peak


def pad(x, d):
    n = int(SR * d)
    return np.concatenate([x, np.zeros(max(0, n - len(x)))])[: max(n, len(x))]


def mix(*parts):
    n = max(len(p) for p in parts)
    return sum(np.pad(p, (0, n - len(p))) for p in parts)


def at(x, sec, total):
    out = np.zeros(int(SR * total)); i = int(SR * sec)
    out[i:i + len(x)] += x[: len(out) - i]
    return out


# ---------------------------------------------------------------- recipes
def click(f=3200, d=0.05, body=900):
    n = noise(d) * env(int(SR * d), 0.0005, 0.008, 5)
    tick = bp(n, f, 6)
    thump = sine(body, d) * env(int(SR * d), 0.0005, 0.012, 5) * 0.5
    return norm(mix(tick, thump), 0.75)


def pop(f0=900, f1=260, d=0.12):
    s = sine(np.linspace(f0, f1, int(SR * d)), d) * env(int(SR * d), 0.001, 0.05, 4)
    air = bp(noise(d), 2400, 3) * env(int(SR * d), 0.0005, 0.01, 6) * 0.25
    return norm(mix(s, air), 0.8)


def whoosh(d=0.6, f0=300, f1=3500, peak=0.55):
    n = int(SR * d); x = np.arange(n) / n
    shape = np.sin(np.pi * np.clip(x / peak, 0, 1) * 0.5) ** 2 * np.where(x < peak, 1, np.exp(-6 * (x - peak) / (1 - peak)))
    sweep = np.where(x < peak, f0 + (f1 - f0) * (x / peak) ** 1.5, f1 - (f1 - f0) * 0.6 * (x - peak) / (1 - peak))
    w = bp(noise(d), sweep, 1.6) * shape
    return norm(w, 0.7)


def swish(d=0.28, f0=1200, f1=6000):
    n = int(SR * d); x = np.arange(n) / n
    shape = np.sin(np.pi * x) ** 3
    w = bp(noise(d), f0 + (f1 - f0) * x, 2.2) * shape
    return norm(w, 0.6)


def ding(f=1318.5, d=1.2, partials=((1, 1), (2.76, .35), (5.4, .12), (2, .2))):
    n = int(SR * d)
    s = sum(a * sine(f * k, d) * env(n, 0.002, d / (1 + k * 0.8), 4) for k, a in partials)
    return norm(s, 0.7)


def thud(d=0.45):
    n = int(SR * d)
    body = sine(np.linspace(120, 45, n), d) * env(n, 0.002, 0.18, 4)
    knock = lp(noise(d), 600) * env(n, 0.0005, 0.03, 6) * 2
    return norm(mix(body, knock), 0.85)


def typing(keys=7, gap=0.085, d=0.75, seed=0):
    r = np.random.default_rng(seed)
    out = np.zeros(int(SR * d)); tt = 0.02
    for _ in range(keys):
        k = click(r.uniform(2400, 4200), 0.04, r.uniform(500, 900)) * r.uniform(0.5, 1)
        out = out + at(k, tt, d); tt += gap * r.uniform(0.6, 1.4)
        if tt > d - 0.05: break
    return norm(out, 0.7)


def sparkle(d=0.9):
    out = np.zeros(int(SR * d)); r = np.random.default_rng(3)
    for i in range(9):
        f = 2000 * 2 ** (r.integers(0, 12) / 12) * (1 + i * 0.05)
        out = out + at(ding(f, 0.35, ((1, 1), (2.01, .3))) * (0.9 - i * 0.07), 0.02 + i * 0.07, d)
    return norm(hp(out, 900), 0.6)


def success(d=1.0):
    notes = [(0.0, 783.99), (0.11, 987.77), (0.22, 1174.66), (0.34, 1567.98)]
    out = np.zeros(int(SR * d))
    for s0, f in notes:
        out = out + at(ding(f, 0.6, ((1, 1), (2, .25), (3, .08))), s0, d)
    return norm(out, 0.7)


def paper(d=0.4, f=1800, grit=0.6, seed=1):
    r = np.random.default_rng(seed); n = int(SR * d)
    crack = (r.random(n) < 0.02) * r.standard_normal(n) * 3
    x = bp(noise(d) + crack * grit, f, 1.4) * env(n, 0.01, d * 0.5, 3)
    return norm(x, 0.65)


def pageflip(d=0.5):
    n = int(SR * d); x = np.arange(n) / n
    w = bp(noise(d), 1200 + 2500 * x, 1.5) * np.sin(np.pi * x) ** 2
    snap = at(paper(0.08, 3000, 1.2, 7), d * 0.6, d)
    return norm(mix(w, snap * 0.6), 0.65)


def pencil(d=0.6):
    n = int(SR * d)
    g = (rng.random(n) < 0.08) * rng.standard_normal(n)
    x = bp(g + noise(d) * 0.15, 4200, 2.5) * (0.6 + 0.4 * np.sin(2 * np.pi * 9 * t(d))) * env(n, 0.02, 0.5, 2)
    return norm(x, 0.5)


def shutter(d=0.25):
    a = click(5200, 0.04, 400); b = click(3800, 0.05, 300)
    return norm(mix(a, at(b, 0.07, d)), 0.8)


def clockfast(d=1.2, rate=12):
    out = np.zeros(int(SR * d))
    for i in range(int(d * rate)):
        out = out + at(click(2600 if i % 2 else 3400, 0.03, 700) * 0.7, i / rate, d)
    return norm(out, 0.6)


def stickynote(d=0.35):
    peel = bp(noise(0.18), np.linspace(900, 2600, int(SR * 0.18)), 2) * env(int(SR * 0.18), 0.04, 0.1, 3)
    tap = click(1500, 0.05, 300)
    return norm(mix(peel, at(tap, 0.2, d)), 0.65)


def markertick(d=0.3):
    s1 = bp(noise(0.08), 2800, 3) * env(int(SR * 0.08), 0.004, 0.05, 3)
    s2 = bp(noise(0.14), np.linspace(2600, 3600, int(SR * 0.14)), 3) * env(int(SR * 0.14), 0.004, 0.09, 3)
    return norm(mix(s1, at(s2, 0.1, d)), 0.6)


SFX = {
    "click1": lambda: click(3000), "click2": lambda: click(3600, 0.05, 700), "click3": lambda: click(2400, 0.06, 1100),
    "click4": lambda: click(4200, 0.04, 600), "click5": lambda: click(2000, 0.06, 500), "click6": lambda: click(5000, 0.035, 900),
    "pop1": lambda: pop(1100, 300), "pop2": lambda: pop(800, 240, 0.1), "pop3": lambda: pop(1400, 420, 0.09),
    "whoosh": lambda: whoosh(0.7), "whoosh_short": lambda: whoosh(0.35, 500, 4000, 0.5), "whoosh_big": lambda: whoosh(1.3, 120, 2800, 0.6),
    "swish1": lambda: swish(), "swish2": lambda: swish(0.22, 1800, 7000), "swish3": lambda: swish(0.36, 900, 5200),
    "ding": lambda: ding(), "success": lambda: success(), "sparkle": lambda: sparkle(), "thud": lambda: thud(),
    "typing1": lambda: typing(6, 0.09, 0.7, 1), "typing2": lambda: typing(8, 0.075, 0.75, 2),
    "typing3": lambda: typing(5, 0.11, 0.7, 3), "typing4": lambda: typing(10, 0.065, 0.8, 4),
    "pageflip": lambda: pageflip(), "paperdrop": lambda: mix(paper(0.3, 1400, 0.8, 4), at(thud() * 0.25, 0.05, 0.45)),
    "paperfold": lambda: paper(0.45, 2200, 1.0, 5), "papersnap": lambda: paper(0.15, 3200, 1.6, 6),
    "pencil": lambda: pencil(), "shutter": lambda: shutter(), "clockfast": lambda: clockfast(),
    "stickynote": lambda: stickynote(), "markertick": lambda: markertick(),
}


def write(name, x, out_dir):
    x = np.clip(x, -1, 1)
    fade = min(len(x), int(SR * 0.004))
    x[-fade:] *= np.linspace(1, 0, fade)
    wav = os.path.join(out_dir, name + ".wav")
    with wave.open(wav, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((x * 32767).astype("<i2").tobytes())
    ff = shutil.which("ffmpeg") or "ffmpeg"
    subprocess.run([ff, "-v", "error", "-y", "-i", wav, "-ac", "2", "-b:a", "160k", os.path.join(out_dir, name + ".mp3")], check=True)
    os.remove(wav)


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "sfx"
    os.makedirs(out, exist_ok=True)
    for k, f in SFX.items():
        write(k, f(), out); print("  ", k)
    print(len(SFX), "sounds ->", out)
