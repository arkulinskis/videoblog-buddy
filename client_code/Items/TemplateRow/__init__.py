from anvil import *

from ._anvil_designer import TemplateRowTemplate
from ... import state, vb


class TemplateRow(TemplateRowTemplate):
    """Admin -> Templates: one script template with Edit / Delete (x-changed on the panel reloads the list)."""

    def __init__(self, **properties):
        super().__init__(**properties)
        t = self.item
        self.emoji.text = t.get("emoji") or "📝"
        self.featured.visible = bool(t.get("featured"))
        self.hidden.visible = bool(t.get("hidden"))
        self.demo.visible = bool(t.get("demo"))
        self.detail.text = "%s · by %s · used %s%s" % (vb.kind(t.get("kind")).get("label", ""), t.get("by", ""),
                                                       state.plural(t.get("uses") or 0, "time"), (" · " + t["blurb"]) if t.get("blurb") else "")
        state.set_control_attr(self.delete_button, "aria-label", "Delete " + t.get("name", "template"))

    @handle("edit_button", "click")
    def edit_button_click(self, **event_args):
        from ...Dialogs.EditTemplate import EditTemplate
        if alert(EditTemplate(template=self.item), buttons=[], large=True, role="app-dialog", dismissible=True):
            self.parent.raise_event("x-changed")

    @handle("delete_button", "click")
    def delete_button_click(self, **event_args):
        if confirm("", title="Delete this template?", buttons=[("Cancel", False), ("Delete", True)], role="app-dialog"):
            if state.call("admin_template_delete", self.item["id"]) is not None:
                self.parent.raise_event("x-changed")
