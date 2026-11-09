"""VideoBlog Buddy's JavaScript engines (theme/assets/vb-*.js, window.VB) seen from Python.

The engines record (screen + camera), keep recordings in this browser (VB.vault, IndexedDB: they never reach the
server), play and export edits on a canvas, grade colours (WebGL), write captions, talk to the browser extension
(VB.ext) and upload to YouTube. The record, video and edit pages are whole engine screens (vb-screens.js, mounted by
Components/Screen); every other page is Python and reaches the engines only through this module:

    vb.setup()              once at start-up: the server bridge (UI.api in the engines) and VB.host (Python dialogs)
    vb.VB                   window.VB itself; a JS promise returned to Python is already awaited
    vb.py_value(x)          a JS object/array as plain Python dicts/lists (for RepeatingPanel items)
    vb.js_value(x)          a Python dict/list as a real JS object (to hand to the engines)
    vb.new_video(...)       the New video dialog (also used by the planner and the apps page)
    vb.delete_video(v)      confirm, delete on the server, drop the recordings only it used from this browser
"""
import json

import anvil.js
import anvil.server
from anvil import alert, confirm
from anvil.js import window

from . import router, state

VB = window.VB
UI = window.UI


def py_value(x):
    """JS -> plain Python (dicts, lists, str, numbers). None stays None."""
    if x is None:
        return None
    return json.loads(window.JSON.stringify(x))


def js_value(x):
    """Python -> a real JS object (not a proxy of a Python dict)."""
    return window.JSON.parse(json.dumps(x))


# ---------------------------------------------------------------- server calls for the engines (UI.api)
def _bridge(kind, payload_json):
    """Called from JS. Always returns a JSON string: {"result": ...} or {"error": ...}."""
    p = json.loads(payload_json) if payload_json else {}
    try:
        if kind == "call":
            call = anvil.server.call_s if p.get("quiet") else anvil.server.call
            return json.dumps({"result": call(p["fn"], *(p.get("args") or []))})
        return json.dumps({"error": "Unknown request: %s" % kind})
    except Exception as e:
        kind_of = type(e).__name__  # (some of Anvil's exception classes aren't in the validator's stubs)
        if kind_of == "SessionExpiredError":
            return json.dumps({"error": "Your session expired. Reload the page and sign in again.", "reload": True})
        if kind_of == "AppOfflineError":
            return json.dumps({"error": "You seem to be offline. Check your connection and try again."})
        if kind_of == "PermissionDenied":
            return json.dumps({"error": str(e) or "You don't have access to that.", "denied": True})
        print("bridge %s %s failed: %r" % (kind, p.get("fn", ""), e))
        return json.dumps({"error": "Something went wrong. Please try again.", "detail": repr(e)[:300]})


# ---------------------------------------------------------------- VB.host: what the engines ask Python to show
def _toast(message, kind=""):
    state.toast(message, kind or None)


def _confirm(options_json):
    o = json.loads(options_json or "{}")
    return bool(confirm(o.get("text") or "", title=o.get("title") or "Are you sure?",
                        buttons=[(o.get("cancel") or "Cancel", False), (o.get("ok") or "OK", True)], role="app-dialog"))


def video_menu(video_json):
    """The "⋯" actions on a video (Dialogs/VideoMenu), then Shorts from chapters (Dialogs/Clips) or delete if picked.
    True when something changed (deleted, Shorts made): the caller reloads."""
    from .Dialogs.VideoMenu import VideoMenu
    v = json.loads(video_json) if isinstance(video_json, str) else video_json
    pick = alert(VideoMenu(video=v), buttons=[], role="app-dialog", dismissible=True)
    if pick == "delete":
        return delete_video(v)
    if pick == "clips":
        return clips_dialog(v)
    return bool(pick)


def clips_dialog(video):
    """One vertical Short per chapter marker of the video's takes."""
    from .Dialogs.Clips import Clips, clips_of
    r = state.call("video_get", video["id"])
    if not r:
        return False
    clips = clips_of(video, r)
    if not clips:
        state.toast("No chapter markers yet. Press M while recording (or add markers) to mark the best moments.")
        return False
    return bool(alert(Clips(video=video, clips=clips), buttons=[], large=True, role="app-dialog", dismissible=True))


def _go(target_hash):
    router.show()


def setup():
    window.VB_BRIDGE = _bridge
    VB.host = js_value({})
    for name, fn in (("toast", _toast), ("confirm", _confirm), ("video_menu", video_menu), ("go", _go)):
        VB.host[name] = fn


def set_me(me):
    """The engines read UI.me (the watermark name, the extension bridge)."""
    UI.me = js_value(me) if me else None


# ---------------------------------------------------------------- small engine helpers for the Forms
def kinds():
    return py_value(VB.KINDS)


def kind(key):
    return py_value(VB.kind(key or "youtube"))


def statuses():
    return py_value(VB.STATUSES)


def templates():
    return py_value(VB.TEMPLATES)


def fill(body, product, handle):
    return str(VB.fill(body or "", js_value(product) if product else None, handle or ""))


def ideas_for(product):
    return py_value(VB.ideasFor(js_value(product)))


def mix(color, amount):
    return str(VB.mix(color or "#cc181e", amount))


def fmt_time(seconds):
    return str(VB.fmtTime(seconds or 0))


def fmt_bytes(n):
    return str(VB.fmtBytes(n or 0))


def thumb_html(video, show_status=True):
    return str(VB.thumbHtml(js_value(video), js_value({"status": show_status})))


def app_chip_html(product):
    return str(VB.appChip(js_value(product) if product else None))


def badge_pop(new_badges):
    if new_badges:
        VB.badgePop(js_value(new_badges))


def confetti():
    VB.confetti()


def is_vertical(kind_key):
    return bool(VB.isVertical(kind_key or "youtube"))


# ---------------------------------------------------------------- shared actions
def new_video(products=None, **opts):
    """The New video dialog. opts: product_id, kind, status, title, script, due, handle, tpl, go (default True: open
    the new video). Returns the new video (dict) or None."""
    from .Dialogs.NewVideo import NewVideo
    video = alert(NewVideo(products=products or [], opts=opts), buttons=[], large=True, role="app-dialog",
                  dismissible=True)
    if video and opts.get("go", True):
        router.go("video", video["id"])
    return video


def delete_video(video):
    """Ask, delete it on the server, then drop the recordings only this video used from this browser."""
    if not confirm("Its plan, script and edit are deleted. Recordings only this video uses are removed from this "
                   "computer too.", title="Delete \u201c%s\u201d?" % video.get("title", ""),
                   buttons=[("Cancel", False), ("Delete", True)], role="app-dialog"):
        return False
    r = state.call("video_delete", video["id"])
    if r is None:
        return False
    for k in r.get("free_keys") or []:
        VB.vault.dropTake(k)
    state.toast("Deleted", "ok")
    return True
