from anvil import *

from ._anvil_designer import DayBarTemplate
from ... import state


class DayBar(DayBarTemplate):
    """Admin overview chart: one day's takes (red) and exports (blue). item: day, takes, exports, top, i."""

    def __init__(self, **properties):
        super().__init__(**properties)
        x = self.item
        self.dom_nodes["takes"].style.height = "%.1f%%" % (x["takes"] / x["top"] * 100)
        self.dom_nodes["exports"].style.height = "%.1f%%" % (x["exports"] / x["top"] * 100)
        self.day.text = "" if x["i"] % 2 else x["day"][5:]
        state.set_attr(self.bar, "title", "%s: %d takes, %d exports" % (x["day"], x["takes"], x["exports"]))
