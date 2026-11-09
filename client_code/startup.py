"""The app starts here (anvil.yaml: startup module). One server call to learn who is signed in (Anvil's loading
spinner shows meanwhile), the Privacy & Terms kit, the bridge the JavaScript engines use (vb.setup), then the page for
the address in the browser bar."""
import anvil.server

from . import legal, router, state, vb

LEGAL_THEME = {"accent": "#cc181e"}  # colours for the Privacy & Terms page (match --c-brand in app.css)

legal.setup(LEGAL_THEME)
vb.setup()
state.set_me(anvil.server.call("get_me"))
if state.me():
    legal.refresh_soon()
router.start()
