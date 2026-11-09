import random

import anvil.server
from anvil import *

from ._anvil_designer import EditProductTemplate
from ... import state

COLORS = ["#cc181e", "#ff8a3d", "#e6a700", "#2e9d5b", "#1fa2a2", "#167ac6", "#5b4ccf", "#a83279", "#444444"]
LIMITS = {"emoji_box": 8, "name_box": 60, "url_box": 300, "tagline_box": 140, "audience_box": 100, "features_box": 1200,
          "cta_box": 80, "notes_box": 2000}


class EditProduct(EditProductTemplate):
    """Add or edit one of your apps (server product_save). Closes with the saved app, or None."""

    def __init__(self, product=None, **properties):
        super().__init__(**properties)
        p = product or {"color": random.choice(COLORS)}
        self.p: dict = dict(p)
        self.title.text = ("Edit " + p["name"]) if p.get("id") else "Add an app"
        self.emoji_box.text, self.name_box.text = p.get("emoji") or "", p.get("name") or ""
        self.url_box.text, self.tagline_box.text = p.get("url") or "", p.get("tagline") or ""
        self.audience_box.text, self.features_box.text = p.get("audience") or "", p.get("features") or ""
        self.cta_box.text, self.notes_box.text = p.get("cta") or "", p.get("notes") or ""
        state.set_control_attr(self.color_box, "type", "color")
        state.set_control_attr(self.color_box, "aria-label", "Any colour")
        state.set_control_attr(self.url_box, "type", "url")
        for name, n in LIMITS.items():
            state.set_control_attr(getattr(self, name), "maxlength", n)
        self._set_color(p.get("color") or "#cc181e")

    def _set_color(self, col):
        self.p["color"] = col
        state.control(self.color_box).value = col
        for el in (self.c1, self.c2, self.c3, self.c4, self.c5, self.c6, self.c7, self.c8, self.c9):
            el.classes["on"] = state.attr_of(el, "data-col") == col

    def color_click(self, event):
        self._set_color(event.currentTarget.getAttribute("data-col"))

    @handle("", "show")
    def form_show(self, **event_args):
        self.name_box.focus()

    @handle("cancel_button", "click")
    def cancel_button_click(self, **event_args):
        self.raise_event("x-close-alert", value=None)

    @handle("save_button", "click")
    def save_button_click(self, **event_args):
        v = {"emoji": self.emoji_box.text or "", "name": (self.name_box.text or "").strip(),
             "color": state.control(self.color_box).value or self.p["color"], "url": self.url_box.text or "",
             "tagline": self.tagline_box.text or "", "audience": self.audience_box.text or "",
             "features": self.features_box.text or "", "cta": self.cta_box.text or "", "notes": self.notes_box.text or ""}
        if not v["name"]:
            self.message.text, self.message.visible = "Give the app a name.", True
            return
        if self.p.get("id"):
            v["id"] = self.p["id"]
        self.save_button.enabled = False
        try:
            r = anvil.server.call("product_save", v)
        finally:
            self.save_button.enabled = True
        if not r or r.get("ok") is False:
            self.message.text, self.message.visible = (r or {}).get("error") or "That didn't work.", True
            return
        state.toast("Saved", "ok")
        self.raise_event("x-close-alert", value=r["product"])
