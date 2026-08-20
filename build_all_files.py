# -*- coding: utf-8 -*-
import os

BASE = '/Users/paulsmith/.gemini/antigravity/scratch/trimscout'

def write_f(path, content):
    p = os.path.join(BASE, path)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, 'w', encoding='utf-8') as f:
        f.write(content.strip() + chr(10))
    print('Successfully wrote ' + path)

print('Builder initialized')
