from anvil import *

from ._anvil_designer import SideAppTemplate
from ... import router, state


class SideApp(SideAppTemplate):
    """Studio -> Your apps: one app with how many videos are about it."""

    def __init__(self, **properties):
        super().__init__(**properties)
        p = self.item
        state.set_attr(self.link, "href", router.href("apps", p["id"]))
        emo = self.dom_nodes["emo"]
        emo.textContent = p.get("emoji") or "•"
        emo.style.background = "color-mix(in srgb, %s 16%%, transparent)" % (p.get("color") or "#cc181e")
        self.count.text = str(p.get("n", 0))
