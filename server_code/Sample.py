"""The sample project every new account gets: a fictional app ("Pocket Garden"), a finished 16:9 video with
two takes and an idea card on the planner. The takes are drawn live in the browser by VB.sample
(web/pages/_a_core.html), so they need no video files. The clicks, markers and speech timing below must
match VB.SAMPLES there (the cursor moves to these clicks; the pause at 17.6-20.4 s is what "Remove pauses"
finds).
"""
import datetime as dt

from anvil.tables import app_tables

from . import common as C

PRODUCT = {"name": "Pocket Garden", "emoji": "\U0001F331", "color": "#2e9d5b", "url": "https://pocket-garden.example",
           "tagline": "Never forget to water a plant again", "audience": "busy plant parents",
           "features": "Watering reminders for every plant\nLog growth with a photo a week\nShare one garden with your household",
           "cta": "Try it free", "notes": "Sample app. Edit it or delete it, and add your own apps."}

TAKES: dict = {
    "garden": {"label": "Screen tour", "mode": "screen_cam", "duration": 40.0,
               "main": {"w": 1280, "h": 720, "type": "sample", "surface": "sample", "audio": True},
               "cam": {"w": 640, "h": 480, "type": "sample", "surface": "sample", "audio": False},
               "markers": [[0, "chapter", "Your garden"], [6, "chapter", "Plant details"], [12.2, "highlight", "Watering"],
                           [20, "chapter", "Add a plant"], [32, "chapter", "Reminders"]],
               "clicks": [[6.0, 0.578, 0.41], [12.2, 0.824, 0.778], [20.0, 0.914, 0.142], [21.2, 0.5, 0.472],
                          [28.0, 0.578, 0.667], [32.0, 0.086, 0.285]]},
    "hello": {"label": "Hello intro", "mode": "cam", "duration": 9.0,
              "main": {"w": 640, "h": 480, "type": "sample", "surface": "sample", "audio": True},
              "cam": None, "markers": [], "clicks": []},
}

SCRIPT = """# Hook
Hi, I'm Sam. I kept killing my plants, so I built Pocket Garden.

# Your garden
[SHOW: the garden page]
Every plant gets its own card, with the next watering on it.

# Plant details
[SHOW: click Basil]
Tap a plant to see its schedule. One tap logs the watering.

# Add a plant
[SHOW: Add plant, type Lemon tree]
Adding a plant takes five seconds. (pause)

# Reminders
[SHOW: Reminders]
And the reminders page tells you what needs water this week.

# Call to action
Try Pocket Garden free. The link is in the description.
"""


def make(user):
    """Create the sample app + videos for this user. Returns the main sample video row."""
    now = C.now()
    prod = app_tables.products.add_row(owner=user, created=now, updated=now, is_demo=False, **PRODUCT)
    video = app_tables.videos.add_row(owner=user, product=prod, title="Pocket Garden in 40 seconds", kind="youtube",
                                      status="edited", due=(now + dt.timedelta(days=3)).date(), script=SCRIPT,
                                      edit={}, publish={}, thumb="", thumb_design={}, duration=0, youtube_url="",
                                      notes="This is a sample. Play it, change it, export it. Delete it whenever you like.",
                                      sample=True, created=now, updated=now, is_demo=False, priority=2, script_versions=[])
    ids = {}
    for key, t in TAKES.items():
        row = app_tables.takes.add_row(video=video, owner=user, key="sample-" + key, label=t["label"], mode=t["mode"],
                                       duration=t["duration"], main=t["main"], cam=t["cam"], cam_offset=0,
                                       markers=t["markers"], clicks=t["clicks"], bytes=0, device="", sample=key, thumb="",
                                       starred=key == "garden", source="sample", created=now, is_demo=False)
        ids[key] = row.get_id()
    video["edit"] = {
        "v": 1, "aspect": "16:9", "layout": "pip", "bg": "mint", "pad": 0.05, "radius": 14,
        "cam": {"pos": "br", "size": 0.24, "shape": "circle", "border": True, "hidden": False},
        "zoom": {"auto": True, "level": 1.7}, "transition": "fade", "voice": 1, "music": {"vol": 0.25, "name": "", "duck": True},
        "watermark": "@pocketgarden", "progress": False,
        "scenes": [
            {"id": "s1", "type": "card", "style": "app", "title": "Pocket Garden", "sub": "Plant care in 40 seconds", "dur": 3,
             "color": "#2e9d5b", "emoji": "\U0001F331"},
            {"id": "s2", "type": "take", "take": ids["hello"], "in": 0.3, "out": 8.6, "cuts": [], "speed": 1, "layout": "",
             "zooms": [], "mute": False,
             "texts": [{"id": "t1", "s": 0.6, "e": 4.4, "text": "Sam Rivera", "sub": "Maker of Pocket Garden", "style": "lower", "pos": "bl"}]},
            {"id": "s3", "type": "take", "take": ids["garden"], "in": 0, "out": 40, "cuts": [[17.8, 20.2]], "speed": 1, "layout": "",
             "zooms": [], "mute": False,
             "texts": [{"id": "t2", "s": 12.4, "e": 15.6, "text": "One tap logs the watering", "sub": "", "style": "callout", "pos": "tl"}]},
            {"id": "s4", "type": "card", "style": "subscribe", "title": "Try Pocket Garden free", "sub": "pocket-garden.example",
             "dur": 3.5, "color": "#cc181e", "emoji": "\U0001F331"},
        ]}
    video["duration"] = 3 + 8.3 + 40 - 2.4 + 3.5
    app_tables.videos.add_row(owner=user, product=prod, title="3 watering mistakes that kill basil", kind="short", status="idea",
                              due=(now + dt.timedelta(days=9)).date(), script="", edit={}, publish={}, thumb="", thumb_design={},
                              duration=0, youtube_url="", notes="Sample idea: a vertical Short. Drag it along the planner as it moves.",
                              sample=True, created=now - dt.timedelta(minutes=1), updated=now - dt.timedelta(minutes=1), is_demo=False,
                              priority=3, script_versions=[])
    return video
