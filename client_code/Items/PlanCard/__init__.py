from anvil import *

from ._anvil_designer import PlanCardTemplate
from ... import router, state, vb

COLS = ["idea", "script", "recorded", "edited", "published"]


class PlanCard(PlanCardTemplate):
    """Planner: one video card (drag it, or use the arrows). item = {"v": video, "host": the Planner page}."""

    def __init__(self, **properties):
        super().__init__(**properties)
        from ...Pages.Planner import due_label, late
        v = self.item["v"]
        state.set_attr(self.card, "data-id", v["id"])
        state.set_attr(self.title_link, "href", router.href("video", v["id"]))
        self.title.text = vb.kind(v.get("kind")).get("emoji", "") + " " + v["title"]
        n = v.get("priority") or 0
        self.pri_button.visible = v["status"] != "published"
        self.pri_button.text = "🔥" * n if n else "🔥"
        self.pri_button.role = ["pl-pri"] + ([] if n else ["none"])
        state.set_control_attr(self.pri_button, "aria-label", "Excitement %d of 3" % n)
        self.chip.product = v.get("product")
        self.chip.visible = bool(v.get("product"))
        self.due.visible = bool(v.get("due"))
        self.due.text = ("📅 " + due_label(v["due"])) if v.get("due") else ""
        self.due.role = ["pl-due-l"] + (["late"] if late(v) else [])
        i = COLS.index(v["status"]) if v["status"] in COLS else 0
        self.back_button.visible = i > 0
        self.fwd_button.visible = i < 4
        state.set_control_attr(self.back_button, "aria-label", "Move back")
        state.set_control_attr(self.fwd_button, "aria-label", "Move forward")

    @handle("pri_button", "click")
    def pri_button_click(self, **event_args):
        self.item["host"].bump(self.item["v"]["id"])

    @handle("back_button", "click")
    def back_button_click(self, **event_args):
        self.item["host"].step(self.item["v"]["id"], -1)

    @handle("fwd_button", "click")
    def fwd_button_click(self, **event_args):
        self.item["host"].step(self.item["v"]["id"], 1)
