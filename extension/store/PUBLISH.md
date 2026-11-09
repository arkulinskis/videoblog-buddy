# Publishing the extension on the Chrome Web Store

About 20 minutes of clicking, then Google reviews it (usually 1 to 3 days; extensions that run on every site can take longer).
The texts to paste are in `LISTING.md`.

## Once: a developer account

1. Go to https://chrome.google.com/webstore/devconsole and sign in with the Google account that should own the extension.
2. Pay the one-time **US$5** registration fee and accept the developer agreement.
3. Turn on **2-Step Verification** for that Google account (the store requires it before you publish).
4. In **Account**, fill in the publisher name (e.g. Arkvital), a contact email (verify it), and the **trader / non-trader**
   declaration (EU rule: "trader" if this is part of a business).

## Each new version

1. In the project: bump `version` in `extension/manifest.json`, then run
   `python -I tools/build_extension.py` (and `python -I tools/store_assets.py` if the look changed).
2. In the developer dashboard: **New item** (first time) or open the item → **Package** → **Upload new package**, and choose
   `extension/store/videoblog-buddy-store.zip`.
3. **Store listing:** paste the description, pick the category and language, upload the icon, the 5 screenshots and the two
   promo tiles, and add the homepage and support links (all in `LISTING.md`).
4. **Privacy practices:** paste the single purpose and each permission justification, answer "No" to remote code, tick
   **User activity** only, tick the three certifications, and paste the privacy policy link.
5. **Distribution:** Public (or Unlisted to try it first), all regions, free.
6. **Submit for review.** Google emails you when it's live.

## When it's live

1. Copy the extension's store address (it looks like `https://chromewebstore.google.com/detail/videoblog-buddy-recorder/<id>`).
2. In VideoBlog Buddy, **Admin → Settings → Chrome Web Store**, paste it and save. The Extension page and the Studio then
   show an **Add to Chrome** button instead of the zip download (the zip stays available as a fallback).
3. Edge users can install from the Chrome Web Store too. For the Microsoft Edge Add-ons store, upload the same zip at
   https://partner.microsoft.com/dashboard/microsoftedge (free) and paste that address in the same setting instead.

## If the review asks questions

- **"Why all sites?"** The click rings and shortcut badges must be drawn on whatever site the person records. The script
  is idle unless a recording from a connected studio is running, and it never reads page content.
- **"Where does the data go?"** Only to the VideoBlog Buddy site the person connected in the popup. The studio saves the
  click positions with that recording in the person's own account (to make the zooms); nobody else gets them, and
  nothing is sold or shared.
