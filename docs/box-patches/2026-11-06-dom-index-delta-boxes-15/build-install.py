#!/usr/bin/env python3
"""Regenerate install.sh from install.template.sh, the patches and scrapers/lightsail-crawler/src/dom_index_delta.js.
The patches were made by mkpatch.py from the LIVE post-#719/#720 standalone.js of each box (read 2026-11-06). Run from the repo root."""
import base64, hashlib, subprocess, tempfile, os, shutil
D = 'docs/box-patches/2026-11-06-dom-index-delta-boxes-15/'
md5 = lambda b: hashlib.md5(b).hexdigest()
dd = open('scrapers/lightsail-crawler/src/dom_index_delta.js', 'rb').read()
after = {}
for box, fx in (('b1', 'box1-standalone.before-2026-11-06.js'), ('b5', 'box5-standalone.before-2026-11-06.js')):
    w = tempfile.mkdtemp()
    shutil.copy('scrapers/lightsail-crawler/test/fixtures/' + fx, w + '/standalone.js')
    subprocess.check_call(['patch', '-F0', '-s', 'standalone.js', os.path.abspath(D + 'standalone.js.%s.patch' % box)], cwd=w)
    after[box] = md5(open(w + '/standalone.js', 'rb').read()); shutil.rmtree(w)
b64 = lambda b: base64.encodebytes(b).decode().rstrip()
t = open(D + 'install.template.sh').read()
t = (t.replace('@@DD_MD5@@', md5(dd)).replace('@@B1_AFTER@@', after['b1']).replace('@@B5_AFTER@@', after['b5'])
      .replace('@@DD_B64@@', b64(dd)).replace('@@P1_B64@@', b64(open(D + 'standalone.js.b1.patch', 'rb').read())).replace('@@P5_B64@@', b64(open(D + 'standalone.js.b5.patch', 'rb').read())))
open(D + 'install.sh', 'w').write(t)
os.chmod(D + 'install.sh', 0o755)
print('dom_index_delta.js', md5(dd), 'b1 after', after['b1'], 'b5 after', after['b5'])
