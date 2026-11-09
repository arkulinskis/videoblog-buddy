from anvil import *

from ._anvil_designer import VideoTemplate


class Video(VideoTemplate):
    """#video/...: the video hub (takes, script tools, publish kit, thumbnail maker, YouTube upload). A JavaScript engine screen in Components/Screen (theme/assets/vb-screens.js)."""

    waits = True  # router: the screen sets UI_READY itself once it has loaded

    def __init__(self, args=(), **properties):
        super().__init__(**properties)
        self.screen.mount(list(args))
