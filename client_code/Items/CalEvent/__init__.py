from anvil import *

from ._anvil_designer import CalEventTemplate
from ... import router, state, vb


class CalEvent(CalEventTemplate):
    """Planner calendar: a video on its publish day (draggable: data-ev), or a published one (✓)."""

    def __init__(self, **properties):
        super().__init__(**properties)
        from ...Pages.Planner import late
        v, pub = self.item["ev"], self.item.get("pub")
        state.set_attr(self.link, "href", router.href("video", v["id"]))
        state.set_attr(self.link, "data-ev", v["id"])
        status = [s["label"] for s in vb.statuses() if s["key"] == v["status"]][0]
        state.set_attr(self.link, "title", "%s · %s" % (v["title"], status))
        self.link.classes["st-" + v["status"]] = True
        self.link.classes["late"] = late(v)
        self.text.text = ("✓ " if pub else vb.kind(v.get("kind")).get("emoji", "") + " ") + v["title"]
