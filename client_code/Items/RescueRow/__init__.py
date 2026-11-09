from anvil import *
from anvil.js import window

from ._anvil_designer import RescueRowTemplate
from ... import vb


class RescueRow(RescueRowTemplate):
    """Studio: a recording a closed tab left unfinished (VB.vault.orphans). Rescue / Delete raise events on the panel."""

    def __init__(self, **properties):
        super().__init__(**properties)
        o = self.item
        info = o.get("info") or {}
        parts = []
        if info.get("t"):
            parts.append("About " + vb.fmt_time(info["t"]))
        parts.append(vb.fmt_bytes(o.get("size") or 0))
        if info.get("started"):
            parts.append("started " + str(window.Date(info["started"]).toLocaleString([], vb.js_value(
                {"day": "numeric", "month": "short", "hour": "2-digit", "minute": "2-digit"}))))
        self.detail.text = ", ".join(parts) + ". The tab probably closed while recording."

    @handle("rescue_button", "click")
    def rescue_button_click(self, **event_args):
        self.rescue_button.enabled = False
        try:
            self.parent.raise_event("x-rescue", rid=self.item["rid"])
        finally:
            self.rescue_button.enabled = True

    @handle("drop_button", "click")
    def drop_button_click(self, **event_args):
        self.parent.raise_event("x-drop", rid=self.item["rid"])
