from anvil import *

from ._anvil_designer import VideoTileTemplate
from ... import router, state


class VideoTile(VideoTileTemplate):
    """An app's videos: thumbnail + title, links to the video."""

    def __init__(self, **properties):
        super().__init__(**properties)
        state.set_attr(self.link, "href", router.href("video", self.item["id"]))
        self.thumb.video = self.item
