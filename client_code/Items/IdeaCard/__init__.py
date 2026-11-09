from anvil import *

from ._anvil_designer import IdeaCardTemplate


class IdeaCard(IdeaCardTemplate):
    """An idea-machine suggestion (planner and app pages): already planned, or a button that plans it
    (item["host"].plan_idea(item["idx"]))."""

    def __init__(self, **properties):
        super().__init__(**properties)
        done = bool(self.item.get("done"))
        self.done.text = self.item.get("done_text") or "Planned"
        self.done.visible = done
        self.plan_button.text = self.item.get("button_text") or "Plan it"
        self.plan_button.visible = not done

    @handle("plan_button", "click")
    def plan_button_click(self, **event_args):
        self.plan_button.enabled = False
        try:
            self.item["host"].plan_idea(self.item["idx"])
        finally:
            self.plan_button.enabled = True
