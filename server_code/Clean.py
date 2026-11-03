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
CARD_STYLES = ("classic", "bold", "minimal", "app", "subscribe", "endscreen")
TEXT_STYLES = ("lower", "callout", "caption", "title", "arrow")
TEXT_POS = ("bl", "bc", "br", "tl", "tc", "tr", "c")
MARKER_KINDS = ("chapter", "highlight", "note")
THUMB_TPLS = ("bold", "split", "emoji", "minimal", "news")
MODES = ("screen_cam", "screen", "cam", "file")
BOX_KINDS = ("blur", "spot", "box")
CAPTION_STYLES = ("clean", "karaoke", "bold", "box")
CAPTION_POS = ("bottom", "middle", "top")
BEATS = ("", "lofi", "upbeat", "chill", "techno")
VOICE_FX = ("off", "clean", "broadcast", "warm")
LUTS = ("none", "studio", "news", "warm", "cool", "teal", "film", "golden", "airy", "moody", "neon", "green", "vintage", "bleach", "bw",
        "noir", "cube")
LOOK_TARGETS = ("cam", "all")
FRAME_STYLES = ("desk", "ticker", "breaking", "bug", "live", "studio", "panel", "glass", "sport", "minimal", "headline", "quote", "rec")
FRAME_TRANS = ("none", "fade", "slide_l", "slide_r", "slide_u", "slide_d", "wipe", "split", "zoom", "pop", "blur", "flip", "drop")
FRAME_FONTS = ("condensed", "anton", "bebas", "roboto", "serif", "mono")
FRAME_POS = ("bl", "br", "tl", "tr")
PRESET_KINDS = ("frame", "look")
MAX_FRAMES = 12
WORD_SOURCES = ("whisper", "script", "sample", "typed")
PRIVACY = ("private", "unlisted", "public")

MAX_SCENES = 60
MAX_CUTS = 300
MAX_ZOOMS = 120
MAX_TEXTS = 40
MAX_MARKERS = 400
MAX_CLICKS = 4000
MAX_BOXES = 30
MAX_WORDS = 12000
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


def boxes(v):
    """Hide (blur) / spotlight / red box regions on the screen, in screen coordinates (0..1)."""
    out = []
    for b in (v if isinstance(v, list) else [])[:MAX_BOXES]:
        if not isinstance(b, dict):
            continue
        a, e = num(b.get("s"), 0, MAX_SECONDS), num(b.get("e"), 0, MAX_SECONDS)
        if e - a < 0.2:
            continue
        x, y = num(b.get("x"), 0, 0.98, 0.4, 4), num(b.get("y"), 0, 0.98, 0.4, 4)
        w, h = num(b.get("w"), 0.02, 1 - x, 0.2, 4), num(b.get("h"), 0.02, 1 - y, 0.15, 4)
        out.append({"id": ident(b.get("id")) or "b%d" % len(out), "s": a, "e": e, "x": x, "y": y, "w": w, "h": h,
                    "kind": pick(b.get("kind"), BOX_KINDS, "blur")})
    return out


def captions(v):
    v = v if isinstance(v, dict) else {}
    return {"on": bool(v.get("on")), "style": pick(v.get("style"), CAPTION_STYLES, "karaoke"), "pos": pick(v.get("pos"), CAPTION_POS, "bottom"),
            "size": num(v.get("size"), 0.6, 1.8, 1, 2), "upper": bool(v.get("upper")), "color": color(v.get("color"), "#ffde00")}


def words(v):
    """A take's transcript: {src, lang, words: [[start, end, word], ...]} (seconds of the take)."""
    v = v if isinstance(v, dict) else {}
    out = []
    for w in (v.get("words") if isinstance(v.get("words"), list) else [])[:MAX_WORDS]:
        if isinstance(w, (list, tuple)) and len(w) >= 3:
            word = s(w[2], 40)
            if not word:
                continue
            a = num(w[0], 0, MAX_SECONDS, 0, 2)
            out.append([a, max(a + 0.02, num(w[1], 0, MAX_SECONDS, a, 2)), word])
    out.sort(key=lambda w: w[0])
    if not out:
        return None
    return {"src": pick(v.get("src"), WORD_SOURCES, "typed"), "lang": s(v.get("lang"), 12) or "en", "words": out}


def look(v):
    """The colour look: a LUT (built in, or a .cube kept in the browser), light and colour fixes, key light, reframe."""
    v = v if isinstance(v, dict) else {}
    light = v.get("light") if isinstance(v.get("light"), dict) else {}
    crop = v.get("crop") if isinstance(v.get("crop"), dict) else {}
    out = {"on": bool(v.get("on")), "target": pick(v.get("target"), LOOK_TARGETS, "cam"), "lut": pick(v.get("lut"), LUTS, "none"),
           "amt": num(v.get("amt"), 0, 1, 1, 2), "cube": s(v.get("cube"), 60), "exposure": num(v.get("exposure"), -2, 2, 0, 2)}
    for k in ("contrast", "highlights", "shadows", "temp", "tint", "sat", "vib"):
        out[k] = num(v.get(k), -1, 1, 0, 2)
    for k in ("fade", "sharpen", "smooth", "grain", "vignette"):
        out[k] = num(v.get(k), 0, 1, 0, 2)
    out["light"] = {"on": bool(light.get("on")), "x": num(light.get("x"), 0, 1, 0.5, 3), "y": num(light.get("y"), 0, 1, 0.38, 3),
                    "size": num(light.get("size"), 0.08, 1, 0.35, 2), "power": num(light.get("power"), 0, 1, 0.4, 2),
                    "warm": num(light.get("warm"), -1, 1, 0.3, 2)}
    out["crop"] = {"z": num(crop.get("z"), 1, 2.5, 1, 2), "x": num(crop.get("x"), 0, 1, 0.5, 3), "y": num(crop.get("y"), 0, 1, 0.5, 3),
                   "mirror": bool(crop.get("mirror"))}
    if out["lut"] == "cube" and not out["cube"]:
        out["lut"] = "none"
    return out


def frame(v, index=0, design_only=False):
    """One on-screen frame (a newsroom graphic). design_only: a layer of a saved preset (no id)."""
    if not isinstance(v, dict) or v.get("style") not in FRAME_STYLES:
        return None
    a, e = num(v.get("s"), 0, MAX_SECONDS, 0, 2), num(v.get("e"), 0, MAX_SECONDS, 8, 2)
    if e - a < 0.3:
        e = a + 3
    out = {"style": v.get("style"), "tag": s(v.get("tag"), 24), "title": s(v.get("title"), 90), "sub": s(v.get("sub"), 240, multiline=True),
           "ticker": s(v.get("ticker"), 500), "logo": s(v.get("logo"), 24), "color": color(v.get("color"), "#cc181e"),
           "accent": color(v.get("accent"), "#ffc400"), "font": pick(v.get("font"), FRAME_FONTS, "condensed"),
           "pos": pick(v.get("pos"), FRAME_POS, "bl"), "size": num(v.get("size"), 0.6, 1.6, 1, 2), "clock": bool(v.get("clock")),
           "speed": num(v.get("speed"), 0.3, 3, 1, 2), "all": v.get("all") is not False, "s": a, "e": e, "cards": bool(v.get("cards")),
           "tin": pick(v.get("tin"), FRAME_TRANS, "fade"), "tout": pick(v.get("tout"), FRAME_TRANS, "fade"),
           "din": num(v.get("din"), 0.1, 3, 0.6, 2), "dout": num(v.get("dout"), 0.1, 3, 0.5, 2)}
    if not design_only:
        out["id"] = ident(v.get("id")) or "f%d" % index
    return out


def frames(v):
    out, seen = [], set()
    for i, f in enumerate((v if isinstance(v, list) else [])[:MAX_FRAMES]):
        c = frame(f, i)
        if c:
            if c["id"] in seen:
                c["id"] = "f%d" % i
                while c["id"] in seen:
                    c["id"] += "x"
            seen.add(c["id"])
            out.append(c)
    return out


def preset(kind, v):
    """What a saved preset keeps: a frame set {layers: [...]} or a look."""
    v = v if isinstance(v, dict) else {}
    if kind == "look":
        return look(dict(v, on=True))
    raw = v.get("layers") if isinstance(v.get("layers"), list) else []
    return {"layers": [f for f in (frame(x, i, design_only=True) for i, x in enumerate(raw[:MAX_FRAMES])) if f]}


def scene(v, take_ids):
    if not isinstance(v, dict):
        return None
    sid = ident(v.get("id"))
    if not sid:
        return None
    if v.get("type") == "card":
        return {"id": sid, "type": "card", "style": pick(v.get("style"), CARD_STYLES, "classic"), "title": s(v.get("title"), 90),
                "sub": s(v.get("sub"), 140), "dur": num(v.get("dur"), 1, 20, 3, 2), "color": color(v.get("color")),
                "emoji": s(v.get("emoji"), 8)}
    take = v.get("take")
    if take not in take_ids:
        return None
    a, b = num(v.get("in"), 0, MAX_SECONDS), num(v.get("out"), 0, MAX_SECONDS)
    if b - a < 0.2:
        return None
    out = {"id": sid, "type": "take", "take": take, "in": a, "out": b, "cuts": pairs(v.get("cuts"), MAX_CUTS),
           "speed": num(v.get("speed"), 0.5, 2, 1, 2), "layout": pick(v.get("layout"), LAYOUTS + ("",), ""),
           "zooms": zooms(v.get("zooms")), "texts": texts(v.get("texts")), "boxes": boxes(v.get("boxes")), "mute": bool(v.get("mute"))}
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
    sfx = v.get("sfx") if isinstance(v.get("sfx"), dict) else {}
    return {"v": 1, "aspect": pick(v.get("aspect"), ASPECTS, "16:9"), "layout": pick(v.get("layout"), LAYOUTS, "pip"),
            "bg": pick(v.get("bg"), BGS, "red"), "pad": num(v.get("pad"), 0, 0.16, 0.05), "radius": num(v.get("radius"), 0, 40, 14, 0),
            "cam": cam(v.get("cam")), "zoom": {"auto": zoom.get("auto") is not False, "level": num(zoom.get("level"), 1.2, 3, 1.7, 2)},
            "transition": pick(v.get("transition"), TRANSITIONS, "fade"), "voice": num(v.get("voice"), 0, 2, 1, 2),
            "music": {"vol": num(music.get("vol"), 0, 1, 0.25, 2), "name": s(music.get("name"), 120), "duck": music.get("duck") is not False,
                      "gen": pick(music.get("gen"), BEATS, "")},
            "sfx": {"clicks": bool(sfx.get("clicks")), "whoosh": bool(sfx.get("whoosh")), "vol": num(sfx.get("vol"), 0, 1, 0.6, 2)},
            "voice_fx": pick(v.get("voice_fx"), VOICE_FX, "off"), "captions": captions(v.get("captions")),
            "watermark": s(v.get("watermark"), 40), "progress": bool(v.get("progress")), "look": look(v.get("look")),
            "frames": frames(v.get("frames")), "scenes": scenes}


def publish(v):
    v = v if isinstance(v, dict) else {}
    titles = [s(t, 100) for t in (v.get("titles") if isinstance(v.get("titles"), list) else [])[:6] if s(t, 100)]
    checks = v.get("checks") if isinstance(v.get("checks"), dict) else {}
    return {"title": s(v.get("title"), 100), "titles": titles, "description": s(v.get("description"), 5000, multiline=True),
            "tags": s(v.get("tags"), 500), "hashtags": s(v.get("hashtags"), 300), "pinned": s(v.get("pinned"), 1000, multiline=True),
            "caption": s(v.get("caption"), 2200, multiline=True),
            "checks": {ident(k): bool(x) for k, x in list(checks.items())[:30] if ident(k)}, "yt": yt(v.get("yt"))}


def yt(v):
    """What the direct YouTube upload returned: the video id, privacy and when."""
    v = v if isinstance(v, dict) else {}
    vid = s(v.get("id"), 20)
    if not re.match(r"^[A-Za-z0-9_-]{6,20}$", vid):
        return {}
    return {"id": vid, "privacy": pick(v.get("privacy"), PRIVACY, "private"), "at": s(v.get("at"), 30), "publish_at": s(v.get("publish_at"), 30),
            "captions": bool(v.get("captions")), "thumb": bool(v.get("thumb"))}


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
