"""Script templates added by admins (shown next to the built-in ones in web/pages/_d_kit.html).
Bodies use the same placeholders as the built-ins: {app} {tagline} {audience} {feature1} {feature2} {feature3}
{cta} {url} {handle}."""
import anvil.server
from anvil.tables import app_tables
import anvil.tables as tables

from . import common as C
from . import Clean, DemoData


def _tpl(r, admin=False):
    out = {"id": r.get_id(), "name": r["name"] or "", "emoji": r["emoji"] or "", "kind": r["kind"] or "youtube",
           "blurb": r["blurb"] or "", "body": r["body"] or "", "featured": bool(r["featured"]), "uses": r["uses"] or 0,
           "by": C.name_of(r["owner"]) if r["owner"] is not None else "VideoBlog Buddy"}
    if admin:
        out.update({"hidden": bool(r["hidden"]), "demo": bool(r["is_demo"]), "created": C.iso(r["created"])})
    return out


@anvil.server.callable(require_user=True)
def templates_list():
    C.require_user()
    DemoData.ensure_loaded()
    rows = [r for r in app_tables.script_templates.search(tables.order_by("created", ascending=False)) if not r["hidden"]]
    rows.sort(key=lambda r: (not r["featured"],))
    return {"templates": [_tpl(r) for r in rows[:100]]}


@anvil.server.callable(require_user=True)
def template_used(template_id):
    C.require_user()
    r = C.row_by_id(app_tables.script_templates, template_id)
    if r is None or r["hidden"]:
        return C.ok()
    if not C.rate_limited("tpl_use_" + str(template_id), 3, 3600):
        r["uses"] = (r["uses"] or 0) + 1
    return C.ok()


@anvil.server.callable(require_user=True)
def admin_templates():
    C.require_admin()
    return {"templates": [_tpl(r, True) for r in app_tables.script_templates.search(tables.order_by("created", ascending=False))]}


@anvil.server.callable(require_user=True)
def admin_template_save(data):
    me = C.require_admin()
    data = data if isinstance(data, dict) else {}
    name = C.text(data.get("name"), 60)
    body = C.text(data.get("body"), 8000, multiline=True)
    if len(name) < 2:
        return C.fail("Give the template a name.")
    if len(body) < 20:
        return C.fail("The script needs at least a few lines.")
    fields = {"name": name, "emoji": C.text(data.get("emoji"), 8), "kind": Clean.pick(data.get("kind"), Clean.KINDS, "youtube"),
              "blurb": C.text(data.get("blurb"), 160), "body": body, "featured": bool(data.get("featured")),
              "hidden": bool(data.get("hidden"))}
    if data.get("id"):
        r = C.row_by_id(app_tables.script_templates, data.get("id"))
        if r is None:
            return C.fail("That template no longer exists.")
        r.update(**fields)
    else:
        r = app_tables.script_templates.add_row(owner=me, uses=0, created=C.now(), is_demo=False, **fields)
    return C.ok(template=_tpl(r, True))


@anvil.server.callable(require_user=True)
def admin_template_delete(template_id):
    C.require_admin()
    r = C.row_by_id(app_tables.script_templates, template_id)
    if r is not None:
        r.delete()
    return C.ok()
