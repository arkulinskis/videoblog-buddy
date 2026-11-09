from anvil import *

from ._anvil_designer import FilterChipTemplate
from ... import state


class FilterChip(FilterChipTemplate):
    """Planner: a filter per app (or All apps)."""

    def __init__(self, **properties):
        super().__init__(**properties)
        self.chip.classes["on"] = bool(self.item.get("on"))
        state.set_attr(self.chip, "aria-pressed", "true" if self.item.get("on") else "false")
        dot = self.dom_nodes["dot"]
        if self.item.get("color"):
            dot.style.background = self.item["color"]
        else:
            dot.style.display = "none"

    def chip_click(self, event):
        self.item["host"].set_app(self.item["id"])
