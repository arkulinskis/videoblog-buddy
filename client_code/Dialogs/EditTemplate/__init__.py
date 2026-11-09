import anvil.server
from anvil import *

from ._anvil_designer import EditTemplateTemplate
from ... import state, vb

NEW_BODY = "# Hook\n\n# Demo\n[SHOW: ]\n\n# Call to action\n{cta}. {url}"


class EditTemplate(EditTemplateTemplate):
    """Admin: add or edit a script template (server admin_template_save). Closes with True when saved."""

    def __init__(self, template=None, **properties):
        super().__init__(**properties)
        t = template or {"kind": "youtube", "body": NEW_BODY}
        self.t: dict = dict(t)
        self.title.text = "Edit template" if t.get("id") else "New template"
        self.emoji_box.text, self.name_box.text = t.get("emoji") or "", t.get("name") or ""
        self.kind_box.items = [(k["label"], k["key"]) for k in vb.kinds()]
        self.kind_box.selected_value = t.get("kind") or "youtube"
        self.blurb_box.text, self.body_box.text = t.get("blurb") or "", t.get("body") or ""
        self.featured_box.checked, self.hidden_box.checked = bool(t.get("featured")), bool(t.get("hidden"))
        for box, n in ((self.emoji_box, 8), (self.name_box, 60), (self.blurb_box, 160), (self.body_box, 8000)):
            state.set_control_attr(box, "maxlength", n)

    @handle("cancel_button", "click")
    def cancel_button_click(self, **event_args):
        self.raise_event("x-close-alert", value=False)

    @handle("save_button", "click")
    def save_button_click(self, **event_args):
        v = {"emoji": self.emoji_box.text or "", "name": (self.name_box.text or "").strip(), "kind": self.kind_box.selected_value,
             "blurb": self.blurb_box.text or "", "body": self.body_box.text or "", "featured": self.featured_box.checked,
             "hidden": self.hidden_box.checked}
        if self.t.get("id"):
            v["id"] = self.t["id"]
        r = anvil.server.call("admin_template_save", v)
        if not r or r.get("ok") is False:
            self.message.text, self.message.visible = (r or {}).get("error") or "That didn't work.", True
            return
        state.toast("Saved", "ok")
        self.raise_event("x-close-alert", value=True)
