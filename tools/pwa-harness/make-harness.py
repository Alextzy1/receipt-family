"""Builds harness.html from ../../web/index.html: same page, but loads mock.js (mock backend) instead of config.js.
Serve the repo root:  python -m http.server 8765   then open /tools/pwa-harness/harness.html"""
import pathlib
here = pathlib.Path(__file__).parent
s = (here / '../../web/index.html').read_text(encoding='utf8')
s = s.replace('href="style.css"', 'href="../../web/style.css"').replace('href="icons/', 'href="../../web/icons/')
s = s.replace('src="icons/', 'src="../../web/icons/').replace('href="manifest.webmanifest"', 'href="../../web/manifest.webmanifest"')
s = s.replace('<script src="config.js"></script>', '<script src="mock.js"></script>').replace('<script src="app.js"></script>', '<script src="../../web/app.js"></script>')
(here / 'harness.html').write_text(s, encoding='utf8')
print('harness.html written')
