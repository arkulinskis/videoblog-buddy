"""Cleaning what the browser sends: the editor's decisions (edit), the publish kit, thumbnails, take markers
and clicks. Everything is bounded (counts, lengths, number ranges) so a bad or hostile client can't store
junk. Keep the shapes in step with VB.DEFAULT_EDIT / VB.newScene in web/pages/_a_core.html.
"""
import re

KINDS = ("youtube", "short", "reel", "square", "tutorial", "devlog")
STATUSES = ("idea", "script", "recorded", "edited", "published")
ASPECTS = ("16:9", "9:16", "1:1")
LAYOUTS = ("pip", "stack", "crop", "screen", "cam", "side")
BGS = ("red", "sunset", "ocean", "mint", "grape", "night", "paper", "blur")
CAM_POS = ("br", "bl", "tr", "tl")
CAM_SHAPES = ("circle", "rounded", "square")
TRANSITIONS = ("cut", "fade", "dip")
CARD_STYLES = ("classic", "bold", "minimal", "app", "subscribe")
TEXT_STYLES = ("lower", "callout", "caption", "title", "arrow")
TEXT_POS = ("bl", "bc", "br", "tl", "tc", "tr", "c")
MARKER_KINDS = ("chapter", "highlight", "note")
THUMB_TPLS = ("bold", "split", "emoji", "minimal", "news")
MODES = ("screen_cam", "screen", "cam", "file")

MAX_SCENES = 60
MAX_CUTS = 300
MAX_ZOOMS = 120
MAX_TEXTS = 40
MAX_MARKERS = 400
MAX_CLICKS = 4000
MAX_SECONDS = 4 * 3600


def num(v, lo, hi, default=0.0, digits=3):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return default
    if f != f:  # NaN
        return default
    return round(min(hi, max(lo, f)), digits)


def pick(v, allowed, default):
    return v if v in allowed else default


def s(v, limit, multiline=False):
    out = "" if v is None else str(v)
    out = out.replace("\r\n", "\n")
    if not multiline:
        out = re.sub(r"\s+", " ", out)
    return out.strip()[:limit]


def ident(v):
    v = s(v, 40)
    return v if re.match(r"^[A-Za-z0-9_-]{1,40}$", v) else None


def color(v, default="#cc181e"):
    v = s(v, 9)
    return v if re.match(r"^#[0-9a-fA-F]{6}$", v) else default


def pairs(v, limit, hi=MAX_SECONDS):
    out = []
    for p in (v if isinstance(v, list) else [])[:limit]:
        if isinstance(p, (list, tuple)) and len(p) == 2:
            a, b = num(p[0], 0, hi), num(p[1], 0, hi)
            if b - a >= 0.05:
                out.append([a, b])
    out.sort()
    return out


def cam(v, partial=False):
    """Camera bubble settings. partial=True: a per-scene override (only the keys given)."""
    v = v if isinstance(v, dict) else {}
    out = {}
    if not partial or "pos" in v:
        out["pos"] = pick(v.get("pos"), CAM_POS, "br")
    if not partial or "size" in v:
        out["size"] = num(v.get("size"), 0.1, 0.5, 0.24)
    if not partial or "shape" in v:
        out["shape"] = pick(v.get("shape"), CAM_SHAPES, "circle")
    if not partial or "border" in v:
        out["border"] = v.get("border") is not False
    if not partial or "hidden" in v:
        out["hidden"] = bool(v.get("hidden"))
    return out


def zooms(v):
    out = []
    for z in (v if isinstance(v, list) else [])[:MAX_ZOOMS]:
        if not isinstance(z, dict):
            continue
        a, b = num(z.get("s"), 0, MAX_SECONDS), num(z.get("e"), 0, MAX_SECONDS)
        if b - a < 0.2:
            continue
        pts = []
        for p in (z.get("pts") if isinstance(z.get("pts"), list) else [])[:40]:
            if isinstance(p, (list, tuple)) and len(p) == 3:
                pts.append([num(p[0], 0, MAX_SECONDS), num(p[1], 0, 1, 0.5, 4), num(p[2], 0, 1, 0.5, 4)])
        if not pts:
            pts = [[a, 0.5, 0.5]]
        out.append({"s": a, "e": b, "z": num(z.get("z"), 1.1, 3, 1.6, 2), "pts": pts, "auto": bool(z.get("auto"))})
    out.sort(key=lambda z: z["s"])
    return out


def texts(v):
    out = []
    for t in (v if isinstance(v, list) else [])[:MAX_TEXTS]:
        if not isinstance(t, dict):
            continue
        body = s(t.get("text"), 140)
        if not body:
            continue
        a, b = num(t.get("s"), 0, MAX_SECONDS), num(t.get("e"), 0, MAX_SECONDS)
        if b - a < 0.2:
            b = a + 3
        out.append({"id": ident(t.get("id")) or "t%d" % len(out), "s": a, "e": b, "text": body, "sub": s(t.get("sub"), 140),
                    "style": pick(t.get("style"), TEXT_STYLES, "lower"), "pos": pick(t.get("pos"), TEXT_POS, "bl")})
    return out


def scene(v, take_ids):
    if not isinstance(v, dict):
        return None
    sid = ident(v.get("id"))
    if not sid:
        return None
    if v.get("type") == "card":
        return {"id": sid, "type": "card", "style": pick(v.get("style"), CARD_STYLES, "classic"), "title": s(v.get("title"), 90),
                "sub": s(v.get("sub"), 140), "dur": num(v.get("dur"), 1, 15, 3, 2), "color": color(v.get("color")),
                "emoji": s(v.get("emoji"), 8)}
    take = v.get("take")
    if take not in take_ids:
        return None
    a, b = num(v.get("in"), 0, MAX_SECONDS), num(v.get("out"), 0, MAX_SECONDS)
    if b - a < 0.2:
        return None
    out = {"id": sid, "type": "take", "take": take, "in": a, "out": b, "cuts": pairs(v.get("cuts"), MAX_CUTS),
           "speed": num(v.get("speed"), 0.5, 2, 1, 2), "layout": pick(v.get("layout"), LAYOUTS + ("",), ""),
           "zooms": zooms(v.get("zooms")), "texts": texts(v.get("texts")), "mute": bool(v.get("mute"))}
    if isinstance(v.get("cam"), dict) and v.get("cam"):
        out["cam"] = cam(v.get("cam"), partial=True)
    return out


def edit(v, take_ids):
    """The editor's whole state for one video."""
    v = v if isinstance(v, dict) else {}
    scenes = []
    for sc in (v.get("scenes") if isinstance(v.get("scenes"), list) else [])[:MAX_SCENES]:
        c = scene(sc, take_ids)
        if c:
            scenes.append(c)
    music = v.get("music") if isinstance(v.get("music"), dict) else {}
    zoom = v.get("zoom") if isinstance(v.get("zoom"), dict) else {}
    return {"v": 1, "aspect": pick(v.get("aspect"), ASPECTS, "16:9"), "layout": pick(v.get("layout"), LAYOUTS, "pip"),
            "bg": pick(v.get("bg"), BGS, "red"), "pad": num(v.get("pad"), 0, 0.16, 0.05), "radius": num(v.get("radius"), 0, 40, 14, 0),
            "cam": cam(v.get("cam")), "zoom": {"auto": zoom.get("auto") is not False, "level": num(zoom.get("level"), 1.2, 3, 1.7, 2)},
            "transition": pick(v.get("transition"), TRANSITIONS, "fade"), "voice": num(v.get("voice"), 0, 2, 1, 2),
            "music": {"vol": num(music.get("vol"), 0, 1, 0.25, 2), "name": s(music.get("name"), 120), "duck": music.get("duck") is not False},
            "watermark": s(v.get("watermark"), 40), "progress": bool(v.get("progress")), "scenes": scenes}


def publish(v):
    v = v if isinstance(v, dict) else {}
    titles = [s(t, 100) for t in (v.get("titles") if isinstance(v.get("titles"), list) else [])[:6] if s(t, 100)]
    checks = v.get("checks") if isinstance(v.get("checks"), dict) else {}
    return {"title": s(v.get("title"), 100), "titles": titles, "description": s(v.get("description"), 5000, multiline=True),
            "tags": s(v.get("tags"), 500), "hashtags": s(v.get("hashtags"), 300), "pinned": s(v.get("pinned"), 1000, multiline=True),
            "caption": s(v.get("caption"), 2200, multiline=True),
            "checks": {ident(k): bool(x) for k, x in list(checks.items())[:30] if ident(k)}}


def thumb(v):
    """A small JPEG/PNG/WebP data URL for the library card (at most ~120 KB)."""
    v = "" if v is None else str(v)
    if not v:
        return ""
    if len(v) > 160000 or not re.match(r"^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$", v):
        return None
    return v


def thumb_design(v):
    v = v if isinstance(v, dict) else {}
    return {"tpl": pick(v.get("tpl"), THUMB_TPLS, "bold"), "text": s(v.get("text"), 60), "text2": s(v.get("text2"), 60),
            "color": color(v.get("color"), "#ffde00"), "bg": color(v.get("bg"), "#cc181e"), "emoji": s(v.get("emoji"), 8),
            "take": s(v.get("take"), 40), "t": num(v.get("t"), 0, MAX_SECONDS), "face": v.get("face") is not False,
            "arrow": bool(v.get("arrow"))}


def markers(v):
    out = []
    for m in (v if isinstance(v, list) else [])[:MAX_MARKERS]:
        if isinstance(m, (list, tuple)) and len(m) >= 2:
            out.append([num(m[0], 0, MAX_SECONDS, 0, 2), pick(m[1], MARKER_KINDS, "chapter"), s(m[2] if len(m) > 2 else "", 80)])
    out.sort(key=lambda m: m[0])
    return out


def clicks(v):
    out = []
    for c in (v if isinstance(v, list) else [])[:MAX_CLICKS]:
        if isinstance(c, (list, tuple)) and len(c) >= 3:
            out.append([num(c[0], 0, MAX_SECONDS, 0, 2), num(c[1], 0, 1, 0.5, 4), num(c[2], 0, 1, 0.5, 4)])
    out.sort(key=lambda c: c[0])
    return out


def track(v):
    """Facts about one recorded track: {w, h, type, surface}."""
    v = v if isinstance(v, dict) else {}
    if not v:
        return None
    return {"w": int(num(v.get("w"), 0, 8192, 0, 0)), "h": int(num(v.get("h"), 0, 8192, 0, 0)), "type": s(v.get("type"), 60),
            "surface": pick(v.get("surface"), ("browser", "window", "monitor", "camera", "file", "sample", ""), ""),
            "audio": bool(v.get("audio"))}
