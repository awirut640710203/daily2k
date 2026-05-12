import re
with open(r'c:\Users\ADMIN\Desktop\Data sum Daily express 4 month V2.3\Dashboard\data.js', 'r', encoding='utf-8') as f:
    content = f.read()
matches = re.findall(r'"(\w+)":\s*[\[\{]', content[:200000])
seen = set()
keys = []
for m in matches:
    if m not in seen:
        seen.add(m)
        keys.append(m)
print('Top-level keys in data.js:', keys)
