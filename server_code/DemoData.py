"""Demo content, so the app never looks empty. Loaded automatically the first time anyone opens the studio
(ensure_loaded), removed or reloaded from Admin -> Demo data. Removing it is remembered: it doesn't come back.

Videos are private, so the demo here is the shared part: a few community script templates "by" demo
people (fictional, @example.com, can't sign in). Every new account also gets its own sample project
(server_code/Sample.py), which is theirs to keep or delete, not demo data.
"""
import datetime as dt

from anvil.tables import app_tables

from . import common as C

DEMO_USERS = [
    ("Maya Chen", "maya.demo@example.com"),
    ("Theo Martin", "theo.demo@example.com"),
    ("Ines Ozola", "ines.demo@example.com"),
]
DEMO_TEMPLATES = [
    (0, "Launch day teaser", "\U0001F680", "short", "15 seconds of hype for the day you ship.",
     "# Hook\nIt's live. {app} is out today.\n\n# The promise\n{tagline}.\n[SHOW: the best screen of {app}, fast]\n\n"
     "# Proof\n{feature1}. {feature2}.\n\n# Call to action\n{cta}: link in bio. {handle}", True),
    (1, "Bug of the week", "\U0001F41B", "devlog", "A short devlog: one bug, how you found it, how you fixed it.",
     "# The bug\nThis week {app} had a bug that drove me nuts.\n[SHOW: the bug happening]\n\n# The hunt\nHere's how I tracked it down.\n"
     "[SHOW: the code or the logs]\n\n# The fix\nThe fix was one line. (pause) Of course it was.\n\n# Wrap up\nIf you build apps too, "
     "tell me your worst bug in the comments. {handle}", False),
    (2, "Customer story", "\U0001F91D", "youtube", "Tell one real user's before-and-after with your app.",
     "# Before\nMeet a typical {audience}. Before {app}, every week looked like this.\n\n# The switch\n[SHOW: sign-up and first screen]\n"
     "They started with {feature1}.\n\n# After\nNow, {tagline}.\n[SHOW: the result screen]\n\n# Your turn\n{cta} at {url}", False),
]
# Tables that hold demo rows (each has an is_demo column). Children before parents.
DEMO_TABLES = ["script_templates"]


def state():
    return C.get_setting("demo", "never")  # "never" | "loaded" | "removed"


def ensure_loaded():
    """Call from the app's main data callables: loads the demo once, unless an admin removed it."""
    if state() == "never":
        load()


def load():
    remove(remember=False)
    users = []
    for name, email in DEMO_USERS:
        u = app_tables.users.get(email=email) or app_tables.users.add_row(email=email, enabled=False)
        u.update(display_name=name, is_demo=True, signed_up=C.now() - dt.timedelta(days=30))
        users.append(u)
    for i, (who, name, emoji, kind, blurb, body, featured) in enumerate(DEMO_TEMPLATES):
        app_tables.script_templates.add_row(owner=users[who], name=name, emoji=emoji, kind=kind, blurb=blurb, body=body,
                                            featured=featured, hidden=False, uses=[41, 17, 9][i], is_demo=True,
                                            created=C.now() - dt.timedelta(days=3 * (len(DEMO_TEMPLATES) - i)))
    C.set_setting("demo", "loaded")
    return counts()


def remove(remember=True):
    for name in DEMO_TABLES:
        for r in getattr(app_tables, name).search(is_demo=True):
            r.delete()
    for u in app_tables.users.search(is_demo=True):
        u.delete()
    if remember:
        C.set_setting("demo", "removed")
    return counts()


def counts():
    out = {"users": len(app_tables.users.search(is_demo=True))}
    for name in DEMO_TABLES:
        out[name.replace("_", " ")] = len(getattr(app_tables, name).search(is_demo=True))
    return out
