# Chrome Web Store listing: VideoBlog Buddy Recorder

Everything to paste into the Chrome Web Store developer dashboard. The steps are in `PUBLISH.md`.

## Package

- **Zip to upload:** `extension/store/videoblog-buddy-store.zip` (made by `python -I tools/build_extension.py`; manifest at the top).
- **Version:** 1.1.0 (bump `version` in `extension/manifest.json` for every new upload).

## Store listing tab

**Name** (from the manifest): VideoBlog Buddy Recorder

**Summary** (from the manifest, 132 characters max):
One-click tab recording, click rings and auto-zoom on your clicks for VideoBlog Buddy.

**Category:** Productivity → Tools
**Language:** English

**Description:**

```
Make screen videos that look pro: for YouTube, Shorts, Reels and product demos.

VideoBlog Buddy Recorder is the companion of VideoBlog Buddy (videoblog-buddy.anvil.app), the browser studio for people who build apps and want to show them off. The studio records your screen and camera on its own; this extension makes it faster and better looking.

WHAT IT ADDS
• Record this tab in one click. Go to the tab you want to show, click the red icon, press Record. No hunting through the share dialog.
• Your clicks become smooth zooms. Every click in the recorded tab is saved with its position, and the editor zooms in on it automatically.
• A red ring where you click, so viewers can follow along.
• Shortcut badges: press Ctrl+K and viewers see "Ctrl + K" on screen (never the letters you type).
• Draw on any page: Alt+Shift+D, then drag to circle things. The ink fades by itself.
• Control the recording from any tab: Alt+Shift+R stops, Alt+Shift+P pauses, Alt+Shift+M drops a chapter marker.

THEN, IN THE STUDIO
Trim, cut pauses, remove the "um"s by deleting words, add captions written on your own computer, title cards, music, blur passwords, make vertical Shorts, write the description with chapters, and upload to YouTube.

PRIVATE BY DESIGN
• It only talks to the VideoBlog Buddy site you connect in its popup. Nothing else, nobody else.
• While you record, it sends that site the position and time of your clicks in the recorded tab. That's it.
• It never reads or sends what you type, page content or your browsing history.
• Your recordings are made and kept in your browser; nothing is uploaded unless you choose to post it.

Works in Chrome, Edge, Brave, Arc and Opera.
```

**Graphic assets** (all in `extension/store/`, made by `python -I tools/store_assets.py`):
- Store icon (128×128): `extension/icons/icon-128.png`
- Screenshots (1280×800): `screenshot-1.png` … `screenshot-5.png`
- Small promo tile (440×280): `promo-small.png`
- Marquee promo tile (1400×560): `promo-marquee.png`

**Additional fields:**
- Homepage URL: https://videoblog-buddy.anvil.app/
- Support URL: https://videoblog-buddy.anvil.app/#extension
- Official URL: leave empty (only for a domain verified in Google Search Console).
- Mature content: No.

## Privacy practices tab

**Single purpose:**
```
Record a browser tab for the VideoBlog Buddy video studio and show viewers where you click (click rings, shortcut badges, a drawing pen), sending click positions to the studio for automatic zooms.
```

**Permission justifications:**

- **tabCapture:**
  ```
  Records the current tab when the user presses "Record this tab" in the popup. The stream is handed to the VideoBlog Buddy studio tab the user connected, which records it locally in the browser.
  ```
- **activeTab:**
  ```
  Identifies the tab the user is on when they open the popup, so that exact tab can be recorded or controlled.
  ```
- **tabs:**
  ```
  Finds the user's connected VideoBlog Buddy studio tab (by its address) to hand it the recording and relay Pause / Stop / Marker shortcuts, and switches back to it when a recording ends.
  ```
- **storage:**
  ```
  Remembers which VideoBlog Buddy sites the user connected and their options (click rings, shortcut badges).
  ```
- **Host permission (content script on all sites):**
  ```
  While a recording is running, the content script draws the click ring, shortcut badges and pen on the page, and reports click positions in the recorded tab (x/y and time only) to the connected studio, which saves them with that recording for automatic zooms. When nothing is being recorded it does nothing. It never reads page content or what the user types.
  ```
- **Remote code:** No, I am not using remote code. (Everything is in the package.)

**Data usage** (tick these):
- [x] **User activity** (clicks, mouse position): click positions in the recorded tab, sent only to the user's connected VideoBlog Buddy site.
- Leave every other category unticked (no personal info, health, financial, authentication, personal communications, location, web history, website content).

**Certify all three:**
- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL:** https://videoblog-buddy.anvil.app/#legal/privacy

## Distribution tab

- **Visibility:** Public (or Unlisted while you try it: only people with the link can install it).
- **Regions:** All regions.
- **Payments:** Free.
