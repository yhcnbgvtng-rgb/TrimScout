#!/usr/bin/env python3
"""Regenerate install.sh from install.template.sh and scrapers/lightsail-crawler/src/bigJson.js (embedded as base64). Run from the repo root."""
import base64, hashlib, os
D = 'docs/box-patches/2026-11-07-bigjson-parse-as-read-boxes-15/'
bj = open('scrapers/lightsail-crawler/src/bigJson.js', 'rb').read()
t = open(D + 'install.template.sh').read()
t = t.replace('@@BJ_AFTER@@', hashlib.md5(bj).hexdigest()).replace('@@BJ_B64@@', base64.encodebytes(bj).decode().rstrip())
open(D + 'install.sh', 'w').write(t); os.chmod(D + 'install.sh', 0o755)
print('bigJson.js', hashlib.md5(bj).hexdigest())
