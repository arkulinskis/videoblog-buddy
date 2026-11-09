import math

import anvil.js
import anvil.server
from anvil import *
from anvil.js import window

from ._anvil_designer import HomeTemplate
from ... import router, state, vb

FILTERS = ["all", "todo", "wip", "published"]
GOALS = [1, 2, 3, 5, 0]


class Home(HomeTemplate):
    """#home, the Studio: a classic channel page. Banner, your stats, every video as a card (filter tabs, app filter,
    search), the weekly goal, achievements, storage on this computer (VB.vault), the extension's status (VB.ext), your
    apps. Rescues recordings a closed tab left unfinished (VB.vault.orphans + VB.rescue)."""

    def __init__(self, args=(), **properties):
        super().__init__(**properties)
        self.data: dict = {}
        f = state.store_get("st.filter", "all")
        self.filter = f if f in FILTERS else "all"
        self.app = ""
        self.query = ""
        self._later_done = False
        state.heading(self.name_title, 1)
        state.set_control_attr(self.search_box, "type", "search")
        state.set_control_attr(self.search_box, "aria-label", "Search videos")
        self.grid.add_event_handler("x-more", self._more)
        self.rescue_panel.add_event_handler("x-rescue", self._rescue)
        self.rescue_panel.add_event_handler("x-drop", self._drop_rescue)
        self.load()

    # ---- data
    def load(self):
        self.data = anvil.server.call("studio_home")
        self.draw()

    def draw(self):
        d, me = self.data, state.me() or {}
        name = me.get("name") or "You"
        self.banner_title.text = "%s's studio" % name.split(" ")[0]
        self.initials.text = state.initials(name)
        self.name_title.text = name
        self.handle_button.text = d.get("handle") or "Set your @handle"
        st = d["stats"]
        self.s_videos.text, self.s_published.text = str(st["videos"]), str(st["published"])
        self.s_minutes.text, self.s_exports.text = str(st["minutes"]), str(st["exports"])
        products = d["products"]
        self.app_filter.visible = bool(products)
        self.app_filter.items = [("All apps", "")] + [(p["name"], p["id"]) for p in products]
        self.app_filter.selected_value = self.app if any(p["id"] == self.app for p in products) else ""
        state.set_control_attr(self.app_filter, "aria-label", "Filter by app")
        self._goal()
        self.badges_panel.items = d["badges"]
        got = len([b for b in d["badges"] if b.get("got")])
        self.badge_summary.text = "%d of %d earned" % (got, len(d["badges"])) + (
            " · 🔥 %s in a row" % state.plural(st["streak"], "week") if st.get("streak") else "")
        counts: dict = {}
        for v in d["videos"]:
            if v.get("product"):
                counts[v["product"]["id"]] = counts.get(v["product"]["id"], 0) + 1
        self.apps_panel.items = [dict(p, n=counts.get(p["id"], 0)) for p in products[:8]]
        self.no_apps.visible = not products
        self.draw_grid()

    def shown(self):
        out = []
        q = self.query.lower()
        for v in self.data.get("videos") or []:
            s = v.get("status")
            if self.filter == "todo" and s not in ("idea", "script"):
                continue
            if self.filter == "wip" and s not in ("recorded", "edited"):
                continue
            if self.filter == "published" and s != "published":
                continue
            if self.app and (not v.get("product") or v["product"]["id"] != self.app):
                continue
            if q and q not in (v["title"] + " " + (v["product"]["name"] if v.get("product") else "")).lower():
                continue
            out.append(v)
        return out

    def draw_grid(self):
        videos = self.data.get("videos") or []
        shown = self.shown()
        self.grid.items = shown
        self.grid.visible = bool(shown)
        self.no_match.visible = bool(videos) and not shown
        self.empty_state.visible = not videos
        for key, el in zip(FILTERS, [self.f_all, self.f_todo, self.f_wip, self.f_published]):
            el.classes["on"] = key == self.filter

    def _goal(self):
        st = self.data["stats"]
        goal, week = int(st.get("goal") or 0), int(st.get("week") or 0)
        k = min(1.0, week / goal) if goal else 0
        c2 = 2 * math.pi * 26
        self.goal_box.visible = bool(goal)
        self.goal_intro.visible = not goal
        ring = self.dom_nodes["goal_ring"]
        ring.setAttribute("stroke-dasharray", "%.1f %.1f" % (c2 * k, c2))
        ring.setAttribute("stroke", "#2e9d5b" if k >= 1 else "var(--c-brand)")
        self.dom_nodes["goal_count"].textContent = "%d/%d" % (week, goal)
        self.goal_text.text = "Goal reached! 🎉" if k >= 1 else state.plural(max(0, goal - week), "more video") + " this week"
        self.goal_sub.text = state.plural(week, "video") + " published since Monday"
        for g, el in zip(GOALS, [self.g1, self.g2, self.g3, self.g5, self.g0]):
            el.classes["on"] = g == goal

    # ---- the browser's side: storage, extension, unfinished recordings (after the page shows)
    @handle("", "show")
    def form_show(self, **event_args):
        if not self._later_done:
            self._later_done = True
            window.setTimeout(self._later, 30)

    def _later(self):
        if router.current() is not self:
            return
        self.storage()
        self.rescues()
        self.ext_card()

    def storage(self):
        u = vb.py_value(vb.VB.vault.usage()) or {}
        files = vb.py_value(vb.VB.vault.list()) or []
        size = sum(f.get("size") or 0 for f in files)
        line = ("%s of recordings" % vb.fmt_bytes(size)) if size else "No recordings yet"
        if u.get("quota"):
            line += " · %s free for more" % vb.fmt_bytes(max(0, u["quota"] - u["used"]))
        self.storage_line.text = line
        self.meter.visible = bool(u.get("quota"))
        if u.get("quota"):
            pct = max(1.5, min(100, u["used"] / u["quota"] * 100))
            self.dom_nodes["meter_fill"].style.width = "%.1f%%" % pct
        self.persist_button.visible = bool(u) and not u.get("persisted")
        self.protected_badge.visible = not self.persist_button.visible
        self.files_button.visible = bool(files)

    def rescues(self):
        orphans = vb.py_value(vb.VB.vault.orphans()) or []
        self.rescue_panel.items = orphans

    def ext_card(self):
        s = vb.py_value(vb.VB.ext.ping(500)) or {}
        cfg = vb.py_value(vb.VB.getConfig()) or {}
        store = cfg.get("extension_store_url") or ""
        if s.get("paired"):
            self.ext_badge.text, self.ext_badge.role, self.ext_badge.visible = "Connected", ["badge", "badge-good"], True
            self.ext_text.text = "Clicks are recorded for auto-zoom, and you can record any tab from the toolbar."
        elif s.get("installed"):
            self.ext_badge.text, self.ext_badge.role, self.ext_badge.visible = "Installed, not connected", ["badge", "badge-warn"], True
            self.ext_text.text = "Open its popup on this page and press Connect."
        else:
            self.ext_badge.visible = False
            self.ext_text.text = "One-click tab recording, click rings and auto-zoom on your clicks."
        self.ext_store.visible = bool(store) and not s.get("installed")
        if store:
            state.set_attr(self.ext_store, "href", store)
        text = "Extension settings" if s.get("installed") else ("What it does" if store else "Get the extension")
        anvil.js.get_dom_node(self.ext_link).textContent = text

    # ---- actions
    def filter_click(self, event):
        self.filter = event.currentTarget.getAttribute("data-filter")
        state.store_set("st.filter", self.filter)
        self.draw_grid()

    @handle("app_filter", "change")
    def app_filter_change(self, **event_args):
        self.app = self.app_filter.selected_value or ""
        self.draw_grid()

    @handle("search_box", "change")
    def search_box_change(self, **event_args):
        self.query = self.search_box.text or ""
        self.draw_grid()

    @handle("new_button", "click")
    def new_button_click(self, **event_args):
        vb.new_video(self.data.get("products"), handle=self.data.get("handle"))

    @handle("sample_button", "click")
    def sample_button_click(self, **event_args):
        r = state.call("sample_create")
        if r:
            state.toast("Sample added", "ok")
            router.go("video", r["video"]["id"])

    def _more(self, video, **event_args):
        if vb.video_menu(video):
            self.load()

    @handle("handle_button", "click")
    def handle_button_click(self, **event_args):
        from ...Dialogs.Handle import Handle
        h = alert(Handle(handle=self.data.get("handle") or ""), buttons=[], role="app-dialog", dismissible=True)
        if h is not None:
            self.data["handle"] = h
            self.draw()

    def goal_click(self, event):
        r = state.call("set_goal", int(event.currentTarget.getAttribute("data-goal")))
        if not r:
            return
        self.data["stats"], self.data["badges"] = r["stats"], r["badges"]
        self.draw()
        if r.get("new_badges"):
            vb.badge_pop(r["new_badges"])
        else:
            g = r["stats"].get("goal")
            state.toast("Goal: %s a week" % state.plural(g, "video") if g else "Weekly goal off", "ok")

    @handle("persist_button", "click")
    def persist_button_click(self, **event_args):
        ok = bool(vb.VB.vault.persist())
        state.toast("Recordings are protected from automatic clean-up" if ok
                    else "The browser said no. It may ask again after you use the app more.", "ok" if ok else None)
        self.storage()

    @handle("files_button", "click")
    def files_button_click(self, **event_args):
        from ...Dialogs.ManageFiles import ManageFiles
        alert(ManageFiles(), buttons=[], large=True, role="app-dialog", dismissible=True)
        self.storage()

    def _rescue(self, rid, **event_args):
        orphans = vb.py_value(vb.VB.vault.orphans()) or []
        found = [o for o in orphans if o.get("rid") == rid]
        if not found:
            return
        info = vb.py_value(vb.VB.rescue(vb.js_value(found[0])))
        if not info:
            state.toast("That recording was empty.")
            return
        vid = info.get("videoId")
        if not vid or not any(v["id"] == vid for v in self.data.get("videos") or []):
            r = state.call("video_create", {"title": "Rescued recording", "status": "recorded"})
            if not r:
                return
            vid = r["video"]["id"]
        meta = dict(info)
        meta.pop("videoId", None)
        if state.call("take_add", vid, meta):
            state.toast("Recording rescued", "ok")
            router.go("video", vid)

    def _drop_rescue(self, rid, **event_args):
        if confirm("", title="Delete the unfinished recording?", buttons=[("Cancel", False), ("Delete", True)], role="app-dialog"):
            vb.VB.vault.dropChunks(rid)
            self.rescues()
