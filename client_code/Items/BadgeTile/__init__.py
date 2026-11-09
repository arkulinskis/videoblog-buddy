from anvil import *

from ._anvil_designer import BadgeTileTemplate
from ... import state


class BadgeTile(BadgeTileTemplate):
    """Studio -> Achievements: one badge, coloured when earned (item: emoji, name, desc, got)."""

    def __init__(self, **properties):
        super().__init__(**properties)
        got = bool(self.item.get("got"))
        self.tile.classes["on"] = got
        self.tile.classes["off"] = not got
        state.set_attr(self.tile, "title", "%s: %s" % (self.item.get("name", ""), self.item.get("desc", "")))
