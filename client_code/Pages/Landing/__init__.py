import anvil.js
from anvil import *

from ._anvil_designer import LandingTemplate
from ... import state

# The app's video on the Addanapp YouTube channel (APP_MAKER/youtube/manifest.json), shown in the Watch section.
YT_VIDEO = "Olt2yMqA_TI"


class Landing(LandingTemplate):
    """#landing (also "About" for members): the hero is a classic watch page whose player renders the sample tour live
    (Components/HeroPlayer, the real video engine, no video file), the Watch section (the YouTube video), how it
    works, features, who it's for, questions. Static copy lives in the template."""

    def __init__(self, args=(), **properties):
        super().__init__(**properties)
        me = state.me()
        self.guest_cta.visible = not me
        self.member_cta.visible = bool(me)
        if me:
            state.set_attr(self.band_link, "href", "#record")
            anvil.js.get_dom_node(self.band_link).textContent = "Record now"
        self.dom_nodes["yt_cover"].addEventListener("click", self._play)

    def _play(self, event):
        """Swap the video's cover for YouTube's player (privacy-enhanced); nothing loads from YouTube before this click."""
        self.dom_nodes["yt_frame"].innerHTML = (
            '<iframe src="https://www.youtube-nocookie.com/embed/' + YT_VIDEO + '?autoplay=1&rel=0&playsinline=1" '
            'title="VideoBlog Buddy video" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen '
            'referrerpolicy="strict-origin-when-cross-origin"></iframe>')
