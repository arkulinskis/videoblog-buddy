"""Chrome Web Store images for the extension.

    python -I tools/store_assets.py

Starts the dev server, captures the app (sample project, light theme) into extension/store/raw/*.png, then renders
each slide of extension/store/art.html into extension/store/:
    screenshot-1..5.png (1280x800), promo-small.png (440x280), promo-marquee.png (1400x560)
Change the words and layout in art.html. The store zip itself is made by tools/build_extension.py.
"""
import json
import pathlib
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request

HERE = pathlib.Path(__file__).resolve().parent
PROJECT = HERE.parent
STORE = PROJECT / "extension" / "store"
DRIVE = HERE / "live" / "drive.mjs"

LATER = "document.querySelectorAll('button').forEach(function(b){if(b.textContent.trim()==='Later')b.click()});"
GO_EDIT = ("(async()=>{UI.setTheme('light');" + LATER + "var r=await UI.api('studio_home');var v=r.videos.filter(function(x){return x.sample&&x.kind==='youtube'})[0];"
           "location.hash='#edit/'+v.id;var end=Date.now()+15000;while(!(window.VB._editPage&&VB._editPage.plan()&&VB._editPage.plan().outDur)&&Date.now()<end)await new Promise(r=>setTimeout(r,200));"
           "await new Promise(r=>setTimeout(r,800));var P=VB._editPage;var t=P.takes().filter(function(x){return x.sample==='garden'})[0];"
           "var i=P.edit().scenes.map(function(s){return s.take}).indexOf(t.id);var ps=P.plan().scenes.filter(function(s){return s.i===i})[0];%s;" + LATER + "return 1})()")
OVERLAY = ("var c=document.createElement('canvas');c.width=1280;c.height=720;c.style.cssText='position:fixed;left:0;top:0;z-index:999999';"
           "document.body.appendChild(c);")
RAWS = {
    # the sample app's screen, as if it were the tab being recorded
    "garden": ("1280,720", GO_EDIT % (OVERLAY + "VB.drawSampleScreen(c.getContext('2d'),6.4,1280,720)")),
    # the edit at the moment it zooms in on the Basil click
    "zoom": ("1280,720", GO_EDIT % (OVERLAY + "var src=ps.src;src.frame(7.4);var e=JSON.parse(JSON.stringify(P.edit()));e.aspect='16:9';e.layout='pip';"
                                    "var pl=VB.plan(e,P.takes(),(function(){var m={};P.plan().scenes.forEach(function(s){if(s.src)m[s.take.id]=s.src});return m})());"
                                    "var si=pl.scenes.map(function(s){return s.i}).indexOf(i);VB.render(c.getContext('2d'),1280,720,pl,VB.outOf(pl,si,7.4),{noTransitions:true})")),
    # the editor's Words tab with captions on
    "words": ("1280,800", GO_EDIT % ("P.select(i,true);P.tab('words');await new Promise(r=>setTimeout(r,300));var b=document.querySelector('[data-asr]');if(b){b.click();"
                                     "await new Promise(r=>setTimeout(r,1500));}P.tab('words');P.player().seek(ps.start+8.4);await new Promise(r=>setTimeout(r,900))")),
    "studio": ("1280,800", "(async()=>{UI.setTheme('light');" + LATER + "await new Promise(r=>setTimeout(r,500));return 1})()"),
}
SLIDES = [("screenshot-1", "s1", "1280,800"), ("screenshot-2", "s2", "1280,800"), ("screenshot-3", "s3", "1280,800"),
          ("screenshot-4", "s4", "1280,800"), ("screenshot-5", "s5", "1280,800"), ("promo-small", "small", "440,280"),
          ("promo-marquee", "marquee", "1400,560")]


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


def drive(url, steps, window, out_png, exact=True):
    work = pathlib.Path(tempfile.mkdtemp(prefix="store-"))
    (work / "steps.json").write_text(json.dumps(steps + [{"shot": "x", "full": True}]), encoding="utf-8")
    import os
    r = subprocess.run(["node", str(DRIVE), url, str(work / "steps.json"), str(work)], capture_output=True, text=True,
                       encoding="utf-8", errors="replace", env=dict(os.environ, WINDOW=window), timeout=180)
    png = work / "x.png"
    if not png.exists():
        sys.exit("no picture for %s:\n%s" % (out_png.name, r.stdout[-2000:]))
    bad = [l for l in r.stdout.splitlines() if "EXCEPTION" in l or "TIMEOUT" in l or "EVAL ERROR" in l]
    if bad:
        print("  warning:", out_png.name, " | ".join(bad)[:400])
    png.replace(out_png)
    w, h = png_size(out_png)
    want = tuple(int(x) for x in window.split(","))
    print("  %s %dx%d%s" % (out_png.relative_to(PROJECT), w, h, "" if (w, h) == want or not exact else "  (WANTED %dx%d)" % want))
    return (w, h) == want or not exact


def png_size(p):
    b = p.read_bytes()[16:24]
    return int.from_bytes(b[:4], "big"), int.from_bytes(b[4:], "big")


def main():
    (STORE / "raw").mkdir(parents=True, exist_ok=True)
    port = free_port()
    srv = subprocess.Popen([sys.executable, "-I", str(HERE / "preview" / "devserver.py"), str(port)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(150):
            try:
                urllib.request.urlopen("http://127.0.0.1:%d/state" % port, timeout=1)
                break
            except Exception:
                time.sleep(0.2)
        print("capturing the app")
        for name, (window, js) in RAWS.items():
            url = "http://127.0.0.1:%d/?as=ana#home" % port
            drive(url, [{"waitFor": "window.UI_READY === true", "timeout": 20000}, {"wait": 600}, {"eval": js}, {"wait": 700}], window, STORE / "raw" / (name + ".png"), exact=False)
    finally:
        srv.kill()
    print("rendering the store images")
    bad = 0
    for out, sid, window in SLIDES:
        url = (STORE / "art.html").as_uri() + "?s=" + sid
        bad += not drive(url, [{"waitFor": "window.ARTREADY === true", "timeout": 20000}, {"wait": 300}], window, STORE / (out + ".png"))
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
