"""Videos, takes, exports, stats and badges. Everything is private to its owner.

The recordings themselves never reach the server: they stay in the browser that recorded them (IndexedDB,
VB.vault). A take row holds the facts (length, size, markers, clicks) and `key`, the vault key of its files,
plus `device`, the id of the browser vault that holds them.
"""
import datetime as dt

import anvil.server
from anvil.tables import app_tables
import anvil.tables as tables

from . import common as C
from . import Clean, DemoData, Sample

BADGES = [
    ("first_take", "First take", "\U0001F3AC", "Record your first take"),
    ("first_cut", "Director's cut", "✂️", "Export your first video"),
    ("on_air", "On air", "\U0001F4E1", "Mark a video as published"),
    ("five_live", "Five on air", "\U0001F3C6", "Publish 5 videos"),
    ("vertical", "Vertical hero", "\U0001F4F1", "Export 3 Shorts or Reels"),
    ("marathon", "Marathon", "⏱️", "Record 60 minutes in total"),
    ("portfolio", "Portfolio", "\U0001F9E9", "Make videos about 3 different apps"),
    ("streak", "On a roll", "\U0001F525", "Publish 3 weeks in a row"),
    ("wordsmith", "Wordsmith", "\U0001F4AC", "Write captions for a take"),
    ("direct", "Straight to YouTube", "\U0001F680", "Upload a video to YouTube from the app"),
    ("goal", "Goal getter", "\U0001F3AF", "Reach your weekly goal"),
]
MAX_VERSIONS = 15
VERTICAL = ("short", "reel")


# ------------------------------------------------------------------------------------------------ helpers
def _own(table, row_id, me):
    r = C.row_by_id(table, row_id)
    if r is None or r["owner"] != me:
        return None
    return r


def product_dict(p):
    if p is None:
        return None
    return {"id": p.get_id(), "name": p["name"] or "", "emoji": p["emoji"] or "", "color": p["color"] or "#cc181e",
            "url": p["url"] or "", "tagline": p["tagline"] or "", "audience": p["audience"] or "", "features": p["features"] or "",
            "cta": p["cta"] or "", "notes": p["notes"] or "", "created": C.iso(p["created"])}


def _product_mini(p):
    return None if p is None else {"id": p.get_id(), "name": p["name"] or "", "emoji": p["emoji"] or "", "color": p["color"] or "#cc181e"}


def card(v, take_count=None):
    if take_count is None:
        take_count = len(app_tables.takes.search(video=v))
    return {"id": v.get_id(), "title": v["title"] or "Untitled video", "kind": v["kind"] or "youtube", "status": v["status"] or "idea",
            "due": C.iso(v["due"]), "product": _product_mini(v["product"]), "duration": v["duration"] or 0, "thumb": v["thumb"] or "",
            "takes": take_count, "youtube_url": v["youtube_url"] or "", "sample": bool(v["sample"]), "priority": int(v["priority"] or 0),
            "created": C.iso(v["created"]), "updated": C.iso(v["updated"]), "published_at": C.iso(v["published_at"])}


def full(v):
    out = card(v)
    out.update({"script": v["script"] or "", "edit": v["edit"] or {}, "publish": v["publish"] or {},
                "thumb_design": v["thumb_design"] or {}, "notes": v["notes"] or "", "script_versions": v["script_versions"] or []})
    return out


def take_dict(t):
    return {"id": t.get_id(), "key": t["key"], "label": t["label"] or "", "mode": t["mode"] or "screen", "duration": t["duration"] or 0,
            "main": t["main"], "cam": t["cam"], "cam_offset": t["cam_offset"] or 0, "markers": t["markers"] or [],
            "clicks": t["clicks"] or [], "bytes": t["bytes"] or 0, "device": t["device"] or "", "sample": t["sample"] or "",
            "thumb": t["thumb"] or "", "starred": bool(t["starred"]), "source": t["source"] or "", "created": C.iso(t["created"]),
            "words": t["words"] or None}


def _takes(v):
    return list(app_tables.takes.search(tables.order_by("created"), video=v))


def _iso_week(d):
    y, w, _ = d.isocalendar()
    return y * 100 + w


def stats(me):
    videos = [v for v in app_tables.videos.search(owner=me) if not v["sample"]]
    takes = [t for t in app_tables.takes.search(owner=me) if not t["sample"]]
    exports = list(app_tables.exports.search(owner=me))
    published = [v for v in videos if v["status"] == "published"]
    weeks = sorted({_iso_week(v["published_at"].date()) for v in published if v["published_at"]}, reverse=True)
    streak, d = 0, C.now().date()
    while weeks and _iso_week(d) in weeks:
        streak += 1
        d -= dt.timedelta(days=7)
    if streak == 0 and weeks:  # this week isn't over yet: count from last week
        d = C.now().date() - dt.timedelta(days=7)
        while _iso_week(d) in weeks:
            streak += 1
            d -= dt.timedelta(days=7)
    vertical = len([e for e in exports if e["video"] is not None and e["video"]["kind"] in VERTICAL])
    apps = {v["product"].get_id() for v in videos if v["product"] is not None}
    minutes = round(sum((t["duration"] or 0) for t in takes) / 60.0, 1)
    this_week = _iso_week(C.now().date())
    goal = int(me["weekly_goal"] or 0)
    per_week = {}
    for v in published:
        if v["published_at"]:
            k = _iso_week(v["published_at"].date())
            per_week[k] = per_week.get(k, 0) + 1
    return {"videos": len(videos), "published": len(published), "takes": len(takes), "minutes": minutes, "exports": len(exports),
            "vertical": vertical, "apps": len(apps), "streak": streak,
            "products": len(app_tables.products.search(owner=me)),
            "transcribed": len([t for t in app_tables.takes.search(owner=me) if t["words"]]),
            "uploads": len([v for v in videos if ((v["publish"] or {}).get("yt") or {}).get("id")]),
            "week": per_week.get(this_week, 0), "goal": goal,
            "goal_weeks": len([k for k, n in per_week.items() if goal and n >= goal])}


def badges(st):
    got = {"first_take": st["takes"] >= 1, "first_cut": st["exports"] >= 1, "on_air": st["published"] >= 1,
           "five_live": st["published"] >= 5, "vertical": st["vertical"] >= 3, "marathon": st["minutes"] >= 60,
           "portfolio": st["apps"] >= 3, "streak": st["streak"] >= 3, "wordsmith": st.get("transcribed", 0) >= 1,
           "direct": st.get("uploads", 0) >= 1, "goal": st.get("goal_weeks", 0) >= 1}
    return [{"key": k, "name": n, "emoji": e, "desc": d, "got": got[k]} for k, n, e, d in BADGES]


def _products(me):
    return [product_dict(p) for p in app_tables.products.search(tables.order_by("created"), owner=me)]


def _video_patch(v, patch, me):
    """Apply allowed fields from patch to the video row. Returns an error message or None."""
    patch = patch if isinstance(patch, dict) else {}
    ch = {}
    if "title" in patch:
        t = C.text(patch.get("title"), 100)
        if len(t) < 2:
            return "Give the video a title (at least 2 characters)."
        ch["title"] = t
    if "kind" in patch:
        ch["kind"] = Clean.pick(patch.get("kind"), Clean.KINDS, "youtube")
    if "status" in patch:
        st = Clean.pick(patch.get("status"), Clean.STATUSES, None)
        if st is None:
            return "Unknown status."
        ch["status"] = st
        if st == "published" and v["published_at"] is None:
            ch["published_at"] = C.now()
        if st != "published":
            ch["published_at"] = None
    if "due" in patch:
        d = patch.get("due")
        if d in (None, ""):
            ch["due"] = None
        else:
            try:
                ch["due"] = dt.date.fromisoformat(str(d)[:10])
            except ValueError:
                return "That date doesn't look right."
    if "product_id" in patch:
        pid = patch.get("product_id")
        if pid in (None, ""):
            ch["product"] = None
        else:
            p = _own(app_tables.products, pid, me)
            if p is None:
                return "That app isn't in your list."
            ch["product"] = p
    if "priority" in patch:
        ch["priority"] = int(Clean.num(patch.get("priority"), 0, 3, 0, 0))
    if "script" in patch:
        new = C.text(patch.get("script"), 20000, multiline=True)
        old = v["script"] or ""
        if new != old and old.strip():
            # Keep the old script as a version: at most one per 10 minutes of writing (or when asked: snapshot).
            vers = list(v["script_versions"] or [])
            stamp = C.now()
            last = vers[0].get("saved") if vers and isinstance(vers[0], dict) else None
            try:
                age = (stamp - dt.datetime.fromisoformat(last)).total_seconds() if last else 1e9
            except (TypeError, ValueError):
                age = 1e9
            if patch.get("snapshot") or age > 600:
                vers.insert(0, {"saved": C.iso(stamp), "at": C.iso(v["updated"] or stamp), "text": old, "words": len(old.split())})
                ch["script_versions"] = vers[:MAX_VERSIONS]
        ch["script"] = new
    if "notes" in patch:
        ch["notes"] = C.text(patch.get("notes"), 2000, multiline=True)
    if "youtube_url" in patch:
        u = C.text(patch.get("youtube_url"), 300)
        if u and not u.startswith(("https://", "http://")):
            return "The video link should start with https://"
        ch["youtube_url"] = u
    if "edit" in patch:
        ids = {t.get_id() for t in app_tables.takes.search(video=v)}
        ch["edit"] = Clean.edit(patch.get("edit"), ids)
    if "duration" in patch:
        ch["duration"] = Clean.num(patch.get("duration"), 0, Clean.MAX_SECONDS, 0, 1)
    if "publish" in patch:
        ch["publish"] = Clean.publish(patch.get("publish"))
    if "thumb" in patch:
        th = Clean.thumb(patch.get("thumb"))
        if th is None:
            return "That thumbnail is too big or not a picture."
        ch["thumb"] = th
    if "thumb_design" in patch:
        ch["thumb_design"] = Clean.thumb_design(patch.get("thumb_design"))
    if ch:
        ch["updated"] = C.now()
        v.update(**ch)
    return None


# ------------------------------------------------------------------------------------------------ studio
@anvil.server.callable(require_user=True)
def studio_home():
    """The library: every video, the apps, stats and badges. A new account gets the sample project once."""
    me = C.require_user()
    DemoData.ensure_loaded()
    if not me["sample_made"]:
        me["sample_made"] = True
        Sample.make(me)
    videos = list(app_tables.videos.search(tables.order_by("updated", ascending=False), owner=me))
    counts = {}
    for t in app_tables.takes.search(owner=me):
        if t["video"] is not None:
            k = t["video"].get_id()
            counts[k] = counts.get(k, 0) + 1
    st = stats(me)
    return {"videos": [card(v, counts.get(v.get_id(), 0)) for v in videos], "products": _products(me), "stats": st,
            "badges": badges(st), "handle": me["handle"] or ""}


@anvil.server.callable(require_user=True)
def sample_create():
    """Bring the sample project back (or add a second copy)."""
    me = C.require_user()
    if C.rate_limited("sample", 5, 3600):
        return C.fail("That's plenty of samples for now.")
    v = Sample.make(me)
    me["sample_made"] = True
    return C.ok(video=card(v))


@anvil.server.callable(require_user=True)
def set_handle(handle):
    me = C.require_user()
    h = C.text(handle, 40).replace(" ", "")
    if h and not h.startswith("@"):
        h = "@" + h
    me["handle"] = h
    return C.ok(handle=h)


@anvil.server.callable(require_user=True)
def set_goal(n):
    """Weekly goal: how many videos to publish each week (0 = no goal)."""
    me = C.require_user()
    before = {b["key"] for b in badges(stats(me)) if b["got"]}
    me["weekly_goal"] = int(Clean.num(n, 0, 14, 0, 0))
    st = stats(me)
    bs = badges(st)
    return C.ok(stats=st, badges=bs, new_badges=[b for b in bs if b["got"] and b["key"] not in before])


@anvil.server.callable(require_user=True)
def planner_get():
    me = C.require_user()
    videos = list(app_tables.videos.search(tables.order_by("updated", ascending=False), owner=me))
    return {"videos": [card(v) for v in videos], "products": _products(me), "handle": me["handle"] or ""}


# ------------------------------------------------------------------------------------------------ videos
@anvil.server.callable(require_user=True)
def video_create(fields=None):
    me = C.require_user()
    fields = fields if isinstance(fields, dict) else {}
    if C.rate_limited("video_create", 60, 3600):
        return C.fail("That's a lot of new videos in one hour. Take a breather and try again soon.")
    title = C.text(fields.get("title"), 100) or "Untitled video"
    if len(title) < 2:
        title = "Untitled video"
    now = C.now()
    v = app_tables.videos.add_row(owner=me, title=title, kind="youtube", status="idea", script="", edit={}, publish={}, thumb="",
                                  thumb_design={}, duration=0, youtube_url="", notes="", sample=False, created=now, updated=now,
                                  is_demo=False, priority=0, script_versions=[])
    rest = {k: fields[k] for k in ("kind", "status", "due", "product_id", "script", "notes", "priority") if k in fields}
    err = _video_patch(v, rest, me)
    if err:
        v.delete()
        return C.fail(err)
    return C.ok(video=full(v))


@anvil.server.callable(require_user=True)
def video_get(video_id):
    me = C.require_user()
    v = _own(app_tables.videos, video_id, me)
    if v is None:
        return C.fail("That video isn't in your library (maybe it was deleted).")
    return C.ok(video=full(v), takes=[take_dict(t) for t in _takes(v)], product=product_dict(v["product"]),
                products=_products(me), handle=me["handle"] or "")


@anvil.server.callable(require_user=True)
def video_update(video_id, patch):
    me = C.require_user()
    v = _own(app_tables.videos, video_id, me)
    if v is None:
        return C.fail("That video isn't in your library (maybe it was deleted).")
    watch = isinstance(patch, dict) and "status" in patch
    before = {b["key"] for b in badges(stats(me)) if b["got"]} if watch else set()
    err = _video_patch(v, patch, me)
    if err:
        return C.fail(err)
    got = [b for b in badges(stats(me)) if b["got"] and b["key"] not in before] if watch else []
    return C.ok(video=full(v), new_badges=got)


def _free_keys(keys, me):
    """Vault keys no take of this person uses any more (their files can be deleted from the browser)."""
    used = {t["key"] for t in app_tables.takes.search(owner=me)}
    return sorted(k for k in keys if k and k not in used and not k.startswith("sample-"))


@anvil.server.callable(require_user=True)
def video_delete(video_id):
    me = C.require_user()
    v = _own(app_tables.videos, video_id, me)
    if v is None:
        return C.ok(free_keys=[])
    keys = set()
    for t in app_tables.takes.search(video=v):
        keys.add(t["key"])
        t.delete()
    for e in app_tables.exports.search(video=v):
        e["video"] = None
    v.delete()
    return C.ok(free_keys=_free_keys(keys, me))


@anvil.server.callable(require_user=True)
def video_remix(video_id, kind, clip=None):
    """A copy of the video in another format (e.g. a vertical Short from a YouTube video). The takes are
    shared: the copy points at the same recordings. clip = {take, in, out, title}: the copy is only that part
    of one take (a Short made from a chapter)."""
    me = C.require_user()
    v = _own(app_tables.videos, video_id, me)
    if v is None:
        return C.fail("That video isn't in your library.")
    kind = Clean.pick(kind, Clean.KINDS, "short")
    src, a, b = None, 0, 0
    if clip is not None:
        clip = clip if isinstance(clip, dict) else {}
        src = _own(app_tables.takes, clip.get("take"), me)
        if src is None or src["video"] != v:
            return C.fail("That take isn't part of this video.")
        a = Clean.num(clip.get("in"), 0, src["duration"] or 0)
        b = Clean.num(clip.get("out"), 0, src["duration"] or 0)
        if b - a < 1:
            return C.fail("That part is too short for a clip.")
        if C.rate_limited("clips", 40, 3600):
            return C.fail("That's a lot of clips in one hour. Try again a bit later.")
    now = C.now()
    label = {"short": "Short", "reel": "Reel", "square": "Square"}.get(kind, "Copy")
    title = C.text((clip or {}).get("title"), 100) if src is not None else ""
    title = title if len(title) >= 2 else C.text("%s (%s)" % (v["title"], label), 100)
    nv = app_tables.videos.add_row(owner=me, product=v["product"], title=title, kind=kind,
                                   status="recorded" if v["status"] in ("edited", "published") else v["status"], due=v["due"],
                                   script=v["script"], edit={}, publish={}, thumb=v["thumb"], thumb_design=v["thumb_design"] or {},
                                   duration=v["duration"], youtube_url="", notes=v["notes"], sample=v["sample"], created=now,
                                   updated=now, is_demo=False, priority=v["priority"] or 0, script_versions=[])
    idmap = {}
    for t in _takes(v):
        if src is not None and t != src:
            continue
        row = app_tables.takes.add_row(video=nv, owner=me, **{k: t[k] for k in ("key", "label", "mode", "duration", "main", "cam",
                                                                                 "cam_offset", "markers", "clicks", "bytes", "device",
                                                                                 "sample", "thumb", "starred", "source", "created",
                                                                                 "words")},
                                       is_demo=False)
        idmap[t.get_id()] = row.get_id()
    ed = dict(v["edit"] or {})
    scenes = []
    if src is not None:
        old = [sc for sc in ed.get("scenes") or [] if sc.get("type") == "take" and sc.get("take") == src.get_id()]
        base = dict(old[0]) if old else {"zooms": [], "texts": [], "boxes": [], "speed": 1, "mute": False}
        base.update({"id": "c1", "type": "take", "take": idmap[src.get_id()], "in": a, "out": b, "layout": "",
                     "cuts": [c for c in base.get("cuts") or [] if c[0] >= a and c[1] <= b]})
        base["texts"] = [x for x in base.get("texts") or [] if a <= x.get("s", 0) < b]
        base["boxes"] = [x for x in base.get("boxes") or [] if x.get("e", 0) > a and x.get("s", 0) < b]
        base["zooms"] = [x for x in base.get("zooms") or [] if a <= x.get("s", 0) < b]
        scenes.append(base)
        nv.update(duration=round(b - a, 1), status="recorded")
    for sc in ([] if src is not None else ed.get("scenes") or []):
        sc = dict(sc)
        if sc.get("type") == "take":
            if sc.get("take") not in idmap:
                continue
            sc["take"] = idmap[sc["take"]]
            sc["layout"] = ""
        scenes.append(sc)
    ed["scenes"] = scenes
    vertical = kind in VERTICAL
    ed["aspect"] = "9:16" if vertical else ("1:1" if kind == "square" else "16:9")
    ed["layout"] = "stack" if vertical else ("pip" if kind != "square" else "crop")
    ed["progress"] = vertical
    nv["edit"] = Clean.edit(ed, set(idmap.values()))
    return C.ok(video=card(nv))


# ------------------------------------------------------------------------------------------------ takes
@anvil.server.callable(require_user=True)
def take_add(video_id, meta):
    me = C.require_user()
    v = _own(app_tables.videos, video_id, me)
    if v is None:
        return C.fail("That video isn't in your library.")
    meta = meta if isinstance(meta, dict) else {}
    key = Clean.ident(meta.get("key"))
    if not key or key.startswith("sample-"):
        return C.fail("This take has no file key.")
    dur = Clean.num(meta.get("duration"), 0, Clean.MAX_SECONDS, 0, 2)
    if dur < 0.3:
        return C.fail("That take is too short to keep.")
    if C.rate_limited("take_add", 200, 3600):
        return C.fail("That's a lot of takes in one hour. Please try again later.")
    thumb = Clean.thumb(meta.get("thumb")) or ""
    n = len(app_tables.takes.search(video=v))
    t = app_tables.takes.add_row(video=v, owner=me, key=key, label=C.text(meta.get("label"), 60) or "Take %d" % (n + 1),
                                 mode=Clean.pick(meta.get("mode"), Clean.MODES, "screen"), duration=dur,
                                 main=Clean.track(meta.get("main")), cam=Clean.track(meta.get("cam")),
                                 cam_offset=Clean.num(meta.get("cam_offset"), -5, 5, 0, 3), markers=Clean.markers(meta.get("markers")),
                                 clicks=Clean.clicks(meta.get("clicks")), bytes=Clean.num(meta.get("bytes"), 0, 1e12, 0, 0),
                                 device=C.text(meta.get("device"), 40), sample="", thumb=thumb, starred=False,
                                 source=Clean.pick(meta.get("source"), ("recorder", "extension", "upload"), "recorder"),
                                 created=C.now(), is_demo=False)
    ch = {"updated": C.now()}
    if v["status"] in ("idea", "script"):
        ch["status"] = "recorded"
    if not v["thumb"] and thumb:
        ch["thumb"] = thumb
    v.update(**ch)
    return C.ok(take=take_dict(t), video=card(v))


@anvil.server.callable(require_user=True)
def take_update(take_id, patch):
    me = C.require_user()
    t = _own(app_tables.takes, take_id, me)
    if t is None:
        return C.fail("That take no longer exists.")
    patch = patch if isinstance(patch, dict) else {}
    ch = {}
    if "label" in patch:
        ch["label"] = C.text(patch.get("label"), 60) or t["label"]
    if "starred" in patch:
        ch["starred"] = bool(patch.get("starred"))
    if "markers" in patch:
        ch["markers"] = Clean.markers(patch.get("markers"))
    if "clicks" in patch:
        ch["clicks"] = Clean.clicks(patch.get("clicks"))
    if "device" in patch and not t["sample"]:
        ch["device"] = C.text(patch.get("device"), 40)
        if "bytes" in patch:
            ch["bytes"] = Clean.num(patch.get("bytes"), 0, 1e12, 0, 0)
    if "thumb" in patch:
        th = Clean.thumb(patch.get("thumb"))
        if th is not None:
            ch["thumb"] = th
    if "words" in patch:
        ch["words"] = Clean.words(patch.get("words"))
    if ch:
        t.update(**ch)
    return C.ok(take=take_dict(t))


@anvil.server.callable(require_user=True)
def take_delete(take_id):
    me = C.require_user()
    t = _own(app_tables.takes, take_id, me)
    if t is None:
        return C.ok(free_keys=[])
    key, v = t["key"], t["video"]
    t.delete()
    if v is not None:
        v["updated"] = C.now()
    return C.ok(free_keys=_free_keys({key}, me))


@anvil.server.callable(require_user=True)
def export_logged(video_id, info):
    """The browser finished an export: count it for stats and badges. Returns any badge just earned."""
    me = C.require_user()
    v = _own(app_tables.videos, video_id, me)
    if v is None:
        return C.fail("That video isn't in your library.")
    if C.rate_limited("export", 120, 3600):
        return C.ok(stats=stats(me), new_badges=[])
    info = info if isinstance(info, dict) else {}
    before = {b["key"] for b in badges(stats(me)) if b["got"]}
    app_tables.exports.add_row(owner=me, video=v, seconds=Clean.num(info.get("seconds"), 0, Clean.MAX_SECONDS, 0, 1),
                               aspect=Clean.pick(info.get("aspect"), Clean.ASPECTS, "16:9"),
                               format=Clean.pick(info.get("format"), ("mp4", "webm"), "webm"),
                               quality=Clean.pick(info.get("quality"), ("720", "1080"), "1080"), created=C.now(), is_demo=False)
    if v["status"] in ("idea", "script", "recorded"):
        v.update(status="edited", updated=C.now())
    st = stats(me)
    got = [b for b in badges(st) if b["got"] and b["key"] not in before]
    return C.ok(stats=st, new_badges=got, video=card(v))
