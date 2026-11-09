import anvil.js
import anvil.server
from anvil import *
from anvil.js import window

from ._anvil_designer import AppsTemplate
from ... import router, state, vb


class Apps(AppsTemplate):
    """#apps and #apps/<id>: the apps you make videos about (name, emoji, colour, link, pitch, audience, features,
    call to action). Script templates, ideas, title cards and publish kits fill themselves in from these. The detail
    view lists the app's videos and the idea machine's suggestions (VB.ideasFor) with "Plan it"."""

    def __init__(self, args=(), **properties):
        super().__init__(**properties)
        self.pid = args[0] if args else ""
        self.data: dict = {}
        state.heading(self.hero_name, 1)
        self.load()

    def load(self):
        self.data = anvil.server.call("planner_get")
        self.draw()

    def product(self):
        return ([p for p in self.data.get("products") or [] if p["id"] == self.pid] or [None])[0]

    def draw(self):
        p = self.product() if self.pid else None
        if self.pid and not p:
            state.toast("That app wasn't found.")
            self.pid = ""
        self.list_view.visible = not p
        self.detail_view.visible = bool(p)
        if p:
            self.draw_one(p)
        else:
            self.draw_list()

    def _count(self, p, status=None):
        return len([v for v in self.data["videos"] if v.get("product") and v["product"]["id"] == p["id"] and (not status or v["status"] == status)])

    def draw_list(self):
        self.apps_panel.items = [dict(p, n=self._count(p), n_pub=self._count(p, "published")) for p in self.data["products"]]

    def draw_one(self, p):
        window.document.title = p["name"] + " · VideoBlog Buddy"
        vids = [v for v in self.data["videos"] if v.get("product") and v["product"]["id"] == p["id"]]
        col = p.get("color") or "#cc181e"
        self.hero.style["background"] = "linear-gradient(135deg, %s, %s)" % (col, vb.mix(col, -0.45))
        self.hero_emoji.text = p.get("emoji") or "📦"
        self.hero_name.text = p["name"]
        self.hero_tagline.text = p.get("tagline") or ""
        self.hero_url.visible = bool(p.get("url"))
        if p.get("url"):
            state.set_attr(self.hero_url, "href", p["url"])
            anvil.js.get_dom_node(self.hero_url).textContent = p["url"]
        self.videos_title.text = "Videos (%d)" % len(vids)
        self.videos_panel.items = vids
        self.videos_panel.visible = bool(vids)
        self.no_videos.visible = not vids
        self.no_videos_title.text = "No videos about %s yet" % p["name"]
        self.ideas_title.text = "💡 Ideas for " + p["name"]
        have = [v["title"].lower() for v in self.data["videos"]]
        ideas = []
        for n, i in enumerate(vb.ideas_for(p)):
            k = vb.kind(i.get("kind"))
            ideas.append({"title": i["title"], "kind_label": k["emoji"] + " " + k["label"], "done": i["title"].lower() in have,
                          "done_text": "Planned", "button_text": "Plan it", "idx": n, "host": self})
        self.ideas_panel.items = ideas
        feats = [s.strip() for s in (p.get("features") or "").split("\n") if s.strip()]
        self.audience.text = "For: " + (p.get("audience") or "—")
        self.features.text = "\n".join("• " + f for f in feats) if feats else "No features listed yet."
        self.cta.text = "Call to action: " + (p.get("cta") or "—")
        self.notes.text = p.get("notes") or ""
        self.notes.visible = bool(p.get("notes"))

    # ---- actions
    def _edit(self, p):
        from ...Dialogs.EditProduct import EditProduct
        return alert(EditProduct(product=p), buttons=[], large=True, role="app-dialog", dismissible=True)

    @handle("add_button", "click")
    def add_button_click(self, **event_args):
        np = self._edit(None)
        if np:
            router.go("apps", np["id"])

    @handle("add_tile", "click")
    def add_tile_click(self, **event_args):
        self.add_button_click()

    @handle("edit_button", "click")
    def edit_button_click(self, **event_args):
        if self._edit(self.product()):
            self.load()

    @handle("new_video_button", "click")
    def new_video_button_click(self, **event_args):
        vb.new_video(self.data["products"], product_id=self.pid, handle=self.data.get("handle"))

    @handle("delete_button", "click")
    def delete_button_click(self, **event_args):
        p = self.product()
        if p and confirm("Its videos stay in your library, without an app.", title="Delete %s?" % p["name"],
                         buttons=[("Cancel", False), ("Delete", True)], role="app-dialog"):
            if state.call("product_delete", p["id"]):
                state.toast("Deleted", "ok")
                router.go("apps")

    def plan_idea(self, idx):
        """IdeaCard -> "Plan it": the idea becomes a video with its script written from the template."""
        p = self.product()
        idea = vb.ideas_for(p)[idx]
        tpl = ([t for t in vb.templates() if t["key"] == idea.get("tpl")] or [None])[0]
        r = state.call("video_create", {"title": idea["title"], "kind": idea["kind"], "product_id": p["id"], "status": "script",
                                        "script": vb.fill(tpl["body"], p, self.data.get("handle")) if tpl else ""})
        if r:
            state.toast("Planned with a script ready", "ok")
            self.data["videos"].insert(0, r["video"])
            self.draw()
