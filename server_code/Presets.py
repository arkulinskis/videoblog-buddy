"""Saved frames and looks, so a person can reuse them in every video.

kind "frame": a set of on-screen frame layers {layers: [...]} (one frame or several at once).
kind "look":  a colour look (LUT name, light and colour fixes, key light, reframe).
The built-in ones live in the browser (VB.FRAME_SETS, VB.LOOKS in web/pages/_i_studio.html); only your own are stored here.
Shapes are cleaned by Clean.preset.
"""
import anvil.server
from anvil.tables import app_tables
import anvil.tables as tables

from . import common as C
from . import Clean
from .Studio import _own

MAX_PER_KIND = 60


def _preset(r):
    return {"id": r.get_id(), "kind": r["kind"], "name": r["name"] or "", "emoji": r["emoji"] or "", "data": r["data"] or {},
            "uses": r["uses"] or 0, "updated": C.iso(r["updated"])}


@anvil.server.callable(require_user=True)
def presets_list(kind=None):
    """Your saved frames and looks (newest first). kind: "frame", "look" or None for both."""
    me = C.require_user()
    rows = app_tables.presets.search(tables.order_by("updated", ascending=False), owner=me)
    return {"presets": [_preset(r) for r in rows if kind in (None, r["kind"])]}


@anvil.server.callable(require_user=True)
def preset_save(data):
    """Save a new preset (no id) or replace one of yours (id). data: {id?, kind, name, emoji, data}."""
    me = C.require_user()
    data = data if isinstance(data, dict) else {}
    kind = data.get("kind")
    if kind not in Clean.PRESET_KINDS:
        return C.fail("Save a frame or a look.")
    name = C.text(data.get("name"), 60)
    if len(name) < 2:
        return C.fail("Give it a name (at least 2 characters).")
    body = Clean.preset(kind, data.get("data"))
    if kind == "frame" and not body["layers"]:
        return C.fail("There's no frame to save. Add a frame first.")
    fields = {"name": name, "emoji": C.text(data.get("emoji"), 8), "data": body, "updated": C.now()}
    if data.get("id"):
        r = _own(app_tables.presets, data.get("id"), me)
        if r is None or r["kind"] != kind:
            return C.fail("That isn't one of your saved " + kind + "s.")
        r.update(**fields)
    else:
        if C.rate_limited("preset_save", 120, 3600):
            return C.fail("That's a lot of saving in one hour. Try again in a little while.")
        if len(app_tables.presets.search(owner=me, kind=kind)) >= MAX_PER_KIND:
            return C.fail("You have %d saved %ss, the most there can be. Delete one you no longer use." % (MAX_PER_KIND, kind))
        r = app_tables.presets.add_row(owner=me, kind=kind, uses=0, created=C.now(), is_demo=False, **fields)
    return C.ok(preset=_preset(r))


@anvil.server.callable(require_user=True)
def preset_used(preset_id):
    """Count a use (it sorts your most used first)."""
    me = C.require_user()
    r = _own(app_tables.presets, preset_id, me)
    if r is not None:
        r["uses"] = (r["uses"] or 0) + 1
    return C.ok()


@anvil.server.callable(require_user=True)
def preset_delete(preset_id):
    me = C.require_user()
    r = _own(app_tables.presets, preset_id, me)
    if r is not None:
        r.delete()
    return C.ok()
