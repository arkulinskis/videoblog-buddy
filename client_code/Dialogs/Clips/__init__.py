import anvil.server
from anvil import *

from ._anvil_designer import ClipsTemplate
from ... import state


def clips_of(video, reply):
    """One clip per chapter/highlight marker of the video's takes, up to 90 s each (at least 4 s)."""
    clips = []
    for t in reply.get("takes") or []:
        marks = sorted([m for m in (t.get("markers") or []) if m[1] in ("chapter", "highlight")], key=lambda m: m[0])
        for i, m in enumerate(marks):
            a = m[0]
            b = marks[i + 1][0] if i + 1 < len(marks) else (t.get("duration") or 0)
            b = min(b, a + 90)
            if b - a >= 4:
                label = m[2] if len(m) > 2 and m[2] else ""
                name = (reply["product"]["name"] if reply.get("product") else video.get("title", ""))[:60]
                clips.append({"take": t["id"], "in": round(a, 2), "out": round(b, 2), "on": True,
                              "title": (label or "Clip %d" % (len(clips) + 1)) + " · " + name,
                              "label": label or "Clip", "from": t.get("label") or ""})
    return clips


class Clips(ClipsTemplate):
    """Shorts from chapters: tick the chapters to turn into vertical Shorts (server video_remix with a clip).
    Closes with True when it made some."""

    def __init__(self, video=None, clips=None, **properties):
        super().__init__(**properties)
        self.video: dict = video or {}
        self.clips = clips or []
        self.clips_panel.items = self.clips

    @handle("cancel_button", "click")
    def cancel_button_click(self, **event_args):
        self.raise_event("x-close-alert", value=False)

    @handle("make_button", "click")
    def make_button_click(self, **event_args):
        pick = [c for c in self.clips if c.get("on")]
        if not pick:
            return
        made = 0
        self.make_button.enabled = False
        try:
            for c in pick:
                r = anvil.server.call("video_remix", self.video["id"], "short",
                                      {"take": c["take"], "in": c["in"], "out": c["out"], "title": c["title"]})
                if r and r.get("ok") is not False:
                    made += 1
        finally:
            self.make_button.enabled = True
        state.toast("Made %s. They're on your planner." % state.plural(made, "Short"), "ok")
        self.raise_event("x-close-alert", value=True)
