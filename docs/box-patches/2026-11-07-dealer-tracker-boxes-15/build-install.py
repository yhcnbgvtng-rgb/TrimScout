#!/usr/bin/env python3
"""Regenerate the patches and install.sh from the tracker source, the live post-#721 fixtures and mkpatch.py. Run from the repo root.
The fixtures are the LIVE standalone.js of box1 and box5 read (read-only) 2026-11-07; their md5s are what install.sh pins."""
import base64, hashlib, subprocess, tempfile, os, shutil
D = 'docs/box-patches/2026-11-07-dealer-tracker-boxes-15/'
F = 'scrapers/lightsail-crawler/test/fixtures/'
md5 = lambda b: hashlib.md5(b).hexdigest()
dt = open('scrapers/lightsail-crawler/src/dealerTracker.js', 'rb').read()
bj726 = open(D + 'bigJson.726.md5').read().strip()
after = {}
for box, fx in (('b1', 'box1-standalone.post721-2026-11-07.js'), ('b5', 'box5-standalone.post721-2026-11-07.js')):
    w = tempfile.mkdtemp()
    subprocess.check_call(['python3', D + 'mkpatch.py', F + fx, w + '/tracked.js'])
    with open(D + 'standalone.js.%s.patch' % box, 'w') as out:
        subprocess.call(['diff', '-u', '--label', 'a/standalone.js', '--label', 'b/standalone.js', F + fx, w + '/tracked.js'], stdout=out)
    shutil.copy(F + fx, w + '/standalone.js')
    subprocess.check_call(['patch', '-F0', '-s', 'standalone.js', os.path.abspath(D + 'standalone.js.%s.patch' % box)], cwd=w)
    after[box] = md5(open(w + '/standalone.js', 'rb').read()); shutil.rmtree(w)
b64 = lambda b: base64.encodebytes(b).decode().rstrip()
t = open(D + 'install.template.sh').read()
t = (t.replace('@@DT_MD5@@', md5(dt)).replace('@@B1_AFTER@@', after['b1']).replace('@@B5_AFTER@@', after['b5']).replace('@@BJ_726@@', bj726)
      .replace('@@DT_B64@@', b64(dt)).replace('@@P1_B64@@', b64(open(D + 'standalone.js.b1.patch', 'rb').read())).replace('@@P5_B64@@', b64(open(D + 'standalone.js.b5.patch', 'rb').read())))
open(D + 'install.sh', 'w').write(t)
os.chmod(D + 'install.sh', 0o755)
print('dealerTracker.js', md5(dt), 'b1 after', after['b1'], 'b5 after', after['b5'])
