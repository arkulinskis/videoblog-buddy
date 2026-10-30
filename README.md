# VideoBlog Buddy

A screen + camera recorder and video editor that runs in the browser, for people who build apps and want to make YouTube
videos, Shorts and Reels about them. Record takes (screen with a camera bubble, screen only, or camera), edit them (trim,
remove pauses, zoom on clicks, title cards, text, vertical layouts, music), export an MP4, then get a thumbnail and the
words to publish it (title, description with chapters, tags, captions). A planner and an "apps" list keep a channel going.
Recordings never leave the user's computer. Classic red-and-white "broadcast yourself" look. Built on [Anvil](https://anvil.works).

- **App repo:** github.com/arkulinskis/videoblog-buddy (branch `master`). Anvil pulls `master`.
- **Live:** not published yet (planned videoblogbuddy.anvil.app).
- **Browser extension:** source in `extension/`, served zipped at `_/theme/videoblog-buddy-extension.zip` (load unpacked).

## What it does

**For visitors:** a landing page whose hero is a classic watch page playing the sample video live, how it works, features,
FAQ; the extension page (`#extension`); sign-up; feedback; Privacy & Terms.

**For members:**
- **Studio** (`#home`): channel banner, stats (videos, published, minutes recorded, exports), every video as a card with
  status, length and app (filters, app filter, search, "⋯" menu: open, record, edit, make a Short/Reel version, delete),
  8 achievements, storage on this computer (+ "keep them safe" persistent storage, manage files), extension status,
  your apps. Rescues unfinished recordings (a crashed tab loses at most a second). New accounts get a sample project.
- **Record** (`#record[/video]`): Screen + camera, Screen only, Camera only; camera + mic pickers, live mic level and a
  "is your mic muted?" warning, tab/system sound, camera bubble shape and corner, 720p/1080p, countdown, teleprompter
  that scrolls when you record, floating always-on-top controls (Document Picture-in-Picture: timer, pause, marker, stop,
  camera, teleprompter), keys M (marker) P (pause) S (stop), pause/resume, restart, review each take (play it, name it,
  keep / retake / discard / download raw), import a video file as a take. Screen and camera are recorded as two files.
- **Video** (`#video/<id>`): player for the current edit (classic red progress bar with chapter ticks), title, status
  pipeline (Idea → Script → Recorded → Edited → Published), app, format, publish-by date; tabs:
  **Takes** (rename, star, download, delete, re-link a file recorded elsewhere), **Script** (writer with live preview,
  8 built-in + admin templates filled from the app's details, word count / spoken length, full-screen teleprompter),
  **Publish kit** (title ideas, description with chapters from markers, tags, hashtags, pinned comment, Shorts/Reels
  caption, copy buttons, upload checklist with automatic ticks, YouTube link, mark as published with confetti),
  **Thumbnail** (5 layouts, big words, colours, emoji, frame from any take, face circle from the camera, red arrow;
  saves the library picture, downloads a 1280×720 JPG under 2 MB).
- **Editor** (`#edit/<id>`): scenes strip (takes + title cards; drag to reorder), the selected take's track (waveform,
  trims, cuts, zooms, text, markers, clicks, playhead): drag to select → cut it / keep only this / zoom / text; drag the
  edges to trim; click a cut to restore it. Split at playhead, Remove pauses (one take or all, adjustable), zooms made
  automatically from recorded clicks (or adjusted by hand with a focus picker), per-scene speed, layout, camera override,
  mute; text overlays (name tag, callout, subtitle, big title, sticky note); title cards (app, classic, bold, minimal,
  animated "subscribe"); style: 16:9 / 9:16 / 1:1, layouts (camera bubble, stacked, follow-the-action crop, side by side,
  screen, camera), backgrounds, padding, rounded corners, bubble shape/size/corner/border, transitions (cut, fade, flash),
  watermark, red progress bar; audio: voice volume, background music (ducks under your voice in the export).
  Undo/redo, autosave, keyboard (space, arrows, S, Ctrl+Z). Export in the browser to MP4 (or WebM) at 1080p/720p with a
  live preview; then publish kit / thumbnail links and badges.
- **Planner** (`#planner`): Idea → Published board (drag or arrows; phone shows one column), "coming up" by due date,
  app filter, idea machine (8 ideas per app, added with a script already written).
- **Apps** (`#apps[/id]`): the apps you make videos about (emoji, colour, link, pitch, audience, features, call to action)
  and each one's videos and ideas.
- **Teleprompter** (`#prompter/<id>`): full screen, speed, size, mirror, keyboard.
- **Browser extension** (Chrome/Edge/Brave): one-click "Record this tab" (tabCapture, no picker), red click rings and
  shortcut badges drawn on the page, clicks sent to the app for auto-zoom, drawing pen (Alt+Shift+D), shortcuts
  Alt+Shift+R/P/M from any tab, popup controls. It only talks to sites you connect in its popup.

**For admins** (`#admin`; arkulinskis@gmail.com becomes an admin on first sign-in): overview (users, active, videos,
takes, minutes, exports, vertical exports, apps, extension takes) + a 14-day chart, **script templates** (add, edit,
feature, hide), feedback inbox, users, demo data (community templates by demo people).

## Setting it up in Anvil (once)

1. In the Anvil editor: **Create app → Clone from GitHub**, and paste `https://github.com/arkulinskis/videoblog-buddy`.
2. **Users** service: email + password, sign-up allowed (already set in `anvil.yaml`; check it).
3. Open the app in the editor. If it shows a **Schema Mismatch** alert, choose **"The schema of the source code is correct"** so Anvil creates the tables.
4. **Run** it and sign up with **arkulinskis@gmail.com** straight away (that account becomes the admin).
5. **Publish** (Publish → public URL, or your own domain).

## Working on it

See `.claude/skills/videoblogbuddy/SKILL.md`. In short:

```
python -I tools/check.py --ui                    # syntax, server tests, headless UI tests (real recording + export) → ALL CHECKS PASSED
python -I tools/preview/devserver.py 8794        # the app on in-memory data: http://localhost:8794/  (?as=ana#home, ?as=admin#admin)
python -I tools/build_extension.py               # after changing extension/: icons + assets/videoblog-buddy-extension.zip
python tools/deploy.py                           # dry run (needs PyYAML, so no -I)
python tools/deploy.py --push "Message"          # deploy: commit + push to GitHub, Anvil pulls it
```

## Project layout

```
web/            core.js/core.css (engine + design tokens), app.js (header, footer), pages/*.html
                _a_core (VB helpers, vault, extension bridge, sample drawings), _b_engine (plan, render, player, export,
                thumbnails), _c_recorder (recorder, floating window, teleprompter), _d_kit (templates, ideas, publish kit)
client_code/    Main.py (the only Anvil form), legal.py
server_code/    common, Accounts, Feedback, Admin, DemoData, legal_server, Studio (videos, takes, exports, stats, badges),
                Products (apps), Templates (admin script templates), Clean (validates edits/publish/markers/clicks), Sample
extension/      the Chrome extension (manifest, background.js, content.js, popup.*, icons/)
assets/         icon.svg + PNG icons, videoblog-buddy-extension.zip (served at _/theme/<name>)
tools/          sync_to_anvil.py (settings + schema), deploy.py, check.py, build_extension.py, preview/, testing/
```
