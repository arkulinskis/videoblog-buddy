from anvil import *
from anvil.js import window

from ._anvil_designer import HeroPlayerTemplate
from ... import vb


class HeroPlayer(HeroPlayerTemplate):
    """The sample tour drawn live by the video engine (VB.heroPlayer). Starts on show, stops on hide."""

    def __init__(self, **properties):
        self._stop = None
        super().__init__(**properties)

    @handle("", "show")
    def form_show(self, **event_args):
        self._halt()
        once = bool(window.UI.reducedMotion())
        self._stop = vb.VB.heroPlayer(self.dom_nodes["canvas"], self.dom_nodes["prog"], once)

    @handle("", "hide")
    def form_hide(self, **event_args):
        self._halt()

    def _halt(self):
        if self._stop is not None:
            stop, self._stop = self._stop, None
            stop()
