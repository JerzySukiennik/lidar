#!/usr/bin/env python3
"""Cuts, loops and normalises the raw Freesound recordings into assets/audio. usage: build_audio.py"""
import os, re, subprocess, json
HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(os.path.dirname(HERE), 'sound-raw')
OUT = os.path.join(os.path.dirname(os.path.dirname(HERE)), 'assets', 'audio')
os.makedirs(OUT, exist_ok=True)
src = lambda i: os.path.join(RAW, f'fs_{i}.mp3')

def run(args):
    return subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-y'] + args, capture_output=True, text=True).stderr

def peak(path, pre):
    e = run(['-i', path, '-af', pre + ',volumedetect', '-f', 'null', '-'])
    m = re.search(r'max_volume: (-?[\d.]+) dB', e)
    return float(m.group(1)) if m else 0.0

def shot(name, sid, start, dur, target=-2.0, stereo=False, fin=0.004, fout=0.06, extra=''):
    pre = f'atrim=start={start}:duration={dur},asetpts=PTS-STARTPTS' + (',' + extra if extra else '')
    gain = target - peak(src(sid), pre)
    af = f'{pre},volume={gain:.2f}dB,afade=t=in:d={fin},afade=t=out:st={max(0, dur - fout):.3f}:d={fout}'
    run(['-i', src(sid), '-af', af, '-ac', '2' if stereo else '1', '-ar', '44100', '-b:a', '128k' if stereo else '96k', os.path.join(OUT, name + '.mp3')])
    used.setdefault(sid, []).append(name)

def loop(name, sid, start, dur, x=2.0, target=-6.0, stereo=True, extra=''):
    ex = (',' + extra) if extra else ''
    fc = (f'[0]atrim=start={start + x}:end={start + dur},asetpts=PTS-STARTPTS{ex}[body];'
          f'[0]atrim=start={start + dur}:end={start + dur + x},asetpts=PTS-STARTPTS{ex}[tail];'
          f'[0]atrim=start={start}:end={start + x},asetpts=PTS-STARTPTS{ex}[head];'
          f'[tail][head]acrossfade=d={x}:c1=tri:c2=tri[xf];[body][xf]concat=n=2:v=0:a=1[o]')
    tmp = os.path.join(OUT, '_tmp.wav')
    run(['-i', src(sid), '-filter_complex', fc, '-map', '[o]', '-ac', '2' if stereo else '1', '-ar', '44100', tmp])
    gain = target - peak(tmp, 'anull')
    run(['-i', tmp, '-af', f'volume={gain:.2f}dB', '-b:a', '128k' if stereo else '96k', os.path.join(OUT, name + '.wav.mp3')])
    os.replace(os.path.join(OUT, name + '.wav.mp3'), os.path.join(OUT, name + '.mp3'))
    os.remove(tmp)
    used.setdefault(sid, []).append(name)

def slices(prefix, sid, want, noise=-34, mind=0.1, pad=0.015, tail=0.14, target=-3.0, minlen=0.05, extra=''):
    e = run(['-i', src(sid), '-af', f'silencedetect=noise={noise}dB:d={mind}', '-f', 'null', '-'])
    total = float(re.search(r'Duration: (\d+):(\d+):([\d.]+)', e).group(3)) + 60 * float(re.search(r'Duration: (\d+):(\d+):([\d.]+)', e).group(2))
    starts = [float(x) for x in re.findall(r'silence_start: ([\d.]+)', e)]
    ends = [float(x) for x in re.findall(r'silence_end: ([\d.]+)', e)]
    segs, cur = [], 0.0
    for s, en in zip(starts, ends + [total] * (len(starts) - len(ends))):
        if s - cur > minlen: segs.append((cur, s))
        cur = en
    if total - cur > minlen: segs.append((cur, total))
    segs = [(max(0, a - pad), min(total, b + tail)) for a, b in segs]
    scored = []
    for a, b in segs:
        scored.append((peak(src(sid), f'atrim=start={a}:duration={b - a}'), a, b))
    scored.sort(reverse=True)
    picked = sorted(scored[:want], key=lambda q: q[1])
    for k, (_, a, b) in enumerate(picked):
        shot(f'{prefix}{k + 1}', sid, a, b - a, target=target, fout=min(0.08, (b - a) / 3), extra=extra)
    return len(picked)

used = {}
loop('amb_station', 451924, 4, 44, x=3, target=-9)
loop('amb_deep', 421826, 24, 70, x=4, target=-8)
loop('amb_drip', 234554, 2, 26, x=2, target=-9)
loop('geiger', 674113, 0.3, 9, x=0.5, target=-4, stereo=False)
loop('heart', 273150, 0.5, 9.5, x=0.5, target=-3, stereo=False, extra='lowpass=f=300')
loop('breath', 260186, 1.5, 10.5, x=0.8, target=-4, stereo=False)
loop('static', 38693, 4, 14, x=1, target=-8, stereo=False)
print('steps a', slices('step_a', 521590, 6, noise=-30))
print('steps b', slices('step_b', 353799, 6, noise=-30))
print('mon steps', slices('m_step', 338106, 6, noise=-36, tail=0.2))
print('bones', slices('bone', 574752, 6, noise=-34, tail=0.18))
shot('charge', 321800, 0.0, 2.2, target=-8, fin=0.05, fout=0.08)
shot('shock', 321800, 2.2, 1.0, target=-1, fout=0.3)
shot('thump', 336494, 0.0, 0.95, target=-1, fout=0.3)
shot('spark', 189630, 0.0, 0.22, target=-4)
shot('m_click1', 512472, 0.0, 0.8, target=-3)
shot('m_click2', 235529, 0.0, 1.4, target=-3, fout=0.15)
shot('m_click3', 235529, 3.75, 1.45, target=-3, fout=0.15)
shot('m_click4', 669717, 1.2, 4.2, target=-3, fin=0.3, fout=0.6)
shot('m_throat1', 688417, 1.25, 2.7, target=-3, fin=0.03, fout=0.3)
shot('m_throat2', 688417, 14.6, 3.2, target=-3, fin=0.2, fout=0.5)
shot('m_groan', 473525, 0.0, 4.4, target=-3, fin=0.1, fout=0.6)
shot('m_growl1', 333469, 0.2, 2.5, target=-3, fin=0.05, fout=0.3)
shot('m_growl2', 333469, 3.0, 2.6, target=-3, fin=0.05, fout=0.3)
shot('m_growl3', 333469, 5.95, 2.4, target=-3, fin=0.05, fout=0.3)
shot('m_shriek', 580320, 0.2, 5.5, target=-1, fin=0.02, fout=1.2)
shot('scare', 442564, 0.0, 2.7, target=-0.5, fout=0.25)
shot('scare2', 125388, 3.6, 2.0, target=-1, fin=0.05, fout=0.4)
shot('bang1', 396555, 2.45, 4.4, target=-2, fout=1.0)
shot('bang2', 170420, 0.0, 4.6, target=-2, fout=1.0)
shot('pipe', 104373, 0.0, 4.2, target=-3, fout=0.6)
shot('door', 478076, 0.0, 4.0, target=-3, fout=0.5)
shot('drip', 348022, 0.0, 0.22, target=-4)
shot('whisper', 193808, 0.3, 9.0, target=-4, fin=0.5, fout=1.5)
shot('gong', 473523, 0.0, 15.0, target=-2, stereo=True, fout=4)
credits = []
for sid, names in sorted(used.items()):
    m = json.load(open(os.path.join(RAW, 'meta', f'fs_{sid}.json')))
    credits.append({'files': names, 'title': m['title'], 'author': m['author'], 'license': m['license'], 'source': m['source']})
json.dump(credits, open(os.path.join(os.path.dirname(HERE), 'audio-credits.json'), 'w'), indent=1, ensure_ascii=False)
tot = sum(os.path.getsize(os.path.join(OUT, f)) for f in os.listdir(OUT))
print(len(os.listdir(OUT)), 'files', round(tot / 1024), 'KB')
