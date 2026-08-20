# Python script to generate all components
import os

BASE = '/Users/paulsmith/.gemini/antigravity/scratch/trimscout'

def write_file(rel_path, content):
    full_path = os.path.join(BASE, rel_path)
    os.makedirs(os.path.dirname(full_path), exist_ok=True)
    with open(full_path, 'w', encoding='utf-8') as f:
        f.write(content.strip() + '
')
    print(f'Wrote {rel_path}')

print('Script generator ready')
