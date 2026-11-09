import anvil.js
from anvil import *

from ._anvil_designer import ExtensionTemplate
from ... import state, vb


class Extension(ExtensionTemplate):
    """#extension: the optional browser extension (source in extension/, zipped by tools/build_extension.py to
    theme/assets/videoblog-buddy-extension.zip). How to install it (the Chrome Web Store when an admin set the store
    page in Admin -> Settings, else load unpacked), live connection status (VB.ext in vb-core.js), a connection test."""

    def __init__(self, args=(), **properties):
        super().__init__(**properties)
        self._unsub = None
        self._store(None)
        self._status()

    @handle("", "show")
    def form_show(self, **event_args):
        if self._unsub is None:
            self._unsub = vb.VB.ext.on(anvil.js.report_exceptions(self._message))
        vb.VB.ext.ping(450)
        cfg = vb.py_value(vb.VB.getConfig()) or {}
        self._store(cfg.get("extension_store_url") or None)
        self._status()

    @handle("", "hide")
    def form_hide(self, **event_args):
        self.leave()

    def leave(self):
        if self._unsub is not None:
            unsub, self._unsub = self._unsub, None
            unsub()

    def _store(self, url):
        self.store_get.visible = bool(url)
        self.store_steps.visible = bool(url)
        self.zip_get.visible = not url
        self.zip_steps.visible = not url
        if url:
            state.set_attr(self.store_link, "href", url)

    def _status(self):
        s = vb.py_value(vb.VB.ext.state) or {}
        if s.get("paired"):
            self.status_badge.text = "Connected" + (" · v" + s["version"] if s.get("version") else "")
            self.status_badge.role = ["badge", "badge-good"]
            self.status_hint.text = ""
        elif s.get("installed"):
            self.status_badge.text = "Installed, not connected"
            self.status_badge.role = ["badge", "badge-warn"]
            self.status_hint.text = "Click the VideoBlog Buddy icon in your toolbar (on this page) and press Connect this site."
        else:
            self.status_badge.text = "Not found in this browser"
            self.status_badge.role = ["badge"]
            self.status_hint.text = "Install it below, then reload this page."
        self.test_button.visible = bool(s.get("paired"))

    def _message(self, m):
        t = m.type if m else ""
        if t in ("hello", "paired"):
            self._status()
        if t == "test-ok":
            state.toast("The extension answered: all good (v%s)" % (vb.py_value(m).get("version") or "?"), "ok")

    @handle("test_button", "click")
    def test_button_click(self, **event_args):
        vb.VB.ext.send("test")
