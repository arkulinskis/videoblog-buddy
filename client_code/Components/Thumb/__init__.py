from anvil import *

from ._anvil_designer import ThumbTemplate
from ... import vb


class Thumb(ThumbTemplate):
    """A video's 16:9 picture (VB.thumbHtml). Set `video` (a card dict); `show_status` hides the chip."""

    def __init__(self, **properties):
        self._video = None
        self._status = True
        self._ready = False
        super().__init__(**properties)
        self._ready = True
        self._draw()

    def _draw(self):
        if self._ready and self._video:
            self.dom_nodes["host"].innerHTML = vb.thumb_html(self._video, self._status)

    @property
    def video(self):
        return self._video

    @video.setter
    def video(self, value):
        self._video = value
        self._draw()

    @property
    def show_status(self):
        return self._status

    @show_status.setter
    def show_status(self, value):
        self._status = bool(value)
        self._draw()
