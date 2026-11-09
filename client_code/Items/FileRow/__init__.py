from anvil import *
from anvil.js import window

from ._anvil_designer import FileRowTemplate
from ... import vb


class FileRow(FileRowTemplate):
    """Recordings on this computer: one take's files (VB.vault) with Delete."""

    def __init__(self, **properties):
        super().__init__(**properties)
        r = self.item
        when = ""
        if r.get("created"):
            when = " · " + str(window.Date(r["created"]).toLocaleDateString([], vb.js_value({"day": "numeric", "month": "short", "year": "numeric"})))
        self.detail.text = "%d file%s · %s%s" % (r["files"], "" if r["files"] == 1 else "s", vb.fmt_bytes(r["size"]), when)

    @handle("drop_button", "click")
    def drop_button_click(self, **event_args):
        if confirm("The take stays in your library, but it won't play on this computer.", title="Delete these files?",
                   buttons=[("Cancel", False), ("Delete", True)], role="app-dialog"):
            vb.VB.vault.dropTake(self.item["key"])
            self.parent.raise_event("x-dropped")
