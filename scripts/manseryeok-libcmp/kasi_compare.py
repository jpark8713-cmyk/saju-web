# 절입 시각 대조: 우리·sxtwl vs KASI 고정 자료(2000~2028, 2011 입동은 API 오류로 뺌)
# 실행: python -I scripts/manseryeok-libcmp/kasi_compare.py tests/fixtures/kasi-jie.json <jie-dump 출력>
import json, sys, sxtwl, datetime as dt
K = json.load(open(sys.argv[1], encoding='utf-8'))['items']
ours = json.load(open(sys.argv[2], encoding='utf-8'))
NAMES = ['대설','소한','입춘','경칩','청명','입하','망종','소서','입추','백로','한로','입동']  # 월지 0..11
om = {(o['y'], o['name']): dt.datetime(1970,1,1)+dt.timedelta(milliseconds=o['ms']+9*3600000) for o in ours}
sx = {}
for y in range(2000, 2029):
    for q in sxtwl.getJieQiByYear(y):
        if q.jqIndex % 2 == 1:
            t = sxtwl.JD2DD(q.jd)
            sx[(t.Y, NAMES[((q.jqIndex+1)//2) % 12])] = dt.datetime(t.Y,t.M,t.D,int(t.h),int(t.m))+dt.timedelta(seconds=t.s)+dt.timedelta(hours=1)
def score(src):
    fl = rd = n = 0; worst = 0
    for it in K:
        k = (it['year'], it['name'])
        if k not in src or (it['year'], it['name']) == (2011, '입동'): continue
        kt = dt.datetime.strptime(it['date']+' '+it['time'], '%Y-%m-%d %H:%M')
        v = src[k]; n += 1
        fl += v.replace(second=0, microsecond=0) == kt
        rd += (v + dt.timedelta(seconds=30)).replace(second=0, microsecond=0) == kt
        worst = max(worst, abs((v-kt).total_seconds()))
    return n, fl, rd, worst
print('ours  n/floor/round/worst_s', score(om))
print('sxtwl n/floor/round/worst_s', score(sx))
