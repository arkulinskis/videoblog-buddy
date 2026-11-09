import anvil.js
from anvil import *

from ._anvil_designer import CalDayTemplate
from ... import state


class CalDay(CalDayTemplate):
    """Planner calendar: one day (a drop target: data-day). Clicking the empty part plans a video for that day."""

    def __init__(self, **properties):
        super().__init__(**properties)
        d = self.item
        state.set_attr(self.day, "data-day", d["day"])
        self.day.classes["other"] = bool(d.get("other"))
        self.day.classes["today"] = bool(d.get("today"))
        self.num.text = str(d["n"])
        self.events_panel.items = d["events"]
        anvil.js.get_dom_node(self.day).addEventListener("click", anvil.js.report_exceptions(self._click))

    def _click(self, event):
        if event.target.closest(".pl-ev"):
            return
        self.item["host"].new_on_day(self.item["day"])
