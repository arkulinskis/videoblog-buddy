"""Build the browser extension download: icons from assets/icon.svg + a zip the app serves.

    python -I tools/build_extension.py

Writes extension/icons/icon-{16,32,48,128}.png (headless Chrome draws them),
assets/videoblog-buddy-extension.zip (folder "videoblog-buddy-extension/" inside), which the app links to at
_/theme/videoblog-buddy-extension.zip, and extension/store/videoblog-buddy-store.zip (files at the top, as the
Chrome Web Store wants it). Run it after changing anything in extension/ (bump the version), then deploy.
"""
import json
import pathlib
import subprocess
import sys
import zipfile

HERE = pathlib.Path(__file__).resolve().parent
PROJECT = HERE.parent
EXT = PROJECT / "extension"
OUT = PROJECT / "assets" / "videoblog-buddy-extension.zip"
STORE_ZIP = EXT / "store" / "videoblog-buddy-store.zip"
sys.path.insert(0, str(HERE))
import make_icons  # noqa: E402

FILES = ["manifest.json", "background.js", "content.js", "popup.html", "popup.css", "popup.js"]


def main():
    manifest = json.loads((EXT / "manifest.json").read_text(encoding="utf-8"))
    (EXT / "icons").mkdir(exist_ok=True)
    for size in (16, 32, 48, 128):
        make_icons.render(size, EXT / "icons" / ("icon-%d.png" % size))
    for f in FILES:
        if not (EXT / f).exists():
            sys.exit("missing extension/" + f)
        if f.endswith(".js"):
            r = subprocess.run(["node", "--check", str(EXT / f)], capture_output=True, text=True)
            if r.returncode:
                sys.exit("extension/%s doesn't parse:\n%s" % (f, r.stderr))
    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as z:
        for f in FILES + ["icons/icon-%d.png" % s for s in (16, 32, 48, 128)]:
            z.write(EXT / f, "videoblog-buddy-extension/" + f)
    STORE_ZIP.parent.mkdir(exist_ok=True)
    with zipfile.ZipFile(STORE_ZIP, "w", zipfile.ZIP_DEFLATED) as z:
        for f in FILES + ["icons/icon-%d.png" % s for s in (16, 32, 48, 128)]:
            z.write(EXT / f, f)
    print("wrote %s (%d KB, version %s)" % (OUT, OUT.stat().st_size // 1024, manifest["version"]))
    print("wrote %s (for the Chrome Web Store)" % STORE_ZIP)


if __name__ == "__main__":
    main()
