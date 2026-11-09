"""Server tests against the strict mock of Anvil (tools/testing/mock).

    python -I tools/testing/test_server.py          -> prints ALL OK, or the first failure

call(name, ...) runs a server function the way the browser does: by name, with require_user enforced,
and the reply must be JSON (a datetime or a row in a reply fails here, like it would break the page).
Add tests for every new server function: the happy path, bad input, and someone who isn't allowed.
"""
import datetime as dt
import importlib
import json
import os
import pathlib
import shutil
import sys
import tempfile

HERE = pathlib.Path(__file__).resolve().parent
PROJECT = HERE.parents[1]
_tmp = pathlib.Path(tempfile.mkdtemp())
shutil.copytree(PROJECT / "server_code", _tmp / "app")
(_tmp / "app" / "__init__.py").write_text("")
os.environ["ANVIL_APP_YAML"] = str(PROJECT / "anvil.yaml")  # the mock's tables follow the app's own schema
sys.path[:0] = [str(HERE / "mock"), str(_tmp)]
import anvil.server  # noqa: E402
import anvil.users  # noqa: E402
from anvil.tables import app_tables as T  # noqa: E402

M = {p.stem: importlib.import_module("app." + p.stem) for p in sorted((PROJECT / "server_code").glob("*.py"))}
now = dt.datetime.now(dt.timezone.utc)


def call(name, *args):
    r = anvil.server.call(name, *args)
    json.dumps(r)  # strict: must be JSON-able
    return r


def as_user(row):
    anvil.users.CURRENT[0] = row
    anvil.server.session.use(row.get_id() if row is not None else None)


def denied(name, *args):
    try:
        call(name, *args)
    except anvil.server.PermissionDenied:
        return True
    return False


def ok(r, msg=""):
    assert isinstance(r, dict) and r.get("ok"), (msg, r)
    return r


def bad(r, msg=""):
    assert isinstance(r, dict) and r.get("ok") is False and r.get("error"), (msg, r)
    return r


def person(email, name=None, **kw):
    return T.users.add_row(email=email, enabled=True, signed_up=now, display_name=name, **kw)


# ---------------------------------------------------------------------------------- accounts
admin = person("arkulinskis@gmail.com", "The Admin")
ana = person("ana@example.com", "Ana")
bob = person("bob@example.com")

as_user(None)
assert call("get_me") is None
assert denied("update_profile", "X")
as_user(admin)
assert call("get_me")["is_admin"] is True, "ADMIN_EMAILS become admins on first sign-in"
as_user(ana)
me = call("get_me")
assert me["name"] == "Ana" and me["is_admin"] is False
assert ana["last_seen"] is not None
as_user(bob)
assert call("get_me")["name"] == "Bob", "a name comes from the email when none is set"
bad(call("update_profile", " x "))
assert ok(call("update_profile", "  Bob   Stone "))["me"]["name"] == "Bob Stone"

# ---------------------------------------------------------------------------------- feedback
as_user(None)
bad(call("submit_feedback", "bug", "hi"))
ok(call("submit_feedback", "bug", "The button is broken", "guest@example.com", {"page": "#home", "evil": "x" * 9999}))
fb = T.feedback.search()[0]
assert fb["name"] == "Guest" and fb["email"] == "guest@example.com" and "evil" not in fb["context"] and fb["status"] == "new"
for i in range(4):
    ok(call("submit_feedback", "idea", "Idea number %d" % i))
bad(call("submit_feedback", "idea", "One too many this hour"), "rate limit")
as_user(ana)
ok(call("submit_feedback", "nonsense-kind", "Signed-in feedback"))
assert T.feedback.get(message="Signed-in feedback")["kind"] == "other"
assert denied("list_feedback")
as_user(admin)
lst = call("list_feedback")
assert lst["counts"]["new"] == 6 and len(lst["items"]) == 6
fid = lst["items"][0]["id"]
ok(call("set_feedback_status", fid, "done", "Fixed it"))
assert call("list_feedback", "done")["items"][0]["note"] == "Fixed it"
bad(call("set_feedback_status", fid, "weird"))
bad(call("set_feedback_status", "nope", "done"))
ok(call("delete_feedback", fid))
assert len(call("list_feedback")["items"]) == 5

# ---------------------------------------------------------------------------------- admin
as_user(ana)
for fn, args in [("admin_overview", ()), ("list_users", ()), ("set_admin", (bob.get_id(), True)), ("demo_load", ()), ("demo_remove", ())]:
    assert denied(fn, *args), fn
as_user(admin)
ov = call("admin_overview")
assert ov["users"] == 3 and ov["admins"] == 1 and ov["feedback_new"] == 5 and len(ov["days"]) == 14
assert len(call("list_users")["users"]) == 3 and len(call("list_users", "bob")["users"]) == 1
ok(call("set_admin", bob.get_id(), True))
assert bob["is_admin"] is True
bad(call("set_admin", admin.get_id(), False), "can't remove your own admin")
ok(call("set_enabled", bob.get_id(), False))
assert bob["enabled"] is False
bad(call("set_enabled", admin.get_id(), False))
ok(call("set_enabled", bob.get_id(), True))
ok(call("set_admin", bob.get_id(), False))
assert bob["is_admin"] is False

# ---------------------------------------------------------------------------------- studio: sample project + demo templates
as_user(None)
assert denied("studio_home") and denied("planner_get") and denied("templates_list") and denied("video_create", {})
as_user(ana)
home = call("studio_home")
assert M["DemoData"].state() == "loaded", "demo templates load on first visit"
assert len(home["videos"]) == 2 and all(v["sample"] for v in home["videos"]), "a new account gets the sample project"
assert len(home["products"]) == 1 and home["products"][0]["name"] == "Pocket Garden"
assert home["stats"]["videos"] == 0, "samples don't count in stats"
assert len(home["badges"]) == len(M["Studio"].BADGES) and not any(b["got"] for b in home["badges"])
assert len(call("studio_home")["videos"]) == 2, "the sample is made only once"
sample = [v for v in home["videos"] if v["kind"] == "youtube"][0]
g = ok(call("video_get", sample["id"]))
assert len(g["takes"]) == 2 and g["product"]["name"] == "Pocket Garden"
garden = [t for t in g["takes"] if t["sample"] == "garden"][0]
assert garden["clicks"] and garden["markers"] and garden["mode"] == "screen_cam"
assert len(g["video"]["edit"]["scenes"]) == 4 and g["video"]["edit"]["scenes"][2]["take"] == garden["id"]
assert len(call("templates_list")["templates"]) == len(M["DemoData"].DEMO_TEMPLATES)

# ---------------------------------------------------------------------------------- products
bad(call("product_save", {"name": " "}))
prod = ok(call("product_save", {"name": "Tiny Ledger", "emoji": "x" * 30, "color": "javascript:alert(1)", "url": "tinyledger.example",
                                "tagline": "Split bills fairly", "features": "One\nTwo\nThree"}))["product"]
assert prod["url"] == "https://tinyledger.example" and prod["color"] == "#cc181e" and len(prod["emoji"]) <= 8
prod = ok(call("product_save", {"id": prod["id"], "name": "Tiny Ledger", "color": "#2e9d5b", "cta": "Try it"}))["product"]
assert prod["color"] == "#2e9d5b" and prod["cta"] == "Try it"
as_user(bob)
bad(call("product_save", {"id": prod["id"], "name": "Hijack"}), "can't edit someone else's app")
ok(call("product_delete", prod["id"]))
as_user(ana)
assert T.products.get_by_id(prod["id"]) is not None, "deleting someone else's app does nothing"

# ---------------------------------------------------------------------------------- videos
v = ok(call("video_create", {"title": "Tiny Ledger in 60 seconds", "kind": "short", "product_id": prod["id"], "due": "2026-11-20",
                             "script": "# Hook\nHi"}))["video"]
assert v["kind"] == "short" and v["status"] == "idea" and v["due"] == "2026-11-20" and v["product"]["id"] == prod["id"]
assert ok(call("video_create", {"title": ""}))["video"]["title"] == "Untitled video"
bad(call("video_create", {"title": "Bad date", "due": "next tuesday"}))
bad(call("video_create", {"title": "Bad app", "product_id": "nope"}))
assert len([x for x in T.videos.search(owner=ana) if x["title"] == "Bad date"]) == 0, "a failed create leaves nothing behind"
bad(call("video_update", v["id"], {"title": "x"}))
bad(call("video_update", v["id"], {"status": "viral"}))
bad(call("video_update", v["id"], {"youtube_url": "javascript:alert(1)"}))
bad(call("video_update", v["id"], {"thumb": "data:text/html;base64,AAAA"}))
ok(call("video_update", v["id"], {"thumb": "data:image/jpeg;base64,/9j/AAAA", "thumb_design": {"tpl": "nope", "text": "BIG", "color": "red"}}))
vv = call("video_get", v["id"])["video"]
assert vv["thumb"].startswith("data:image/jpeg") and vv["thumb_design"]["tpl"] == "bold" and vv["thumb_design"]["color"] == "#ffde00"
as_user(bob)
bad(call("video_get", v["id"]), "someone else's video is invisible")
bad(call("video_update", v["id"], {"title": "Mine now"}))
assert ok(call("video_delete", v["id"]))["free_keys"] == [] and T.videos.get_by_id(v["id"]) is not None
bad(call("take_add", v["id"], {"key": "k1", "duration": 5}))
as_user(ana)

# ---------------------------------------------------------------------------------- takes
bad(call("take_add", v["id"], {"key": "bad key!", "duration": 5}))
bad(call("take_add", v["id"], {"key": "sample-x", "duration": 5}), "sample keys are reserved")
bad(call("take_add", v["id"], {"key": "k1", "duration": 0.1}))
r = ok(call("take_add", v["id"], {"key": "k1", "label": "First", "mode": "screen_cam", "duration": 42.5, "cam_offset": 0.04,
                                  "main": {"w": 1920, "h": 1080, "type": "video/webm", "surface": "browser", "audio": True},
                                  "cam": {"w": 1280, "h": 720, "type": "video/webm", "surface": "camera"},
                                  "markers": [[3, "chapter", "Intro"], [1, "bogus", "x" * 200], ["nan", "chapter"]],
                                  "clicks": [[2, 0.5, 0.5], [1, 9, -3]], "bytes": 1234567, "device": "b123", "thumb": "data:image/jpeg;base64,/9j/AA",
                                  "source": "extension"}))
t1 = r["take"]
assert r["video"]["status"] == "recorded" and r["video"]["thumb"].startswith("data:image/jpeg"), "a first take moves the video on and gives it a picture"
assert t1["markers"][0][1] == "chapter" and len(t1["markers"][1][2]) <= 80 and t1["markers"][0][0] == 0, "markers are cleaned and sorted"
assert t1["clicks"][0] == [1, 1, 0], "clicks are clamped to the screen"
assert t1["source"] == "extension" and t1["main"]["surface"] == "browser"
t2 = ok(call("take_add", v["id"], {"key": "k2", "duration": 10, "mode": "cam"}))["take"]
assert t2["label"] == "Take 2"
ok(call("take_update", t1["id"], {"label": "Best", "starred": True, "clicks": [[5, 0.2, 0.3]]}))
assert T.takes.get_by_id(t1["id"])["starred"] and T.takes.get_by_id(t1["id"])["label"] == "Best"
as_user(bob)
bad(call("take_update", t1["id"], {"label": "x"}))
assert ok(call("take_delete", t1["id"]))["free_keys"] == [] and T.takes.get_by_id(t1["id"]) is not None
as_user(ana)

# ---------------------------------------------------------------------------------- the edit is cleaned
edit = {"aspect": "9:16", "layout": "stack", "bg": "<script>", "pad": 5, "cam": {"pos": "zz", "size": 9},
        "scenes": [{"id": "s1", "type": "card", "style": "bold", "title": "Hello", "dur": 99, "color": "#123456"},
                   {"id": "s2", "type": "take", "take": t1["id"], "in": 1, "out": 30, "cuts": [[5, 6], [2, 2.01], [9, 8]], "speed": 9,
                    "zooms": [{"s": 2, "e": 4, "z": 9, "pts": [[2, 0.4, 2]]}, {"s": 1, "e": 1.1}],
                    "texts": [{"id": "t", "s": 1, "e": 3, "text": "Hi", "style": "lower"}, {"text": ""}], "cam": {"hidden": True}},
                   {"id": "s3", "type": "take", "take": "someone-elses", "in": 0, "out": 5},
                   {"id": "bad id!", "type": "card"}, "junk"]}
e = ok(call("video_update", v["id"], {"edit": edit, "duration": 31.5}))["video"]["edit"]
assert e["aspect"] == "9:16" and e["bg"] == "red" and e["pad"] == 0.16 and e["cam"]["pos"] == "br" and e["cam"]["size"] == 0.5
assert [sc["id"] for sc in e["scenes"]] == ["s1", "s2"], "unknown takes and broken scenes are dropped"
assert e["scenes"][0]["dur"] == 20 and e["scenes"][1]["speed"] == 2 and e["scenes"][1]["cuts"] == [[5, 6]]
assert len(e["scenes"][1]["zooms"]) == 1 and e["scenes"][1]["zooms"][0]["z"] == 3 and e["scenes"][1]["zooms"][0]["pts"][0][2] == 1
assert len(e["scenes"][1]["texts"]) == 1 and e["scenes"][1]["cam"] == {"hidden": True}
too_many = {"scenes": [{"id": "c%d" % i, "type": "card", "title": "x"} for i in range(200)]}
assert len(ok(call("video_update", v["id"], {"edit": too_many}))["video"]["edit"]["scenes"]) == M["Clean"].MAX_SCENES
ok(call("video_update", v["id"], {"edit": edit}))

# ---------------------------------------------------------------------------------- captions, boxes, music, sound effects
e2 = dict(edit, captions={"on": 1, "style": "bold", "pos": "nowhere", "size": 9, "color": "red"}, voice_fx="robot",
          music={"vol": 0.3, "gen": "lofi"}, sfx={"clicks": True, "whoosh": 0, "vol": 5})
e2["scenes"] = [dict(edit["scenes"][1], boxes=[{"id": "b1", "s": 2, "e": 6, "x": 0.9, "y": -1, "w": 0.5, "h": 0.2, "kind": "spot"},
                                              {"s": 1, "e": 1.05}, {"s": 0, "e": 9, "kind": "evil"}] + [{"s": 0, "e": 5}] * 40),
                {"id": "c9", "type": "card", "style": "endscreen", "title": "Watch next", "dur": 18}]
e = ok(call("video_update", v["id"], {"edit": e2}))["video"]["edit"]
assert e["captions"] == {"on": True, "style": "bold", "pos": "bottom", "size": 1.8, "upper": False, "color": "#ffde00"}
assert e["voice_fx"] == "off" and e["music"]["gen"] == "lofi" and e["sfx"] == {"clicks": True, "whoosh": False, "vol": 1}
bx = e["scenes"][0]["boxes"]
assert len(bx) == M["Clean"].MAX_BOXES - 1 and bx[0]["kind"] == "spot" and bx[0]["y"] == 0 and bx[0]["x"] + bx[0]["w"] <= 1.0001
assert bx[1]["kind"] == "blur", "unknown box kinds become blur; boxes shorter than 0.2 s are dropped"
assert e["scenes"][1]["style"] == "endscreen" and e["scenes"][1]["dur"] == 18
ok(call("video_update", v["id"], {"edit": edit}))

# ---------------------------------------------------------------------------------- looks, frames, voice presets
e3 = dict(edit, voice_fx="broadcast",
          look={"on": 1, "target": "everything", "lut": "teal", "amt": 4, "exposure": 9, "contrast": -3, "smooth": 0.4, "grain": "x",
                "light": {"on": True, "x": 2, "power": 0.6}, "crop": {"z": 9, "mirror": 1}, "evil": "<script>"},
          frames=[{"id": "f1", "style": "desk", "title": "Ana " * 40, "sub": "Line one\nLine two", "color": "red", "tin": "slide_l", "tout": "warp",
                   "all": False, "s": 4, "e": 3, "font": "comic"},
                  {"style": "ticker", "ticker": "A | B", "clock": 1}, {"style": "hologram"}, "junk"] + [{"style": "bug"}] * 20)
e = ok(call("video_update", v["id"], {"edit": e3}))["video"]["edit"]
lk = e["look"]
assert e["voice_fx"] == "broadcast"
assert lk["on"] is True and lk["target"] == "cam" and lk["lut"] == "teal" and lk["amt"] == 1 and lk["exposure"] == 2 and lk["contrast"] == -1
assert lk["grain"] == 0 and lk["light"]["x"] == 1 and lk["light"]["on"] is True and lk["crop"] == {"z": 2.5, "x": 0.5, "y": 0.5, "mirror": True}
assert "evil" not in lk
assert ok(call("video_update", v["id"], {"edit": dict(edit, look={"on": True, "lut": "cube"})}))["video"]["edit"]["look"]["lut"] == "none", \
    "a .cube look needs the file's name"
fr = e["frames"]
assert len(fr) == M["Clean"].MAX_FRAMES - 2, "unknown styles and junk are dropped; at most 12 are read (%d)" % len(fr)
assert fr[0]["id"] == "f1" and len(fr[0]["title"]) == 90 and fr[0]["sub"] == "Line one\nLine two" and fr[0]["color"] == "#cc181e"
assert fr[0]["tout"] == "fade" and fr[0]["font"] == "condensed" and fr[0]["e"] > fr[0]["s"] and fr[0]["all"] is False
assert fr[1]["style"] == "ticker" and fr[1]["all"] is True and fr[1]["clock"] is True and fr[1]["id"]
assert len(set(f["id"] for f in fr)) == len(fr), "every frame gets its own id"
ok(call("video_update", v["id"], {"edit": edit}))

# ---------------------------------------------------------------------------------- saved frames and looks (presets)
assert call("presets_list")["presets"] == []
bad(call("preset_save", {"kind": "frame", "name": "Empty", "data": {"layers": [{"style": "nope"}]}}), "an empty frame set isn't saved")
bad(call("preset_save", {"kind": "font", "name": "What"}))
bad(call("preset_save", {"kind": "look", "name": "x"}), "a name is needed")
ps = ok(call("preset_save", {"kind": "frame", "name": "My newsroom", "emoji": "📺",
                             "data": {"layers": [{"style": "bug", "logo": "Ana", "id": "ignored"}, {"style": "ticker", "ticker": "Hi"}]}}))["preset"]
assert ps["kind"] == "frame" and len(ps["data"]["layers"]) == 2 and "id" not in ps["data"]["layers"][0]
pl = ok(call("preset_save", {"kind": "look", "name": "Desk lamp", "data": {"lut": "warm", "temp": -0.4, "on": False}}))["preset"]
assert pl["data"]["on"] is True and pl["data"]["lut"] == "warm" and pl["data"]["temp"] == -0.4, "a saved look is always on"
assert [p["id"] for p in call("presets_list", "look")["presets"]] == [pl["id"]]
assert len(call("presets_list")["presets"]) == 2
ok(call("preset_save", {"id": ps["id"], "kind": "frame", "name": "Renamed", "data": {"layers": [{"style": "rec"}]}}))
assert T.presets.get_by_id(ps["id"])["name"] == "Renamed"
bad(call("preset_save", {"id": ps["id"], "kind": "look", "name": "Switch kind", "data": {}}), "a frame preset can't turn into a look")
ok(call("preset_used", ps["id"]))
assert T.presets.get_by_id(ps["id"])["uses"] == 1
as_user(bob)
assert call("presets_list")["presets"] == [], "presets are private"
bad(call("preset_save", {"id": ps["id"], "kind": "frame", "name": "Mine now", "data": {"layers": [{"style": "rec"}]}}))
ok(call("preset_delete", ps["id"]))
ok(call("preset_used", ps["id"]))
assert T.presets.get_by_id(ps["id"]) is not None and T.presets.get_by_id(ps["id"])["uses"] == 1, "someone else can't delete or count it"
as_user(None)
assert denied("presets_list") and denied("preset_save", {"kind": "look", "name": "Anon"})
as_user(ana)
ok(call("preset_delete", pl["id"]))
assert T.presets.get_by_id(pl["id"]) is None

# ---------------------------------------------------------------------------------- transcripts (captions) on takes
words = {"src": "whisper", "lang": "en", "words": [[1.2, 1.5, "hello"], [0.2, 0.5, "Um,"], [2, 1, "x" * 99], [3, 4, ""], "junk", [5, 6, "world"]]}
tk = ok(call("take_update", t1["id"], {"words": words}))["take"]
assert tk["words"]["src"] == "whisper" and [w[2] for w in tk["words"]["words"]] == ["Um,", "hello", "x" * 40, "world"], tk["words"]
assert tk["words"]["words"][2][1] > tk["words"]["words"][2][0], "a word always ends after it starts"
assert ok(call("take_update", t1["id"], {"words": {"src": "bogus", "words": [[0, 1, "hi"]]}}))["take"]["words"]["src"] == "typed"
big = {"src": "script", "words": [[i * 0.3, i * 0.3 + 0.2, "w"] for i in range(20000)]}
assert len(ok(call("take_update", t1["id"], {"words": big}))["take"]["words"]["words"]) == M["Clean"].MAX_WORDS
assert ok(call("take_update", t1["id"], {"words": None}))["take"]["words"] is None
ok(call("take_update", t1["id"], {"words": words}))
assert any(b["key"] == "wordsmith" and b["got"] for b in call("studio_home")["badges"]), "captions earn the Wordsmith badge"
as_user(bob)
bad(call("take_update", t1["id"], {"words": words}))
as_user(ana)

# ---------------------------------------------------------------------------------- script versions + priority
sv = ok(call("video_update", v["id"], {"script": "# Hook\nVersion two", "priority": 9}))["video"]
assert sv["priority"] == 3 and len(sv["script_versions"]) == 1 and sv["script_versions"][0]["text"] == "# Hook\nHi"
sv = ok(call("video_update", v["id"], {"script": "# Hook\nVersion three"}))["video"]
assert len(sv["script_versions"]) == 1, "one version per 10 minutes of writing"
sv = ok(call("video_update", v["id"], {"script": "# Hook\nVersion four", "snapshot": True}))["video"]
assert [x["text"] for x in sv["script_versions"]] == ["# Hook\nVersion three", "# Hook\nHi"], "snapshot keeps a version right away"
for i in range(20):
    call("video_update", v["id"], {"script": "v%d" % i, "snapshot": True})
assert len(call("video_get", v["id"])["video"]["script_versions"]) == M["Studio"].MAX_VERSIONS
assert ok(call("video_update", v["id"], {"priority": "x"}))["video"]["priority"] == 0
assert ok(call("video_create", {"title": "Hot idea", "priority": 2}))["video"]["priority"] == 2

# ---------------------------------------------------------------------------------- publish kit + publishing + badges
pub = ok(call("video_update", v["id"], {"publish": {"title": "T" * 300, "description": "Line\n" * 2000, "tags": "a,b", "titles": ["One", "", "Two"],
                                                     "checks": {"thumb": True, "bad key!": True}, "yt": {"id": "<script>"}}}))["video"]["publish"]
assert len(pub["title"]) == 100 and len(pub["description"]) <= 5000 and pub["titles"] == ["One", "Two"] and pub["checks"] == {"thumb": True}
assert pub["yt"] == {}, "a bad YouTube id is dropped"
r = ok(call("video_update", v["id"], {"publish": dict(pub, yt={"id": "dQw4w9WgXcQ", "privacy": "weird", "at": "2026-10-31T10:00:00Z", "thumb": 1}),
                                      "status": "published", "youtube_url": "https://youtu.be/dQw4w9WgXcQ"}))
assert r["video"]["publish"]["yt"]["id"] == "dQw4w9WgXcQ" and r["video"]["publish"]["yt"]["privacy"] == "private" and r["video"]["publish"]["yt"]["thumb"] is True
assert {"direct", "on_air"} <= {b["key"] for b in r["new_badges"]}, r["new_badges"]
ok(call("video_update", v["id"], {"status": "edited", "publish": dict(pub, yt={})}))
r = ok(call("video_update", v["id"], {"status": "published", "youtube_url": "https://youtu.be/abc"}))
assert r["video"]["published_at"] and [b["key"] for b in r["new_badges"]] == ["on_air"], r["new_badges"]
assert ok(call("video_update", v["id"], {"status": "edited"}))["video"]["published_at"] is None
r = ok(call("export_logged", v["id"], {"seconds": 31.5, "aspect": "9:16", "format": "mp4", "quality": "1080"}))
assert any(b["key"] == "first_cut" for b in r["new_badges"]) and r["stats"]["exports"] == 1
st = call("studio_home")["stats"]
assert st["videos"] == 3 and st["takes"] == 2 and st["vertical"] == 1 and st["minutes"] == round(52.5 / 60, 1)
as_user(bob)
bad(call("export_logged", v["id"], {}))
as_user(ana)

# ---------------------------------------------------------------------------------- weekly goal
ok(call("video_update", v["id"], {"status": "published"}))
g1 = ok(call("set_goal", 99))
assert g1["stats"]["goal"] == 14 and g1["stats"]["week"] == 1 and g1["new_badges"] == []
g1 = ok(call("set_goal", 1))
assert g1["stats"]["goal"] == 1 and [b["key"] for b in g1["new_badges"]] == ["goal"], g1["new_badges"]
assert ok(call("set_goal", "nope"))["stats"]["goal"] == 0
ok(call("set_goal", 2))
as_user(None)
assert denied("set_goal", 1)
as_user(ana)

# ---------------------------------------------------------------------------------- remix (a Short from a video) + deleting
src_v = ok(call("video_create", {"title": "Long tour", "kind": "youtube"}))["video"]
tt = ok(call("take_add", src_v["id"], {"key": "k9", "duration": 20, "mode": "screen"}))["take"]
ok(call("video_update", src_v["id"], {"edit": {"aspect": "16:9", "scenes": [{"id": "a1", "type": "take", "take": tt["id"], "in": 0, "out": 20}]}, "status": "edited"}))
rm = ok(call("video_remix", src_v["id"], "short"))["video"]
assert rm["kind"] == "short" and rm["status"] == "recorded" and rm["takes"] == 1 and "(Short)" in rm["title"]
rme = call("video_get", rm["id"])
assert rme["video"]["edit"]["aspect"] == "9:16" and rme["video"]["edit"]["layout"] == "stack" and rme["video"]["edit"]["scenes"][0]["take"] == rme["takes"][0]["id"]
clipv = ok(call("video_remix", src_v["id"], "short", {"take": tt["id"], "in": 4, "out": 11.5, "title": "Chapter two"}))["video"]
assert clipv["title"] == "Chapter two" and clipv["duration"] == 7.5 and clipv["takes"] == 1 and clipv["kind"] == "short"
ce = call("video_get", clipv["id"])
assert len(ce["video"]["edit"]["scenes"]) == 1 and ce["video"]["edit"]["scenes"][0]["in"] == 4 and ce["video"]["edit"]["scenes"][0]["out"] == 11.5
assert ce["video"]["edit"]["aspect"] == "9:16"
bad(call("video_remix", src_v["id"], "short", {"take": tt["id"], "in": 4, "out": 4.5}), "too short for a clip")
bad(call("video_remix", src_v["id"], "short", {"take": t2["id"], "in": 0, "out": 5}), "the take must belong to this video")
ok(call("video_delete", clipv["id"]))
assert ok(call("video_delete", src_v["id"]))["free_keys"] == [], "the remix still uses k9, so its files stay"
assert ok(call("take_delete", rme["takes"][0]["id"]))["free_keys"] == ["k9"], "the last take using k9 frees its files"
assert ok(call("video_delete", v["id"]))["free_keys"] == ["k1", "k2"]
as_user(bob)
bad(call("video_remix", rm["id"], "reel"))
as_user(ana)
assert ok(call("sample_create"))["video"]["sample"]
ok(call("set_handle", "my channel"))
assert call("studio_home")["handle"] == "@mychannel"
assert any(x["title"] == rm["title"] for x in call("planner_get")["videos"])
ok(call("product_delete", prod["id"]))
assert T.products.get_by_id(prod["id"]) is None

# ---------------------------------------------------------------------------------- script templates (admin)
assert denied("admin_templates") and denied("admin_template_save", {"name": "x"}) and denied("admin_template_delete", "x")
as_user(admin)
bad(call("admin_template_save", {"name": "No body", "body": "short"}))
tpl = ok(call("admin_template_save", {"name": "Weekly recap", "emoji": "📅", "kind": "devlog", "body": "# Recap\nThis week in {app}: {feature1}.", "featured": True}))["template"]
assert tpl["featured"] and tpl["by"] == "The Admin"
ok(call("admin_template_save", {"id": tpl["id"], "name": "Weekly recap", "body": "# Recap\nThis week in {app}: {feature1}.", "hidden": True, "featured": True}))
as_user(ana)
assert all(x["id"] != tpl["id"] for x in call("templates_list")["templates"]), "hidden templates aren't listed"
ok(call("template_used", "nope"))
as_user(admin)
ok(call("admin_template_save", {"id": tpl["id"], "name": "Weekly recap", "body": "# Recap\nThis week in {app}: {feature1}.", "hidden": False, "featured": True}))
as_user(ana)
assert call("templates_list")["templates"][0]["id"] == tpl["id"], "featured templates come first"
ok(call("template_used", tpl["id"]))
assert T.script_templates.get_by_id(tpl["id"])["uses"] == 1
as_user(admin)
ok(call("admin_template_delete", tpl["id"]))
assert call("admin_overview")["exports"] == 1, "exports are counted (takes were deleted above)"

# ---------------------------------------------------------------------------------- app settings (YouTube client id, store link)
as_user(ana)
assert denied("admin_settings_get") and denied("admin_settings_save", {})
as_user(None)
assert call("public_config") == {"google_client_id": "", "extension_store_url": ""}
as_user(admin)
bad(call("admin_settings_save", {"google_client_id": "not-a-client-id"}))
bad(call("admin_settings_save", {"extension_store_url": "https://evil.example/x"}))
cfg = ok(call("admin_settings_save", {"google_client_id": "123456789012-abcdefghijklmnop.apps.googleusercontent.com",
                                       "extension_store_url": "https://chromewebstore.google.com/detail/videoblog-buddy/abcdefghijklmnopabcdefghijklmnop"}))["settings"]
assert cfg["google_client_id"].endswith(".apps.googleusercontent.com")
as_user(None)
assert call("public_config")["extension_store_url"].startswith("https://chromewebstore.google.com/")
as_user(admin)
assert "transcribed" in call("admin_overview") and "uploads" in call("admin_overview")

# ---------------------------------------------------------------------------------- demo data: remove / reload
ok(call("demo_remove"))
assert M["DemoData"].state() == "removed" and not T.script_templates.search(is_demo=True) and not T.users.search(is_demo=True)
as_user(ana)
call("templates_list")
assert M["DemoData"].state() == "removed", "removed demo data doesn't come back by itself"
as_user(admin)
ok(call("demo_load"))
ok(call("demo_load"))
assert len(T.script_templates.search(is_demo=True)) == len(M["DemoData"].DEMO_TEMPLATES), "reloading replaces the demo instead of doubling it"

# ---------------------------------------------------------------------------------- Privacy & Terms
if "legal_server" in M:
    as_user(ana)
    st = call("legal_state")
    assert st["signedIn"] and st["accepted_version"] is None
    ok(call("legal_accept", st["version"], "signup"))
    assert ana["legal_source"] == "signup" and call("legal_state")["accepted_version"] == st["version"]

# ---------------------------------------------------------------------------------- every callable is covered by a permission check
# A callable that changes data without require_user / a C.require_* check is a security hole. List the public ones here.
PUBLIC = {"get_me", "submit_feedback", "legal_state", "legal_accept", "public_config"}
for name, (f, need) in sorted(anvil.server.CALLABLES.items()):
    if name in PUBLIC:
        continue
    assert need, "%s is callable by anyone: add require_user=True (or list it in PUBLIC in test_server.py)" % name

print("ALL OK (%d server functions)" % len(anvil.server.CALLABLES))
