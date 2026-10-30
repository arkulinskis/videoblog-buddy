"""Admin page callables: overview + usage, users (make admin, disable), demo data. Admins only.
Feedback admin calls live in Feedback.py, script templates in Templates.py."""
import datetime as dt

import anvil.server
from anvil.tables import app_tables
import anvil.tables as tables

from . import common as C
from . import DemoData, Feedback


@anvil.server.callable(require_user=True)
def admin_overview():
    C.require_admin()
    real_users = [u for u in app_tables.users.search() if not u["is_demo"]]
    takes = [t for t in app_tables.takes.search() if not t["sample"]]
    videos = [v for v in app_tables.videos.search() if not v["sample"]]
    exports = list(app_tables.exports.search())
    week = C.now() - dt.timedelta(days=7)
    active = len([u for u in real_users if u["last_seen"] is not None and u["last_seen"] >= week])
    days = []
    today = C.now().date()
    for i in range(13, -1, -1):
        d = today - dt.timedelta(days=i)
        days.append({"day": d.isoformat(),
                     "takes": len([t for t in takes if t["created"] and t["created"].date() == d]),
                     "exports": len([e for e in exports if e["created"] and e["created"].date() == d])})
    return {"users": len(real_users),
            "admins": len(app_tables.users.search(is_admin=True)),
            "active_week": active,
            "feedback_new": Feedback.new_count(),
            "videos": len(videos),
            "published": len([v for v in videos if v["status"] == "published"]),
            "takes": len(takes),
            "minutes": round(sum((t["duration"] or 0) for t in takes) / 60.0, 1),
            "exports": len(exports),
            "vertical": len([e for e in exports if e["aspect"] == "9:16"]),
            "products": len(app_tables.products.search()),
            "templates": len(app_tables.script_templates.search()),
            "extension_takes": len([t for t in takes if t["source"] == "extension"]),
            "days": days,
            "demo": {"state": DemoData.state(), "counts": DemoData.counts()}}


def _user(u):
    return {"id": u.get_id(), "email": u["email"], "name": C.name_of(u), "is_admin": C.is_admin(u),
            "enabled": u["enabled"] is not False, "joined": C.iso(u["signed_up"]), "last_seen": C.iso(u["last_seen"])}


@anvil.server.callable(require_user=True)
def list_users(query=None):
    C.require_admin()
    query = C.text(query, 80).lower()
    rows = [u for u in app_tables.users.search(tables.order_by("signed_up", ascending=False)) if not u["is_demo"]]
    if query:
        rows = [u for u in rows if query in (u["email"] or "").lower() or query in (u["display_name"] or "").lower()]
    return {"users": [_user(u) for u in rows[:200]], "total": len(rows)}


@anvil.server.callable(require_user=True)
def set_admin(user_id, flag):
    me = C.require_admin()
    u = C.row_by_id(app_tables.users, user_id)
    if u is None:
        return C.fail("That account no longer exists.")
    if u == me and not flag:
        return C.fail("You can't remove your own admin rights.")
    u["is_admin"] = bool(flag)
    return C.ok(user=_user(u))


@anvil.server.callable(require_user=True)
def set_enabled(user_id, flag):
    me = C.require_admin()
    u = C.row_by_id(app_tables.users, user_id)
    if u is None:
        return C.fail("That account no longer exists.")
    if u == me:
        return C.fail("You can't disable your own account.")
    u["enabled"] = bool(flag)
    return C.ok(user=_user(u))


@anvil.server.callable(require_user=True)
def demo_load():
    C.require_admin()
    DemoData.load()
    return C.ok(demo={"state": DemoData.state(), "counts": DemoData.counts()})


@anvil.server.callable(require_user=True)
def demo_remove():
    C.require_admin()
    DemoData.remove()
    return C.ok(demo={"state": DemoData.state(), "counts": DemoData.counts()})
