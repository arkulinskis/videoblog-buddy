from anvil import *

from ._anvil_designer import StatCardTemplate
from ... import state


class StatCard(StatCardTemplate):
    """Admin overview: one number with its label, linking to the tab that explains it."""

    def __init__(self, **properties):
        super().__init__(**properties)
        self.num.text = str(self.item["n"])
        state.set_attr(self.link, "href", self.item["href"])
