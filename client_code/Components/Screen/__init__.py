from anvil import *

from ._anvil_designer import ScreenTemplate
from ... import vb


class Screen(ScreenTemplate):
    """An engine screen (vb-screens.js) in a page: UI.mountScreen(name, element, args) on show, destroy() on hide.
    The screen draws its own markup, talks to the server through UI.api (vb.py's bridge) and opens Python dialogs
    through VB.host. It sets UI_READY itself once its first load is done."""

    def __init__(self, **properties):
        self.screen = ""
        self._args = []
        self.ctl = None
        super().__init__(**properties)

    def mount(self, args):
        self._args = [str(a) for a in (args or [])]

    @handle("", "show")
    def form_show(self, **event_args):
        self.destroy()
        self.ctl = vb.UI.mountScreen(self.screen, self.dom_nodes["host"], vb.js_value(self._args))

    @handle("", "hide")
    def form_hide(self, **event_args):
        self.destroy()

    def destroy(self):
        if self.ctl is not None:
            ctl, self.ctl = self.ctl, None
            ctl.destroy()
