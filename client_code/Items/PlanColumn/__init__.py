from anvil import *

from ._anvil_designer import PlanColumnTemplate
from ... import state


class PlanColumn(PlanColumnTemplate):
    """Planner: one status column (cards are dropped onto data-col; the page handles the drag)."""

    def __init__(self, **properties):
        super().__init__(**properties)
        c = self.item
        state.set_attr(self.col, "data-col", c["key"])
        self.col.classes["show"] = bool(c.get("show"))
        self.icon.classes.add("ic-" + c["icon"])
        self.count.text = str(len(c["videos"]))
        self.add_button.visible = c["key"] in ("idea", "script")
        state.set_control_attr(self.add_button, "aria-label", "Add to " + c["label"])
        self.quick.visible = c["key"] == "idea"
        state.set_control_attr(self.quick_box, "aria-label", "Quick idea")
        state.set_control_attr(self.quick_box, "maxlength", 100)
        self.cards_panel.items = [{"v": v, "host": c["host"]} for v in c["videos"]]
        self.empty.visible = not c["videos"]

    @handle("add_button", "click")
    def add_button_click(self, **event_args):
        self.item["host"].add_to(self.item["key"])

    @handle("quick_box", "pressed_enter")
    def quick_box_pressed_enter(self, **event_args):
        host = self.item["host"]
        if host.quick_idea(self.quick_box.text):
            for c in host.columns_panel.get_components():
                if getattr(c, "item", {}).get("key") == "idea":
                    state.focus(getattr(c, "quick_box"))
