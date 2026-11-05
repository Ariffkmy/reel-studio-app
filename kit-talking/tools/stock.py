"""Free stock media for Reel Studio: search + download B-roll videos, images and music.

usage:
  stock.py search --kind video|image --query "city traffic" [--n 6] [--min-dur 3]
  stock.py music  --query "upbeat lofi" [--min-dur 30] [--n 6]
  stock.py download --url URL --out FILE [--source pexels] [--ping URL]

Keys come from env vars: PEXELS_API_KEY, PIXABAY_API_KEY, UNSPLASH_ACCESS_KEY, FREESOUND_API_KEY.
Keyless sources: Wikimedia Commons, NASA, plus (if OPENMONTAGE_PATH points at a clone of
github.com/calesthio/OpenMontage) its extra adapters: Coverr, Mixkit, Archive.org, ... and its
Pixabay Music scraper. Output is JSON on stdout: a list of candidates
{source, id, kind, title, thumb, url, page, width, height, duration, author, license}.
"""
import argparse, json, os, sys, urllib.parse, urllib.request

UA = "ReelStudio/1.0 (local video tool)"
TIMEOUT = 25


def get_json(url, headers=None):
    req = urllib.request.Request(url, headers={"User-Agent": UA, **(headers or {})})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        return json.loads(r.read().decode("utf-8", "replace"))


def cand(**k):
    base = dict(source="", id="", kind="video", title="", thumb="", url="", page="", width=0, height=0, duration=0.0, author="", license="")
    base.update({a: b for a, b in k.items() if b is not None})
    return base


def warn(msg):
    print(msg, file=sys.stderr, flush=True)


# ---------------------------------------------------------------- keyed sources
def pexels(q, kind, n):
    key = os.environ.get("PEXELS_API_KEY")
    if not key:
        return []
    h = {"Authorization": key}
    qs = urllib.parse.urlencode({"query": q, "per_page": n, "orientation": "portrait"})
    out = []
    if kind == "video":
        for v in get_json(f"https://api.pexels.com/videos/search?{qs}", h).get("videos", []):
            files = [f for f in v.get("video_files", []) if f.get("link") and (f.get("file_type") or "").endswith("mp4")]
            if not files:
                continue
            # prefer ~1080 wide portrait / >=1280 tall, else biggest under 4K
            files.sort(key=lambda f: abs((f.get("height") or 0) - 1920) + (5000 if (f.get("width") or 0) > 2200 else 0))
            f = files[0]
            out.append(cand(source="pexels", id=str(v["id"]), kind="video", title=v.get("url", "").rstrip("/").split("/")[-1].replace("-", " "),
                            thumb=v.get("image"), url=f["link"], page=v.get("url"), width=f.get("width"), height=f.get("height"),
                            duration=float(v.get("duration") or 0), author=(v.get("user") or {}).get("name", ""), license="Pexels License"))
    else:
        for p in get_json(f"https://api.pexels.com/v1/search?{qs}", h).get("photos", []):
            s = p.get("src", {})
            out.append(cand(source="pexels", id=str(p["id"]), kind="image", title=p.get("alt") or q, thumb=s.get("medium"),
                            url=s.get("large2x") or s.get("original"), page=p.get("url"), width=p.get("width"), height=p.get("height"),
                            author=p.get("photographer"), license="Pexels License"))
    return out


def pixabay(q, kind, n):
    key = os.environ.get("PIXABAY_API_KEY")
    if not key:
        return []
    n = max(3, min(n, 50))
    out = []
    if kind == "video":
        qs = urllib.parse.urlencode({"key": key, "q": q, "per_page": n, "safesearch": "true"})
        for h in get_json(f"https://pixabay.com/api/videos/?{qs}").get("hits", []):
            vs = h.get("videos", {})
            f = vs.get("large") if (vs.get("large") or {}).get("url") else vs.get("medium") or {}
            if not f.get("url"):
                continue
            out.append(cand(source="pixabay", id=str(h["id"]), kind="video", title=h.get("tags", q), thumb=f.get("thumbnail") or (vs.get("tiny") or {}).get("thumbnail"),
                            url=f["url"], page=h.get("pageURL"), width=f.get("width"), height=f.get("height"),
                            duration=float(h.get("duration") or 0), author=h.get("user"), license="Pixabay Content License"))
    else:
        qs = urllib.parse.urlencode({"key": key, "q": q, "per_page": n, "image_type": "photo", "orientation": "vertical", "safesearch": "true"})
        for h in get_json(f"https://pixabay.com/api/?{qs}").get("hits", []):
            out.append(cand(source="pixabay", id=str(h["id"]), kind="image", title=h.get("tags", q), thumb=h.get("webformatURL"),
                            url=h.get("largeImageURL"), page=h.get("pageURL"), width=h.get("imageWidth"), height=h.get("imageHeight"),
                            author=h.get("user"), license="Pixabay Content License"))
    return out


def unsplash(q, kind, n):
    key = os.environ.get("UNSPLASH_ACCESS_KEY")
    if not key or kind != "image":
        return []
    qs = urllib.parse.urlencode({"query": q, "per_page": n, "orientation": "portrait", "content_filter": "high"})
    out = []
    for p in get_json(f"https://api.unsplash.com/search/photos?{qs}", {"Authorization": f"Client-ID {key}", "Accept-Version": "v1"}).get("results", []):
        u = p.get("urls", {})
        out.append(cand(source="unsplash", id=p["id"], kind="image", title=p.get("alt_description") or q, thumb=u.get("small"),
                        url=(u.get("raw") + "&w=1440&q=85&fm=jpg") if u.get("raw") else u.get("regular"), page=(p.get("links") or {}).get("html"),
                        width=p.get("width"), height=p.get("height"), author=(p.get("user") or {}).get("name"), license="Unsplash License",
                        ping=(p.get("links") or {}).get("download_location")))
    return out


# ---------------------------------------------------------------- keyless sources
def wikimedia(q, kind, n):
    ft = "video" if kind == "video" else "bitmap"
    qs = urllib.parse.urlencode({
        "action": "query", "format": "json", "generator": "search", "gsrnamespace": 6, "gsrlimit": n * 2,
        "gsrsearch": f"filetype:{ft} {q}", "prop": "imageinfo", "iiprop": "url|size|mime|extmetadata", "iiurlwidth": 480,
    })
    pages = (get_json(f"https://commons.wikimedia.org/w/api.php?{qs}").get("query") or {}).get("pages", {})
    out = []
    for p in sorted(pages.values(), key=lambda x: x.get("index", 0)):
        ii = (p.get("imageinfo") or [{}])[0]
        mime = ii.get("mime", "")
        if kind == "video" and not mime.startswith("video"):
            continue
        if kind == "image" and not mime.startswith("image"):
            continue
        meta = ii.get("extmetadata") or {}
        lic = (meta.get("LicenseShortName") or {}).get("value", "")
        if lic and not any(x in lic for x in ("CC0", "Public domain", "CC BY", "PD")):
            continue  # skip non-free / NC / ND
        artist = (meta.get("Artist") or {}).get("value", "")
        import re
        artist = re.sub(r"<[^>]+>", "", artist)[:80]
        out.append(cand(source="wikimedia", id=str(p.get("pageid")), kind=kind, title=p.get("title", "").replace("File:", ""),
                        thumb=ii.get("thumburl"), url=ii.get("url"), page=ii.get("descriptionurl"), width=ii.get("width"),
                        height=ii.get("height"), duration=float(ii.get("duration") or 0), author=artist, license=lic or "see page"))
        if len(out) >= n:
            break
    return out


def nasa(q, kind, n):
    qs = urllib.parse.urlencode({"q": q, "media_type": "video" if kind == "video" else "image", "page_size": n})
    items = (get_json(f"https://images-api.nasa.gov/search?{qs}").get("collection") or {}).get("items", [])
    out = []
    for it in items[:n]:
        d = (it.get("data") or [{}])[0]
        nid = d.get("nasa_id")
        if not nid:
            continue
        thumb = next((l.get("href") for l in it.get("links", []) if l.get("render") == "image" or "thumb" in (l.get("href") or "")), "")
        out.append(cand(source="nasa", id=nid, kind=kind, title=d.get("title", ""), thumb=thumb, url=f"nasa:{nid}",
                        page=f"https://images.nasa.gov/details/{urllib.parse.quote(nid)}", author=d.get("center", "NASA"), license="NASA media (public domain)"))
    return out


def openmontage(q, kind, n):
    """Extra keyless adapters from a local OpenMontage clone (Coverr, Mixkit, Archive.org, ...)."""
    root = os.environ.get("OPENMONTAGE_PATH")
    if not root or not os.path.isdir(os.path.join(root, "tools", "video", "stock_sources")):
        return []
    sys.path.insert(0, root)
    try:
        from tools.video import stock_sources as ss  # type: ignore
    except Exception as e:  # noqa: BLE001
        warn(f"openmontage import failed: {e}")
        return []
    want = ["coverr", "mixkit", "archive_org", "videvo", "dareful"] if kind == "video" else []
    out = []
    for name in want:
        try:
            src = ss.get_source(name)
            if not src or not src.is_available():
                continue
            res = src.search(q, ss.SearchFilters(kind=kind, per_page=max(3, n // 2)))
            for c in res[: max(2, n // 2)]:
                out.append(cand(source=f"{name}", id=str(c.source_id), kind=c.kind, title=(c.source_tags or "")[:80], thumb=c.thumbnail_url,
                                url=c.download_url, page=c.source_url, width=c.width, height=c.height, duration=float(c.duration or 0),
                                author=c.creator, license=c.license))
        except Exception as e:  # noqa: BLE001
            warn(f"{name}: {e}")
    return out


SOURCES = [pexels, pixabay, unsplash, wikimedia, nasa, openmontage]


def search(q, kind, n, min_dur=0):
    results, seen = [], set()
    for fn in SOURCES:
        if len(results) >= n * 2:
            break
        try:
            for c in fn(q, kind, n):
                if kind == "video" and min_dur and c["duration"] and c["duration"] < min_dur:
                    continue
                k = (c["source"], c["id"])
                if k in seen or not c["url"]:
                    continue
                seen.add(k)
                results.append(c)
        except Exception as e:  # noqa: BLE001
            warn(f"{fn.__name__}: {e}")
    return results[: n * 2]


# ---------------------------------------------------------------- music
def freesound(q, n, min_dur):
    key = os.environ.get("FREESOUND_API_KEY")
    if not key:
        return []
    qs = urllib.parse.urlencode({
        "query": q, "page_size": n, "token": key, "sort": "rating_desc",
        "filter": f'duration:[{int(min_dur)} TO 900] license:("Creative Commons 0" OR "Attribution")',
        "fields": "id,name,previews,license,username,duration,url",
    })
    out = []
    for s in get_json(f"https://freesound.org/apiv2/search/text/?{qs}").get("results", []):
        pv = s.get("previews") or {}
        url = pv.get("preview-hq-mp3") or pv.get("preview-lq-mp3")
        if not url:
            continue
        lic = s.get("license", "")
        out.append(cand(source="freesound", id=str(s["id"]), kind="music", title=s.get("name"), url=url, page=s.get("url"),
                        duration=float(s.get("duration") or 0), author=s.get("username"),
                        license="CC0" if "zero" in lic or "publicdomain" in lic else "CC BY 4.0 (credit the author)"))
    return out


def pixabay_music(q, n, min_dur):
    root = os.environ.get("OPENMONTAGE_PATH")
    if not root:
        return []
    sys.path.insert(0, root)
    try:
        from tools.audio.pixabay_music import PixabayMusic  # type: ignore
        tracks = PixabayMusic()._search({"query": q})
    except Exception as e:  # noqa: BLE001
        warn(f"pixabay music: {e}")
        return []
    out = []
    for t in tracks:
        d = float(t.get("duration") or 0)
        if d and d < min_dur:
            continue
        out.append(cand(source="pixabay-music", id=str(t.get("pixabay_id") or t.get("audio_url")), kind="music", title=t.get("title"),
                        url=t.get("audio_url"), page=t.get("page_url") or "https://pixabay.com/music/", duration=d, author=t.get("artist"),
                        license="Pixabay Content License"))
        if len(out) >= n:
            break
    return out


def music(q, n, min_dur):
    out = []
    for fn in (freesound, pixabay_music):
        try:
            out += fn(q, n, min_dur)
        except Exception as e:  # noqa: BLE001
            warn(f"{fn.__name__}: {e}")
        if len(out) >= n:
            break
    return out[:n]


# ---------------------------------------------------------------- download
def resolve(url):
    if url.startswith("nasa:"):
        nid = url[5:]
        items = (get_json(f"https://images-api.nasa.gov/asset/{urllib.parse.quote(nid)}").get("collection") or {}).get("items", [])
        hrefs = [i.get("href", "") for i in items]
        for pref in ("~mobile.mp4", "~medium.mp4", "~large.jpg", "~orig.mp4", "~orig.jpg", ".mp4", ".jpg"):
            for h in hrefs:
                if h.endswith(pref):
                    return h.replace("http://", "https://")
        raise RuntimeError(f"no downloadable file for NASA {nid}")
    return url


def download(url, out, ping=None):
    url = resolve(url)
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 " + UA, "Referer": "https://pixabay.com/" if "pixabay" in url else url})
    with urllib.request.urlopen(req, timeout=120) as r, open(out, "wb") as f:
        while True:
            b = r.read(1 << 16)
            if not b:
                break
            f.write(b)
    if ping and os.environ.get("UNSPLASH_ACCESS_KEY"):
        try:  # Unsplash API guideline: register the download
            get_json(ping, {"Authorization": f"Client-ID {os.environ['UNSPLASH_ACCESS_KEY']}"})
        except Exception:  # noqa: BLE001
            pass
    print(json.dumps({"ok": True, "out": out, "bytes": os.path.getsize(out)}))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["search", "music", "download"])
    ap.add_argument("--kind", default="video")
    ap.add_argument("--query", default="")
    ap.add_argument("--n", type=int, default=6)
    ap.add_argument("--min-dur", type=float, default=0)
    ap.add_argument("--url")
    ap.add_argument("--out")
    ap.add_argument("--ping")
    a = ap.parse_args()
    if a.cmd == "search":
        print(json.dumps(search(a.query, a.kind, a.n, a.min_dur)))
    elif a.cmd == "music":
        print(json.dumps(music(a.query, a.n, a.min_dur or 30)))
    else:
        download(a.url, a.out, a.ping)
