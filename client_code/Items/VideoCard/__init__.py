from anvil import *

from ._anvil_designer import VideoCardTemplate
from ... import router, state, vb


class VideoCard(VideoCardTemplate):
    """Studio: one video as a channel card (thumbnail, title, app, format, when). "⋯" raises x-more on the panel."""

    def __init__(self, **properties):
        super().__init__(**properties)
        v = self.item
        link = router.href("video", v["id"])
        state.set_attr(self.th_link, "href", link)
        state.set_attr(self.title_link, "href", link)
        self.thumb.video = v
        self.chip.product = v.get("product")
        self.kind_label.text = "· " + vb.kind(v.get("kind")).get("short", "Video")
        when = ("Published " + state.ago(v["published_at"])) if v.get("status") == "published" and v.get("published_at") \
            else "Updated " + state.ago(v.get("updated"))
        if v.get("takes"):
            when += " · " + state.plural(v["takes"], "take")
        self.when.text = when
        self.sample_badge.visible = bool(v.get("sample"))
        state.set_control_attr(self.more_button, "aria-label", "More actions for " + v["title"])

    @handle("more_button", "click")
    def more_button_click(self, **event_args):
        self.parent.raise_event("x-more", video=self.item)
