from anvil import *

from ._anvil_designer import AppCardTemplate
from ... import router, state, vb


class AppCard(AppCardTemplate):
    """Your apps: one app card (colour band, emoji, pitch line, video counts)."""

    def __init__(self, **properties):
        super().__init__(**properties)
        p = self.item
        col = p.get("color") or "#cc181e"
        state.set_attr(self.link, "href", router.href("apps", p["id"]))
        self.band.style["background"] = "linear-gradient(135deg, %s, %s)" % (col, vb.mix(col, -0.4))
        self.emoji.text = p.get("emoji") or "📦"
        self.tagline.text = p.get("tagline") or "Add a one-line pitch"
        self.videos.text = state.plural(p.get("n", 0), "video")
        self.published.text = "%d published" % p.get("n_pub", 0)
        url = (p.get("url") or "").replace("https://", "").replace("http://", "").rstrip("/")
        self.url.text = url
        self.url.visible = bool(url)
