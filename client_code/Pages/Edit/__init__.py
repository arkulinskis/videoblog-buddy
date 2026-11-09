from anvil import *

from ._anvil_designer import EditTemplate


class Edit(EditTemplate):
    """#edit/...: the editor (scenes, trims, captions, Look, Frames, audio, export). A JavaScript engine screen in Components/Screen (theme/assets/vb-screens.js)."""

    waits = True  # router: the screen sets UI_READY itself once it has loaded

    def __init__(self, args=(), **properties):
        super().__init__(**properties)
        self.screen.mount(list(args))
