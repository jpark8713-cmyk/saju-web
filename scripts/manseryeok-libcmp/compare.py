# sxtwl·korean-lunar-calendar로 비교하고, lunar-javascript 결과(libcmp-data.json)와 합쳐 결과 JSON을 만든다
# 실행: python -I scripts/manseryeok-libcmp/compare.py <generate.mts 출력 폴더>
import json, sys
from collections import Counter
import sxtwl
from korean_lunar_calendar import KoreanLunarCalendar

DIR = sys.argv[1]
data = json.load(open(f'{DIR}/libcmp-data.json', encoding='utf-8'))
TG, DZ = '甲乙丙丁戊己庚辛壬癸', '子丑寅卯辰巳午未申酉戌亥'
g = lambda x: TG[x.tg] + DZ[x.dz]
P4 = ['year', 'month', 'day', 'hour']

def sx_default(t):
    d = sxtwl.fromSolar(t['y'], t['m'], t['d'])
    return {'year': g(d.getYearGZ(False)), 'month': g(d.getMonthGZ()), 'day': g(d.getDayGZ()), 'hour': g(d.getHourGZ(t['h']))}

def sx_exact_year_month(bj):
    """sxtwl의 절기 시각(베이징 시)으로 출생 순간 전후를 가른다. 절입 날이 아니면 그날 값을 그대로 쓴다"""
    d = sxtwl.fromSolar(bj['y'], bj['m'], bj['d'])
    y, m = g(d.getYearGZ(False)), g(d.getMonthGZ())
    if d.hasJieQi() and d.getJieQi() % 2 == 1:  # 홀수 = 12절(월이 바뀌는 절기)
        t = sxtwl.JD2DD(d.getJieQiJD())
        jt = (t.Y, t.M, t.D, int(t.h), int(t.m), t.s)
        before = (bj['y'], bj['m'], bj['d'], bj['h'], bj['mi'], bj['s']) < jt
        ref = d.before(1) if before else d.after(1)
        m = g(ref.getMonthGZ())
        if d.getJieQi() == 3:  # 입춘
            y = g(ref.getYearGZ(False))
    return y, m

def sx_aligned(r):
    y, m = sx_exact_year_month(r['bj'])
    l = r['local']
    d = sxtwl.fromSolar(l['y'], l['m'], l['d'])
    return {'year': y, 'month': m, 'day': g(d.getDayGZ()), 'hour': g(d.getHourGZ(l['h']))}

def sx_default_row(r):
    e = r['entered']
    if r['calendar'] == 'lunar':  # 라이브러리 자체 음력(중국 음력) 변환
        pass  # 날짜는 lunar-javascript가 바꾼 entered를 그대로 쓴다(둘 다 중국 음력)
    return sx_default(e)

def keys(r):
    return P4 if r['hasTime'] else P4[:3]

def diff(a, b, ks):
    return [k for k in ks if a[k] != b[k]]

def kr_lunar(s):
    c = KoreanLunarCalendar()
    if not c.setSolarDate(s['y'], s['m'], s['d']):
        return None
    return {'y': c.lunarYear, 'm': c.lunarMonth, 'd': c.lunarDay, 'leap': bool(c.isIntercalation)}

KO = {'year': '년', 'month': '월', 'day': '일', 'hour': '시'}
def classify(r, default, aligned):
    ks = keys(r)
    dd, da = diff(default, r['ours'], ks), diff(aligned, r['ours'], ks)
    if not dd:
        return '같음', ''
    if not da:
        return '설정 차이로 설명됨', '기본 설정에서 ' + '·'.join(KO[k] for k in dd) + '주가 다름'
    return '다름', '·'.join(KO[k] for k in da) + '주'

def fmt(p, ks):
    return ' '.join(p[k] for k in ks)

out = {'cases': [], 'sweep': {}}
for r in data['cases']:
    ks = keys(r)
    sd, sa = sx_default_row(r), sx_aligned(r)
    lc, lr = classify(r, r['lunarDefault'], r['lunarAligned'])
    sc, sr = classify(r, sd, sa)
    kl = kr_lunar(r['ourSolar'])
    out['cases'].append({
        'id': r['id'], 'ours': fmt(r['ours'], ks),
        'lunarDefault': fmt(r['lunarDefault'], ks), 'lunarAligned': fmt(r['lunarAligned'], ks), 'lunarClass': lc, 'lunarNote': lr,
        'sxDefault': fmt(sd, ks), 'sxAligned': fmt(sa, ks), 'sxClass': sc, 'sxNote': sr,
        'krLunarSame': kl == r['ourLunar'] if kl else None, 'krLunar': kl, 'ourLunar': r['ourLunar'],
        'jieHours': r['jieHours'], 'entered': r['entered'], 'calendar': r['calendar'],
    })

# 무작위 비교
rows = [r for r in data['sweep'] if 'error' not in r]
def bucket(r):
    return 'near' if abs(r['jieHours']) <= 24 else 'far'
stat = {}
examples = {}
for r in rows:
    b = bucket(r)
    sd, sa = sx_default(r['entered']), sx_aligned(r)
    kl = kr_lunar(r['ourSolar'])
    res = {
        'lunarDefault': diff(r['lunarDefault'], r['ours'], P4), 'lunarAligned': diff(r['lunarAligned'], r['ours'], P4),
        'sxDefault': diff(sd, r['ours'], P4), 'sxAligned': diff(sa, r['ours'], P4),
        'krLunar': [] if kl is None or kl == r['ourLunar'] else ['lunar'],
    }
    for name, ds in res.items():
        s = stat.setdefault(name, {}).setdefault(b, Counter())
        s['n'] += 1
        if ds: s['any'] += 1
        for k in ds: s[k] += 1
        if ds and name in ('lunarAligned', 'sxAligned', 'krLunar'):
            examples.setdefault(name, []).append({'id': r['id'], 'diff': ds, 'ours': r['ours'], 'lunar': r['lunarAligned'], 'sx': sa, 'bj': r['bj'], 'local': r['local'], 'jieHours': r['jieHours'], 'ourLunar': r['ourLunar'], 'krLunar': kl, 'solar': r['ourSolar']})
    if kl is None:
        stat.setdefault('krNone', Counter())['n'] += 1
# 기본 설정 차이 대표(시주가 경도 보정으로 갈리는 예)
defaults = [r for r in rows if diff(r['lunarDefault'], r['ours'], P4)][:3]
out['sweep'] = {'n': len(rows), 'near': sum(1 for r in rows if bucket(r) == 'near'), 'stat': {k: ({b: dict(c) for b, c in v.items()} if isinstance(v, dict) else dict(v)) for k, v in stat.items()},
                'examples': {k: v[:8] for k, v in examples.items()}, 'exampleCounts': {k: len(v) for k, v in examples.items()},
                'defaultExamples': [{'id': r['id'], 'entered': r['entered'], 'local': r['local'], 'offset': r['offsetMin'], 'ours': r['ours'], 'lunarDefault': r['lunarDefault']} for r in defaults]}
json.dump(out, open(f'{DIR}/libcmp-result.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(json.dumps(out['sweep']['stat'], ensure_ascii=False, indent=1))
print(json.dumps(out['sweep']['exampleCounts']))
for c in out['cases']:
    print(c['id'], c['ours'], '|L', c['lunarClass'], c['lunarNote'], '|S', c['sxClass'], c['sxNote'], '|KR', c['krLunarSame'])
