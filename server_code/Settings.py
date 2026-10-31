"""App-wide settings an admin sets once: the Google OAuth client id for direct YouTube uploads and the Chrome
Web Store address of the extension. Neither is a secret (both end up in the browser anyway), so anyone can
read them with public_config.
"""
import re

import anvil.server

from . import common as C

KEYS = {"google_client_id": "", "extension_store_url": ""}
CLIENT_ID = re.compile(r"^[0-9]{6,20}-[a-z0-9]{8,64}\.apps\.googleusercontent\.com$")
STORE = re.compile(r"^https://(chromewebstore\.google\.com|chrome\.google\.com/webstore|microsoftedge\.microsoft\.com/addons)/[^\s<>\"']{4,300}$")


def _all():
    return {k: C.get_setting(k, d) or d for k, d in KEYS.items()}


@anvil.server.callable
def public_config():
    """What the browser needs to know: is YouTube upload set up, and where is the extension in the store."""
    return _all()


@anvil.server.callable(require_user=True)
def admin_settings_get():
    C.require_admin()
    return _all()


@anvil.server.callable(require_user=True)
def admin_settings_save(values):
    C.require_admin()
    values = values if isinstance(values, dict) else {}
    out = {}
    if "google_client_id" in values:
        cid = C.text(values.get("google_client_id"), 120).strip()
        if cid and not CLIENT_ID.match(cid):
            return C.fail("That doesn't look like a Google OAuth client ID (it ends in .apps.googleusercontent.com).")
        out["google_client_id"] = cid
    if "extension_store_url" in values:
        url = C.text(values.get("extension_store_url"), 320).strip()
        if url and not STORE.match(url):
            return C.fail("Paste the extension's page in the Chrome Web Store (https://chromewebstore.google.com/detail/…).")
        out["extension_store_url"] = url
    for k, v in out.items():
        C.set_setting(k, v)
    return C.ok(settings=_all())
