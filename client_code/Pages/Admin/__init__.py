from anvil import *
from anvil.js import window

from ._anvil_designer import AdminTemplate
from ... import state, vb

TABS = ["overview", "templates", "settings", "feedback", "users", "demo"]
STATS = [("users", "people signed up", "users"), ("active_week", "active this week", "users"), ("videos", "videos", "overview"),
         ("published", "published", "overview"), ("takes", "takes recorded", "overview"), ("minutes", "minutes recorded", "overview"),
         ("exports", "exports", "overview"), ("vertical", "vertical exports", "overview"), ("products", "apps added", "overview"),
         ("extension_takes", "takes via extension", "overview"), ("templates", "script templates", "templates"),
         ("transcribed", "takes with captions", "overview"), ("uploads", "uploaded to YouTube", "settings"),
         ("feedback_new", "new feedback", "feedback")]


class Admin(AdminTemplate):
    """#admin/<tab>: overview (counts + a 14-day chart of takes and exports), script templates everyone can use,
    settings (the Google OAuth client id for direct YouTube uploads, the extension's Chrome Web Store page), the old
    feedback inbox, users (admin / active switches) and the demo data. Each tab is its own address."""

    def __init__(self, args=(), **properties):
        super().__init__(**properties)
        self.tab = args[0] if args and args[0] in TABS else "overview"
        self._filter = "new"
        parts = {"overview": self.overview_part, "templates": self.templates_part, "settings": self.settings_part,
                 "feedback": self.feedback_part, "users": self.users_part, "demo": self.demo_part}
        tabs = {"overview": self.tab_overview, "templates": self.tab_templates, "settings": self.tab_settings,
                "feedback": self.tab_feedback, "users": self.tab_users, "demo": self.tab_demo}
        for name in TABS:
            parts[name].visible = name == self.tab
            tabs[name].classes["on"] = name == self.tab
        self.feedback_panel.add_event_handler("x-changed", self._feedback_changed)
        self.templates_panel.add_event_handler("x-changed", self._templates_changed)
        getattr(self, "_" + self.tab)()

    # ---- overview
    def _overview(self):
        d = state.call("admin_overview")
        self.stats_panel.items = [{"n": d.get(k) or 0, "label": label, "href": "#admin/" + go} for k, label, go in STATS]
        top = max([1] + [max(x["takes"], x["exports"]) for x in d["days"]])
        self.days_panel.items = [dict(x, top=top, i=i) for i, x in enumerate(d["days"])]
        self.demo_line.text = ("Recordings themselves never reach the server: these numbers come from the facts the browser "
                               "reports. Demo data is %s (%d demo people)." % (d["demo"]["state"], d["demo"]["counts"].get("users", 0)))

    # ---- templates
    def _templates(self):
        d = state.call("admin_templates")
        self._tpls = d["templates"]
        self.templates_panel.items = d["templates"]
        self.no_templates.visible = not d["templates"]

    def _templates_changed(self, **event_args):
        self._templates()

    @handle("new_template_button", "click")
    def new_template_button_click(self, **event_args):
        from ...Dialogs.EditTemplate import EditTemplate
        if alert(EditTemplate(template=None), buttons=[], large=True, role="app-dialog", dismissible=True):
            self._templates()

    # ---- settings
    def _settings(self):
        s = state.call("admin_settings_get")
        self.client_id_box.text = s.get("google_client_id") or ""
        self.store_box.text = s.get("extension_store_url") or ""
        self.client_on.visible = bool(s.get("google_client_id"))
        self.origin.text = str(window.location.origin)

    @handle("save_settings_button", "click")
    def save_settings_button_click(self, **event_args):
        if state.call("admin_settings_save", {"google_client_id": self.client_id_box.text or "",
                                              "extension_store_url": self.store_box.text or ""}) is not None:
            state.toast("Settings saved", "ok")
            vb.VB.getConfig(True)
            self._settings()

    # ---- feedback
    def _feedback(self):
        d = state.call("list_feedback", None)
        items = [i for i in d["items"] if self._filter == "all" or i["status"] == self._filter]
        self.feedback_panel.items = items
        self.no_feedback.visible = not items
        labels = {"new": "New", "read": "Read", "done": "Done", "all": "All"}
        for key, el in (("new", self.f_new), ("read", self.f_read), ("done", self.f_done), ("all", self.f_all)):
            n = len(d["items"]) if key == "all" else d["counts"].get(key, 0)
            el.text = "%s (%d)" % (labels[key], n)
            el.role = ["seg", "on"] if key == self._filter else ["seg"]

    def _set_filter(self, value):
        self._filter = value
        self._feedback()

    @handle("f_new", "click")
    def f_new_click(self, **event_args):
        self._set_filter("new")

    @handle("f_read", "click")
    def f_read_click(self, **event_args):
        self._set_filter("read")

    @handle("f_done", "click")
    def f_done_click(self, **event_args):
        self._set_filter("done")

    @handle("f_all", "click")
    def f_all_click(self, **event_args):
        self._set_filter("all")

    def _feedback_changed(self, **event_args):
        self._feedback()

    # ---- users
    def _users(self, query=None):
        d = state.call("list_users", query or None)
        self.users_panel.items = d["users"]
        self.users_count.text = state.plural(d["total"], "person", "people")

    @handle("search_box", "pressed_enter")
    def search_box_pressed_enter(self, **event_args):
        self._users(self.search_box.text)

    @handle("search_button", "click")
    def search_button_click(self, **event_args):
        self._users(self.search_box.text)

    # ---- demo data
    def _demo(self):
        d = state.call("admin_overview")["demo"]
        counts = ", ".join("%s %s" % (v, k) for k, v in d["counts"].items())
        self.demo_status.text = "Status: %s · %s" % (d["state"], counts)
        self.demo_load_button.text = "Reload demo data" if d["state"] == "loaded" else "Load demo data"

    @handle("demo_load_button", "click")
    def demo_load_button_click(self, **event_args):
        if confirm("Demo people and content are added (any old demo rows are replaced).", title="Load the demo data?",
                   buttons=[("Cancel", False), ("Load", True)], role="app-dialog"):
            if state.call("demo_load") is not None:
                state.toast("Done", "ok")
                self._demo()

    @handle("demo_remove_button", "click")
    def demo_remove_button_click(self, **event_args):
        if confirm("Every demo row is deleted. Real data stays.", title="Remove the demo data?",
                   buttons=[("Cancel", False), ("Remove", True)], role="app-dialog"):
            if state.call("demo_remove") is not None:
                state.toast("Done", "ok")
                self._demo()
