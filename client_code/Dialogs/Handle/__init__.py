from anvil import *

from ._anvil_designer import HandleTemplate
from ... import state


class Handle(HandleTemplate):
    """Your @handle (server set_handle). Closes with the saved handle, or None."""

    def __init__(self, handle="", **properties):
        super().__init__(**properties)
        self.handle_box.text = handle or ""
        state.set_control_attr(self.handle_box, "maxlength", 40)

    @handle("", "show")
    def form_show(self, **event_args):
        self.handle_box.focus()

    @handle("handle_box", "pressed_enter")
    def handle_box_pressed_enter(self, **event_args):
        self.save_button_click()

    @handle("save_button", "click")
    def save_button_click(self, **event_args):
        r = state.call("set_handle", self.handle_box.text or "")
        if r:
            self.raise_event("x-close-alert", value=r["handle"])
