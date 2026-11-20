#!/usr/bin/env python3
"""Download Freesound HQ previews and record license metadata. usage: fsget.py id [id...]"""
import sys, re, json, os, time, html, urllib.request, urllib.parse
RAW = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'sound-raw')
MD = os.path.join(RAW, 'meta'); os.makedirs(MD, exist_ok=True)
UA = {'User-Agent': 'Mozilla/5.0 game-audio-fetch'}

def get(u):
    for attempt in range(4):
        try:
            r = urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=60)
            return r.geturl(), r.read()
        except Exception as e:
            time.sleep(4 + attempt * 4)
    raise SystemExit('failed ' + u)

for sid in sys.argv[1:]:
    key = f'fs_{sid}'
    if os.path.exists(os.path.join(MD, key + '.json')) and os.path.exists(os.path.join(RAW, key + '.mp3')):
        print('have', key); continue
    page_url, body = get(f'https://freesound.org/s/{sid}/')
    h = body.decode()
    lic_m = re.search(r'href="(https?://creativecommons.org/[^"]+)"', h)
    lic_url = lic_m.group(1) if lic_m else ''
    if 'publicdomain/zero' not in lic_url:
        print('SKIP not CC0', sid, lic_url); continue
    tm = re.search(r'<title>Freesound - (.*) by ([^<]*)</title>', h)
    title = html.unescape(tm.group(1)) if tm else sid
    user = html.unescape(tm.group(2)).strip() if tm else urllib.parse.unquote(re.search(r'/people/([^/]+)/sounds/', page_url).group(1))
    mp3 = re.search(r'data-mp3="([^"]*)"', h).group(1).replace('-lq.mp3', '-hq.mp3')
    _, data = get(mp3)
    open(os.path.join(RAW, key + '.mp3'), 'wb').write(data)
    json.dump({'title': title, 'author': user, 'license': 'CC0', 'license_url': lic_url, 'source': page_url.split('?')[0], 'site': 'Freesound'}, open(os.path.join(MD, key + '.json'), 'w'), indent=1)
    print('got', key, user, '|', title, len(data))
    time.sleep(1.5)
