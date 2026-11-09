import anvil.server
from anvil import *

from ._anvil_designer import NewVideoTemplate
from ... import state, vb


class NewVideo(NewVideoTemplate):
    """New video (Studio, planner, apps page). opts: product_id, kind, status, title, script, due, handle, tpl.
    A built-in script template (VB.TEMPLATES) is filled in with the app's details. Closes with the new video or None."""

    def __init__(self, products=None, opts=None, **properties):
        super().__init__(**properties)
        self.products = products or []
        self.opts: dict = dict(opts or {})
        self.tpls = vb.templates()
        o = self.opts
        self.title_box.text = o.get("title") or ""
        self.product_box.items = [("No app", "")] + [((p.get("emoji") + " " if p.get("emoji") else "") + p["name"], p["id"]) for p in self.products]
        self.product_box.selected_value = o.get("product_id") or ""
        self.kind_box.items = [("%s %s (%s)" % (k["emoji"], k["label"], k["aspect"]), k["key"]) for k in vb.kinds()]
        self.kind_box.selected_value = o.get("kind") or "youtube"
        self.tpl_box.items = [("A blank page", "")] + [(t["emoji"] + " " + t["name"], t["key"]) for t in self.tpls]
        self.tpl_box.selected_value = o.get("tpl") or ""
        state.set_control_attr(self.due_box, "type", "date")
        self.due_box.text = o.get("due") or ""
        state.set_control_attr(self.title_box, "maxlength", 100)

    @handle("", "show")
    def form_show(self, **event_args):
        self.title_box.focus()

    @handle("title_box", "pressed_enter")
    def title_box_pressed_enter(self, **event_args):
        self.create_button_click()

    @handle("cancel_button", "click")
    def cancel_button_click(self, **event_args):
        self.raise_event("x-close-alert", value=None)

    @handle("create_button", "click")
    def create_button_click(self, **event_args):
        title = (self.title_box.text or "").strip()
        if len(title) < 2:
            self.message.text, self.message.visible = "Give the video a title.", True
            return
        pid = self.product_box.selected_value or None
        product = ([p for p in self.products if p["id"] == pid] or [None])[0]
        tpl = ([t for t in self.tpls if t["key"] == self.tpl_box.selected_value] or [None])[0]
        due = (state.control(self.due_box).value or "") or None
        fields = {"title": title, "kind": self.kind_box.selected_value or "youtube", "product_id": pid, "due": due,
                  "status": self.opts.get("status") or ("script" if tpl else "idea")}
        if tpl:
            fields["script"] = vb.fill(tpl["body"], product, self.opts.get("handle"))
        elif self.opts.get("script"):
            fields["script"] = self.opts["script"]
        self.create_button.enabled = False
        try:
            r = anvil.server.call("video_create", fields)
        finally:
            self.create_button.enabled = True
        if not r or r.get("ok") is False:
            self.message.text, self.message.visible = (r or {}).get("error") or "That didn't work.", True
            return
        state.toast("Video created", "ok")
        self.raise_event("x-close-alert", value=r["video"])
