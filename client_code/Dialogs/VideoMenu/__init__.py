from anvil import *

from ._anvil_designer import VideoMenuTemplate
from ... import router, state, vb


class VideoMenu(VideoMenuTemplate):
    """The "⋯" actions on a video (Studio cards and the video hub, through vb.video_menu): open, record a take, edit,
    make a 16:9 / Short / Reel copy (server video_remix), Shorts from chapters, delete. Closes with "clips" or
    "delete" (vb.video_menu then opens that step), True after a remix, or None."""

    def __init__(self, video=None, **properties):
        super().__init__(**properties)
        self.video: dict = video or {}
        self.title.text = self.video.get("title") or "Video"
        vertical = vb.is_vertical(self.video.get("kind"))
        self.wide_button.visible = vertical
        self.short_button.visible = not vertical
        self.reel_button.visible = not vertical
        self.clips_button.visible = not vertical

    def _go(self, page):
        self.raise_event("x-close-alert", value=None)
        router.go(page, self.video["id"])

    @handle("open_button", "click")
    def open_button_click(self, **event_args):
        self._go("video")

    @handle("record_button", "click")
    def record_button_click(self, **event_args):
        self._go("record")

    @handle("edit_button", "click")
    def edit_button_click(self, **event_args):
        self._go("edit")

    def _remix(self, kind):
        r = state.call("video_remix", self.video["id"], kind)
        if r:
            self.raise_event("x-close-alert", value=None)
            state.toast("Made \u201c%s\u201d" % r["video"]["title"], "ok")
            router.go("edit", r["video"]["id"])

    @handle("wide_button", "click")
    def wide_button_click(self, **event_args):
        self._remix("youtube")

    @handle("short_button", "click")
    def short_button_click(self, **event_args):
        self._remix("short")

    @handle("reel_button", "click")
    def reel_button_click(self, **event_args):
        self._remix("reel")

    @handle("clips_button", "click")
    def clips_button_click(self, **event_args):
        self.raise_event("x-close-alert", value="clips")

    @handle("delete_button", "click")
    def delete_button_click(self, **event_args):
        self.raise_event("x-close-alert", value="delete")
