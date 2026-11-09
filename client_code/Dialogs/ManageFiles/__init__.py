from anvil import *

from ._anvil_designer import ManageFilesTemplate
from ... import vb


class ManageFiles(ManageFilesTemplate):
    """The recordings in this browser (VB.vault), one row per take key; deleting one drops its files here only."""

    def __init__(self, **properties):
        super().__init__(**properties)
        self.files_panel.add_event_handler("x-dropped", self._load)
        self._load()

    def _load(self, **event_args):
        groups: dict = {}
        order = []
        for f in vb.py_value(vb.VB.vault.list()) or []:
            parts = str(f.get("key", "")).split(":")
            k = parts[1] if len(parts) > 1 else str(f.get("key", ""))
            if k not in groups:
                groups[k] = []
                order.append(k)
            groups[k].append(f)
        rows = []
        for k in order:
            g = groups[k]
            rows.append({"key": k, "files": len(g), "size": sum(x.get("size") or 0 for x in g), "created": g[0].get("created")})
        self.files_panel.items = rows
        self.empty.visible = not rows
