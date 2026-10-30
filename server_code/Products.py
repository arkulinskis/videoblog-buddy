"""The apps (products) a person makes videos about: name, emoji, colour, link, pitch, features, call to action.
The script templates, idea generator and publish kit fill themselves in from these."""
import anvil.server
from anvil.tables import app_tables

from . import common as C
from . import Clean
from .Studio import product_dict, _own


@anvil.server.callable(require_user=True)
def product_save(data):
    """Create (no id) or update (id) one of your apps."""
    me = C.require_user()
    data = data if isinstance(data, dict) else {}
    name = C.text(data.get("name"), 60)
    if len(name) < 2:
        return C.fail("Give the app a name (at least 2 characters).")
    url = C.text(data.get("url"), 300)
    if url and not url.startswith(("https://", "http://")):
        url = "https://" + url
    fields = {"name": name, "emoji": C.text(data.get("emoji"), 8), "color": Clean.color(data.get("color")), "url": url,
              "tagline": C.text(data.get("tagline"), 140), "audience": C.text(data.get("audience"), 100),
              "features": C.text(data.get("features"), 1200, multiline=True), "cta": C.text(data.get("cta"), 80),
              "notes": C.text(data.get("notes"), 2000, multiline=True), "updated": C.now()}
    if data.get("id"):
        p = _own(app_tables.products, data.get("id"), me)
        if p is None:
            return C.fail("That app isn't in your list.")
        p.update(**fields)
    else:
        if len(app_tables.products.search(owner=me)) >= 200:
            return C.fail("200 apps is the limit. Delete one you no longer make videos about.")
        p = app_tables.products.add_row(owner=me, created=C.now(), is_demo=False, **fields)
    return C.ok(product=product_dict(p))


@anvil.server.callable(require_user=True)
def product_delete(product_id):
    """Delete one of your apps. Its videos stay, without an app."""
    me = C.require_user()
    p = _own(app_tables.products, product_id, me)
    if p is None:
        return C.ok()
    for v in app_tables.videos.search(product=p):
        v["product"] = None
    p.delete()
    return C.ok()
