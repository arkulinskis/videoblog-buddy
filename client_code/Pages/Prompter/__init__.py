import json

import anvil.js
import anvil.server
from anvil import *
from anvil.js import window

from ._anvil_designer import PrompterTemplate
from ... import router, state, vb


class Prompter(PrompterTemplate):
    """#prompter/<id>: the video's script as a full-screen teleprompter (no header or footer). Speed, text size, mirror
    (for a teleprompter glass); keyboard: space = scroll/pause, up/down = speed, left/right = jump, Esc = back.
    The scrolling itself is the engine's VB.Prompter (vb-recorder.js); settings live in browser storage ("pp")."""

    def __init__(self, args=(), **properties):
        super().__init__(**properties)
        self.video_id = args[0] if args else ""
        saved = state.store_get("pp", None)
        s = vb.py_value(saved) if saved is not None else {}
        self.prefs = {"speed": int(s.get("speed", 40)), "size": int(s.get("size", 34)), "mirror": bool(s.get("mirror", False))}
        self.engine = None
        self._keys = anvil.js.report_exceptions(self._key)
        state.set_attr(self.back_link, "href", router.href("video", self.video_id, "script"))
        self._labels()

    @handle("", "show")
    def form_show(self, **event_args):
        window.document.addEventListener("keydown", self._keys)
        if self.engine is not None:
            return
        r = anvil.server.call("video_get", self.video_id) if self.video_id else None
        if not r or r.get("ok") is False:
            self.title_label.text = "That video wasn't found."
            return
        self.title_label.text = r["video"]["title"]
        self.engine = vb.VB.Prompter(self.dom_nodes["roll"], r["video"].get("script") or "",
                                     vb.js_value({"speed": self.prefs["speed"], "fontSize": self.prefs["size"]}))
        self.engine.setMirror(self.prefs["mirror"])

    @handle("", "hide")
    def form_hide(self, **event_args):
        self.leave()

    def leave(self):
        window.document.removeEventListener("keydown", self._keys)
        if self.engine is not None:
            engine, self.engine = self.engine, None
            engine.destroy()

    def _save(self):
        state.store_set("pp", vb.js_value(self.prefs))
        self._labels()

    def _labels(self):
        self.speed_label.text = str(self.prefs["speed"])
        self.size_label.text = str(self.prefs["size"])
        self.mirror_button.text = "Mirrored" if self.prefs["mirror"] else "Mirror"

    def _key(self, event):
        if self.engine is None:
            return
        k = getattr(event, "key", None)
        if k == " ":
            event.preventDefault()
            self.toggle_button_click()
        elif k == "ArrowUp":
            event.preventDefault()
            self._speed(6)
        elif k == "ArrowDown":
            event.preventDefault()
            self._speed(-6)
        elif k == "ArrowLeft":
            self.engine.nudge(-160)
        elif k == "ArrowRight":
            self.engine.nudge(160)
        elif k == "Escape":
            window.history.back()

    def _speed(self, d):
        self.prefs["speed"] = max(8, min(160, self.prefs["speed"] + d))
        if self.engine is not None:
            self.engine.setSpeed(self.prefs["speed"])
        self._save()

    def _size(self, d):
        self.prefs["size"] = max(16, min(80, self.prefs["size"] + d))
        if self.engine is not None:
            self.engine.setFont(self.prefs["size"])
        self._save()

    @handle("toggle_button", "click")
    def toggle_button_click(self, **event_args):
        if self.engine is None:
            return
        on = bool(self.engine.toggle())
        self.toggle_button.text = "Pause" if on else "Scroll"
        self.toggle_button.role = ["btn", "btn-primary", "ic-pause" if on else "ic-play"]

    @handle("top_button", "click")
    def top_button_click(self, **event_args):
        if self.engine is not None:
            self.engine.reset()

    @handle("slower_button", "click")
    def slower_button_click(self, **event_args):
        self._speed(-6)

    @handle("faster_button", "click")
    def faster_button_click(self, **event_args):
        self._speed(6)

    @handle("smaller_button", "click")
    def smaller_button_click(self, **event_args):
        self._size(-4)

    @handle("bigger_button", "click")
    def bigger_button_click(self, **event_args):
        self._size(4)

    @handle("mirror_button", "click")
    def mirror_button_click(self, **event_args):
        self.prefs["mirror"] = not self.prefs["mirror"]
        if self.engine is not None:
            self.engine.setMirror(self.prefs["mirror"])
        self._save()
