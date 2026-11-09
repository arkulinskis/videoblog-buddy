import datetime

import anvil.js
import anvil.server
from anvil import *
from anvil.js import window

from ._anvil_designer import PlannerTemplate
from ... import state, vb

COLS = ["idea", "script", "recorded", "edited", "published"]
MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


def to_date(iso):
    y, m, d = (iso or "")[:10].split("-")
    return datetime.date(int(y), int(m), int(d))


def due_label(iso):
    if not iso:
        return ""
    days = (to_date(iso) - datetime.date.today()).days
    if days < 0:
        return "Yesterday" if days == -1 else "%d days late" % -days
    if days == 0:
        return "Today"
    if days == 1:
        return "Tomorrow"
    d = to_date(iso)
    if days < 7:
        return DAYS[d.weekday()]
    return "%d %s" % (d.day, MONTHS[d.month - 1][:3])


def late(v):
    return bool(v.get("due")) and v.get("status") != "published" and to_date(v["due"]) < datetime.date.today()


class Planner(PlannerTemplate):
    """#planner: the content board. Idea -> Script -> Recorded -> Edited -> Published columns (drag cards, or use the
    arrows), quick idea capture, a 🔥 excitement rating (best ideas first), what's due next, a filter per app, a month
    calendar (drag unscheduled videos onto a day, click a day to plan one), and the idea machine (VB.ideasFor).
    Items get the page as item["host"] and call its methods (move, bump, quick_idea, new_on_day, plan_idea).
    Dragging is handled here, on the page's own element, from the data-id / data-col / data-ev / data-day attributes."""

    def __init__(self, args=(), **properties):
        super().__init__(**properties)
        self.data: dict = {}
        self.app = state.store_get("pl.app", "") or ""
        self.mode = "calendar" if state.store_get("pl.view", "board") == "calendar" else "board"
        self.col = "idea"
        self.idea_app = ""
        t = datetime.date.today()
        self.month = datetime.date(t.year, t.month, 1)
        self.drag: dict = {"id": None, "ev": None}
        self._wire_drag()
        self.load()

    def load(self):
        self.data = anvil.server.call("planner_get")
        self.draw()

    def shown(self):
        return [v for v in self.data["videos"] if not self.app or (v.get("product") and v["product"]["id"] == self.app)]

    def find(self, vid):
        return ([v for v in self.data["videos"] if v["id"] == vid] or [None])[0]

    def draw(self):
        vids = self.shown()
        products = self.data["products"]
        self.filters_panel.visible = bool(products)
        self.filters_panel.items = [{"id": "", "name": "All apps", "color": "", "on": not self.app, "host": self}] + [
            {"id": p["id"], "name": p["name"], "color": p.get("color") or "", "on": self.app == p["id"], "host": self} for p in products]
        nxt = sorted([v for v in vids if v.get("due") and v["status"] != "published"], key=lambda v: v["due"])[:8]
        self.next_box.visible = bool(nxt)
        self.next_panel.items = [dict(v, when=due_label(v["due"]), late=late(v)) for v in nxt]
        self.mode_board.classes["on"] = self.mode == "board"
        self.mode_cal.classes["on"] = self.mode == "calendar"
        self.board_view.visible = self.mode == "board"
        self.cal_view.visible = self.mode == "calendar"
        if self.mode == "board":
            self.draw_board(vids)
        else:
            self.draw_calendar(vids)
        self.draw_ideas()

    def draw_board(self, vids):
        cols = []
        for s in vb.statuses():
            items = [v for v in vids if v["status"] == s["key"]]
            if s["key"] in ("idea", "script"):
                items.sort(key=lambda v: -(v.get("priority") or 0))
            cols.append({"key": s["key"], "label": s["label"], "icon": s["icon"], "videos": items, "show": self.col == s["key"], "host": self})
        self.columns_panel.items = cols
        for key, el in zip(COLS, [self.t_idea, self.t_script, self.t_recorded, self.t_edited, self.t_published]):
            el.classes["on"] = key == self.col

    def draw_calendar(self, vids: list):
        first = self.month
        start = first - datetime.timedelta(days=first.weekday())
        today = datetime.date.today()
        days = []
        d = start
        for i in range(42):
            days.append(d)
            d = d + datetime.timedelta(days=1)
            if i == 34 and d.month != first.month:
                break
        out = []
        for day in days:
            k = day.isoformat()
            evs: list = []
            for one in vids:
                if one["status"] == "published" and one.get("published_at") and self._local_day(one["published_at"]) == k:
                    evs.append({"ev": one, "pub": True, "host": self})
            for one in vids:
                if one["status"] != "published" and one.get("due") == k:
                    evs.append({"ev": one, "pub": False, "host": self})
            out.append({"day": k, "n": day.day, "other": day.month != first.month, "today": day == today, "events": evs, "host": self})
        self.days_panel.items = out
        self.month_label.text = "%s %d" % (MONTHS[first.month - 1], first.year)
        unsched = sorted([v for v in vids if not v.get("due") and v["status"] != "published"], key=lambda v: -(v.get("priority") or 0))
        self.unsched_box.visible = bool(unsched)
        self.unsched_panel.items = [dict(ev=v, pub=False, host=self) for v in unsched[:12]]
        self.unsched_more.text = "+%d more" % (len(unsched) - 12) if len(unsched) > 12 else ""
        self.unsched_more.visible = len(unsched) > 12

    def _local_day(self, iso):
        d = window.Date(iso)
        return "%04d-%02d-%02d" % (d.getFullYear(), d.getMonth() + 1, d.getDate())

    def draw_ideas(self):
        products = self.data["products"]
        self.no_apps.visible = not products
        self.idea_app_dd.visible = bool(products)
        self.ideas_panel.visible = bool(products)
        if not products:
            return
        ids = [p["id"] for p in products]
        if self.idea_app not in ids:
            self.idea_app = self.app if self.app in ids else ids[0]
        self.idea_app_box_items(products)
        p = [x for x in products if x["id"] == self.idea_app][0]
        have = [v["title"].lower() for v in self.data["videos"]]
        tpls = {t["key"]: t["name"] for t in vb.templates()}
        items = []
        for n, i in enumerate(vb.ideas_for(p)):
            k = vb.kind(i.get("kind"))
            items.append({"title": i["title"], "kind_label": "%s %s · %s" % (k["emoji"], k["label"], tpls.get(i.get("tpl"), "")),
                          "done": i["title"].lower() in have, "done_text": "On the board", "button_text": "Add to board",
                          "idx": n, "host": self})
        self.ideas_panel.items = items

    def idea_app_box_items(self, products):
        box = self.idea_app_box()
        box.items = [((p.get("emoji") + " " if p.get("emoji") else "") + p["name"], p["id"]) for p in products]
        box.selected_value = self.idea_app
        state.set_control_attr(box, "aria-label", "Ideas for which app")

    def idea_app_box(self):
        return self.idea_app_dd

    # ---- item callbacks
    def set_app(self, app_id):
        self.app = app_id or ""
        state.store_set("pl.app", self.app)
        self.draw()

    def move(self, vid, status):
        v = self.find(vid)
        if not v or v["status"] == status:
            return
        old = v["status"]
        v["status"] = status
        self.col = status
        self.draw()
        err = ""
        try:
            r = anvil.server.call_s("video_update", vid, {"status": status})
        except Exception as e:
            r, err = None, str(e)
        if not r or r.get("ok") is False:
            v["status"] = old
            self.draw()
            state.toast((r.get("error") if r else err) or "That didn't work.", "error")
            return
        v["status"], v["published_at"] = r["video"]["status"], r["video"].get("published_at")
        if status == "published":
            vb.confetti()
            vb.badge_pop(r.get("new_badges"))

    def step(self, vid, d):
        v = self.find(vid)
        i = max(0, min(4, COLS.index(v["status"]) + d))
        self.move(vid, COLS[i])

    def bump(self, vid):
        v = self.find(vid)
        v["priority"] = ((v.get("priority") or 0) + 1) % 4
        self.draw()
        r = anvil.server.call_s("video_update", vid, {"priority": v["priority"]})
        if r and r.get("ok") is False:
            state.toast(r.get("error") or "That didn't work.", "error")

    def quick_idea(self, title):
        title = (title or "").strip()
        if len(title) < 2:
            return False
        r = state.call("video_create", {"title": title, "status": "idea", "product_id": self.app or None})
        if r:
            self.data["videos"].insert(0, r["video"])
            self.draw()
            state.toast("Idea saved", "ok")
            return True
        return False

    def new_on_day(self, day):
        if vb.new_video(self.data["products"], product_id=self.app, status="idea", due=day, handle=self.data.get("handle"), go=False):
            self.load()

    def add_to(self, status):
        if vb.new_video(self.data["products"], product_id=self.app, status=status, handle=self.data.get("handle"), go=False):
            self.load()

    def set_due(self, vid, day):
        v = self.find(vid)
        if not v or v["status"] == "published":
            self.draw()
            return
        old = v.get("due")
        v["due"] = day
        self.draw()
        r = anvil.server.call_s("video_update", vid, {"due": day})
        if r and r.get("ok") is False:
            v["due"] = old
            self.draw()
            state.toast(r.get("error") or "That didn't work.", "error")
        else:
            state.toast("\u201c%s\u201d is due %s" % (v["title"], due_label(day).lower()), "ok")

    def plan_idea(self, idx):
        p = [x for x in self.data["products"] if x["id"] == self.idea_app][0]
        idea = vb.ideas_for(p)[idx]
        tpl = ([t for t in vb.templates() if t["key"] == idea.get("tpl")] or [None])[0]
        r = state.call("video_create", {"title": idea["title"], "kind": idea["kind"], "product_id": p["id"], "status": "script",
                                        "script": vb.fill(tpl["body"], p, self.data.get("handle")) if tpl else ""})
        if r:
            self.data["videos"].insert(0, r["video"])
            state.toast("Added to the board with a script", "ok")
            self.draw()

    # ---- page controls
    def mode_click(self, event):
        self.mode = event.currentTarget.getAttribute("data-mode")
        state.store_set("pl.view", self.mode)
        self.draw()

    def coltab_click(self, event):
        self.col = event.currentTarget.getAttribute("data-col")
        self.draw()

    @handle("new_button", "click")
    def new_button_click(self, **event_args):
        self.add_to("idea")

    @handle("idea_app_dd", "change")
    def idea_app_dd_change(self, **event_args):
        self.idea_app = self.idea_app_dd.selected_value or ""
        self.draw_ideas()

    def _month(self, d):
        y, m = self.month.year, self.month.month + d
        while m < 1:
            m, y = m + 12, y - 1
        while m > 12:
            m, y = m - 12, y + 1
        self.month = datetime.date(y, m, 1)
        self.draw()

    @handle("prev_button", "click")
    def prev_button_click(self, **event_args):
        self._month(-1)

    @handle("next_button", "click")
    def next_button_click(self, **event_args):
        self._month(1)

    @handle("today_button", "click")
    def today_button_click(self, **event_args):
        t = datetime.date.today()
        self.month = datetime.date(t.year, t.month, 1)
        self.draw()

    # ---- drag and drop (board cards between columns, calendar events onto days)
    def _wire_drag(self):
        node = anvil.js.get_dom_node(self.page_box)
        for name, fn in (("dragstart", self._dragstart), ("dragover", self._dragover), ("drop", self._drop), ("dragend", self._dragend)):
            node.addEventListener(name, anvil.js.report_exceptions(fn))

    def _clear_over(self):
        node = anvil.js.get_dom_node(self.page_box)
        for sel in (".pl-col.over", ".pl-day.over"):
            found = node.querySelectorAll(sel)
            for i in range(found.length):
                getattr(found, "item")(i).classList.remove("over")

    def _dragstart(self, e):
        t = e.target
        card = t.closest(".pl-card") if t.closest else None
        ev = t.closest("[data-ev]") if t.closest else None
        if ev:
            self.drag["ev"] = ev.getAttribute("data-ev")
        elif card:
            self.drag["id"] = card.getAttribute("data-id")
        else:
            return
        e.dataTransfer.effectAllowed = "move"
        e.dataTransfer.setData("text/plain", self.drag["ev"] or self.drag["id"] or "")

    def _dragover(self, e):
        sel = ".pl-day" if self.drag["ev"] else ".pl-col" if self.drag["id"] else None
        target = e.target.closest(sel) if sel and e.target.closest else None
        if not target:
            return
        e.preventDefault()
        self._clear_over()
        target.classList.add("over")

    def _drop(self, e):
        if self.drag["ev"]:
            day = e.target.closest(".pl-day") if e.target.closest else None
            if day:
                e.preventDefault()
                vid, self.drag["ev"] = self.drag["ev"], None
                self.set_due(vid, day.getAttribute("data-day"))
        elif self.drag["id"]:
            col = e.target.closest(".pl-col") if e.target.closest else None
            if col:
                e.preventDefault()
                vid, self.drag["id"] = self.drag["id"], None
                self.move(vid, col.getAttribute("data-col"))

    def _dragend(self, e):
        self.drag["id"] = None
        self.drag["ev"] = None
        self._clear_over()
