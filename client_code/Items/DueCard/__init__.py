from anvil import *

from ._anvil_designer import DueCardTemplate
from ... import router, state, vb


class DueCard(DueCardTemplate):
    """Planner -> Coming up: a video with a publish date."""

    def __init__(self, **properties):
        super().__init__(**properties)
        v = self.item
        state.set_attr(self.link, "href", router.href("video", v["id"]))
        self.link.classes["late"] = bool(v.get("late"))
        self.status.text = [s["label"] for s in vb.statuses() if s["key"] == v["status"]][0]
        self.status.role = ["vb-status-l", "st-" + v["status"]]
