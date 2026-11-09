"""Page addresses: #name/arg1/arg2 -> a page Form (open_form), with sign-in rules. The addresses are the same as in the
old JavaScript version, so links people saved keep working.

Links in templates are plain <a href="#home">; code calls router.go("video", id).

    PAGES[name] = (who may open it, browser-tab title)   who: None = anyone, "guest" = signed out only, "user", "admin"
    NAV = the main menu (header + phone tab bar, signed-in people): (page, label, icon). At most 4.
New page: add it to PAGES, to _form() and (if it belongs in the menu) to NAV.
Engine pages (record, video, edit) set `waits = True`: the JavaScript screen sets UI_READY itself once it has loaded.
Pages with timers or listeners have leave(), called when the next page opens.
"""
import json

import anvil
import anvil.js
from anvil.js import window

from . import state

PAGES = {
    "landing": (None, "Record, edit and publish videos about your apps"),
    "auth": ("guest", "Sign in"),
    "home": ("user", "Studio"),
    "record": ("user", "Record"),
    "video": ("user", "Video"),
    "edit": ("user", "Editor"),
    "planner": ("user", "Planner"),
    "apps": ("user", "Your apps"),
    "prompter": ("user", "Teleprompter"),
    "extension": (None, "Browser extension"),
    "profile": ("user", "Your profile"),
    "admin": ("admin", "Admin"),
}
NAV = [("home", "Studio", "tv"), ("record", "Record", "record"), ("planner", "Planner", "kanban"), ("apps", "Apps", "grid")]
APP_NAME = "VideoBlog Buddy"
_r: dict = {"after": "", "listening": False, "page": None}


def _form(name):
    """The page's Form class (imported when first needed, so start-up stays quick)."""
    if name == "landing":
        from .Pages.Landing import Landing
        return Landing
    if name == "auth":
        from .Pages.Auth import Auth
        return Auth
    if name == "home":
        from .Pages.Home import Home
        return Home
    if name == "record":
        from .Pages.Record import Record
        return Record
    if name == "video":
        from .Pages.Video import Video
        return Video
    if name == "edit":
        from .Pages.Edit import Edit
        return Edit
    if name == "planner":
        from .Pages.Planner import Planner
        return Planner
    if name == "apps":
        from .Pages.Apps import Apps
        return Apps
    if name == "prompter":
        from .Pages.Prompter import Prompter
        return Prompter
    if name == "extension":
        from .Pages.Extension import Extension
        return Extension
    if name == "profile":
        from .Pages.Profile import Profile
        return Profile
    from .Pages.Admin import Admin
    return Admin


def parse(hash_text):
    h = (hash_text or "").lstrip("#").lstrip("!").lstrip("/").split("?")[0]
    parts = [window.decodeURIComponent(p) for p in h.split("/") if p]
    return (parts[0] if parts else ""), parts[1:]


def href(name, *args):
    """'#name/arg1/arg2' with every part URL-encoded (row ids contain brackets and commas)."""
    return "#" + "/".join([name] + [window.encodeURIComponent(str(a)) for a in args if a not in (None, "")])


def home_page():
    return "home" if state.me() else "landing"


def current():
    """The page Form that is open now (or None)."""
    return _r["page"]


def show():
    """Open the page for the current address."""
    name, args = parse(window.location.hash)
    if name not in PAGES:
        name, args = home_page(), []
    who = PAGES[name][0]
    if who == "guest" and state.me():
        name, args = "home", []
    elif who in ("user", "admin") and not state.me():
        _r["after"] = window.location.hash
        name, args = "auth", []
    elif who == "admin" and not state.is_admin():
        state.toast("That page is for admins only.", "error")
        name, args = "home", []
    window.document.title = PAGES[name][1] + " · " + APP_NAME
    window.UI_READY = False
    window.UI._page = window.JSON.parse(json.dumps({"name": name, "args": list(args)}))  # UI.current() for the engines
    old = _r["page"]
    if old is not None and hasattr(old, "leave"):
        old.leave()
    page = _form(name)(args=args)
    _r["page"] = page
    anvil.open_form(page)
    shell = getattr(page, "layout", None)
    if shell is not None and hasattr(shell, "refresh"):
        shell.refresh(name)  # Anvil reuses the layout between pages: tell it who is signed in and which page is open
    window.scrollTo(0, 0)
    if not getattr(page, "waits", False):
        window.UI_READY = True  # tests and screenshots wait for this


def go(name, *args):
    """Go to a page. Same address again = reload the page."""
    target = href(name, *args)
    if window.location.hash == target:
        show()
    else:
        window.location.hash = target


def replace(name, *args):
    """Change the address without opening anything (a page that switches its own view)."""
    window.history.replaceState(None, "", href(name, *args))


def after_sign_in():
    """Where to go once someone signs in: the page they were heading for, or home."""
    target = _r["after"]
    _r["after"] = ""
    if target and target != window.location.hash:
        window.location.hash = target
    else:
        go("home")


def remember_after(target):
    _r["after"] = target


def _on_hash(event):
    show()


def start():
    if not _r["listening"]:
        window.addEventListener("hashchange", anvil.js.report_exceptions(_on_hash))
        _r["listening"] = True
    show()
