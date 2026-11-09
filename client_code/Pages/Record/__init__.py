from anvil import *

from ._anvil_designer import RecordTemplate


class Record(RecordTemplate):
    """#record/...: the recorder (screen + camera bubble, teleprompter, markers, floating controls). A JavaScript engine screen in Components/Screen (theme/assets/vb-screens.js)."""

    waits = True  # router: the screen sets UI_READY itself once it has loaded

    def __init__(self, args=(), **properties):
        super().__init__(**properties)
        self.screen.mount(list(args))
