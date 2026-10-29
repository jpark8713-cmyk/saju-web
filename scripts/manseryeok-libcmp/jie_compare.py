# 절입 순간 대조: 우리(jie-dump.mts 출력) vs sxtwl(1900~2050), 그리고 KASI 고정 자료(2000~2028)
# 실행: python -I scripts/manseryeok-libcmp/jie_compare.py <jie-dump 출력> tests/fixtures/kasi-jie.json
import json, sys, sxtwl, datetime as dt
ours = json.load(open(sys.argv[1], encoding='utf-8'))
# sxtwl jqIndex: 0=동지, 1=소한, 3=입춘 ... 홀수가 12절. 월지 = ((idx+1)//2) % 12
sx = {}
for y in range(1899, 2052):
    for q in sxtwl.getJieQiByYear(y):
        if q.jqIndex % 2 == 1:
            t = sxtwl.JD2DD(q.jd)
            base = dt.datetime(t.Y, t.M, t.D, int(t.h), int(t.m)) + dt.timedelta(seconds=t.s) - dt.timedelta(hours=8)
            ms = (base - dt.datetime(1970, 1, 1)).total_seconds() * 1000
            sx[(t.Y, ((q.jqIndex + 1) // 2) % 12)] = ms
diffs = []
for o in ours:
    k = (o['y'], o['branch'])
    if k in sx: diffs.append(((o['ms'] - sx[k]) / 1000, o))
ab = sorted(abs(d) for d, _ in diffs)
print('n', len(diffs), 'of', len(ours), 'max s', round(ab[-1], 1), 'p50', round(ab[len(ab)//2], 1), 'p99', round(ab[int(len(ab)*.99)], 1), '>60s', sum(1 for a in ab if a > 60), '>30s', sum(1 for a in ab if a > 30))
for d, o in sorted(diffs, key=lambda x: -abs(x[0]))[:5]:
    print(o['y'], o['branch'], round(d, 1), dt.datetime(1970,1,1)+dt.timedelta(milliseconds=o['ms']+9*3600000))
by = {}
for d, o in diffs: by.setdefault(o['y'] // 50 * 50, []).append(abs(d))
print({k: round(max(v), 1) for k, v in by.items()})
