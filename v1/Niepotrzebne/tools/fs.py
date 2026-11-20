#!/usr/bin/env python3
"""Freesound HTML search, sequential and polite. usage: fs.py "query[:maxdur]" ... (CC0 only, sorted by downloads)"""
import sys, re, time, urllib.request, urllib.parse, urllib.error, html

def search(q, maxdur, top=6):
    params = {'q': q, 'page': '1', 'g': '0', 'f': 'license:"Creative Commons 0"', 's': 'Downloads (most first)'}
    url = 'https://freesound.org/search/?' + urllib.parse.urlencode(params)
    for attempt in range(4):
        try:
            h = urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 game-audio-fetch'}), timeout=30).read().decode()
            break
        except urllib.error.HTTPError as e:
            time.sleep(4 + attempt * 4)
    else:
        print('  (failed)'); return
    n = 0
    for b in h.split('class="bw-search__result"')[1:]:
        def g(p):
            m = re.search(p, b, re.S); return html.unescape(m.group(1)).strip() if m else ''
        sid = g(r'data-sound-id="(\d+)"'); user = g(r'data-username="([^"]*)"')
        title = g(r'data-title="([^"]*)"'); dur = g(r'data-duration="([^"]*)"')
        dl = g(r'data-num-downloads="(\d+)"'); rat = g(r'aria-label="Average rating of ([\d.]+)"')
        desc = g(r'<div class="max-h-60px-md-50px text-black overflow-hidden v-spacing-1" >(.*?)</div>')
        desc = re.sub(r'<[^>]+>', '', desc); desc = re.sub(r'\s+', ' ', desc)[:80]
        try: d = float(dur)
        except: d = 0
        if d > maxdur: continue
        print(f"{sid:>7} {d:6.1f}s dl={dl:>6} r={rat or '-':>3} {user}: {title[:42]} | {desc}")
        n += 1
        if n >= top: break

for arg in sys.argv[1:]:
    q, _, md = arg.partition(':')
    print('##', q)
    search(q, float(md) if md else 600)
    time.sleep(2.2)
