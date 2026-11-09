from anvil import *

from ._anvil_designer import ClipRowTemplate
from ... import state, vb


class ClipRow(ClipRowTemplate):
    """Shorts from chapters: one chapter with a tick box (writes item["on"])."""

    def __init__(self, **properties):
        super().__init__(**properties)
        c = self.item
        self.detail.text = "%s · %s-%s (%s)" % (c.get("from", ""), vb.fmt_time(c["in"]), vb.fmt_time(c["out"]), vb.fmt_time(c["out"] - c["in"]))
        state.set_control_attr(self.pick_box, "aria-label", "Make a Short of " + c.get("label", "this chapter"))

    @handle("pick_box", "change")
    def pick_box_change(self, **event_args):
        self.item["on"] = self.pick_box.checked
