import os

BASE = '/Users/paulsmith/.gemini/antigravity/scratch/trimscout'

def write(rel, content):
    p = os.path.join(BASE, rel)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, 'w', encoding='utf-8') as f:
        f.write(content.strip() + '
')
    print('Wrote', rel)

print('make_files.py ready')
