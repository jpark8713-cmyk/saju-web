// 십신·오행·합충·근거 목록
import lunarJs from 'lunar-javascript';
import { describe, expect, it } from 'vitest';
import { TEN_GOD_KO } from '../../src/engine/constants';
import { buildEvidence, isValidChartRef } from '../../src/engine/evidence';
import { computeRelations } from '../../src/engine/relations';
import { tenGodOfStem } from '../../src/engine/tenGods';
import type { PillarSet, TenGod } from '../../src/engine/types';
import { chartOf, solar } from './helpers';

/** lunar-javascript 십신 표기(중국어 간체) → 엔진 코드 */
const LJ_TEN_GOD: Record<string, TenGod> = {
  比肩: 'bigyeon', 劫财: 'geobjae', 食神: 'siksin', 伤官: 'sanggwan', 偏财: 'pyeonjae',
  正财: 'jeongjae', 七杀: 'pyeongwan', 正官: 'jeonggwan', 偏印: 'pyeonin', 正印: 'jeongin',
};

describe('십신', () => {
  it('천간 10×10 전부 lunar-javascript와 일치', () => {
    // 일간 d, 대상 t를 일주·년주에 두는 날을 찾지 않고, 라이브러리의 표 함수 대신 실제 팔자 결과로 대조한다
    const samples = [
      solar(2005, 12, 23, { hour: 8, minute: 37 }),
      solar(1990, 5, 15, { hour: 14, minute: 30 }),
      solar(1977, 3, 2, { hour: 20, minute: 5 }),
      solar(2033, 9, 9, { hour: 4, minute: 44 }),
      solar(1961, 1, 30, { hour: 16, minute: 0 }),
    ];
    for (const input of samples) {
      const c = chartOf(input, { longitudeCorrection: false, historicalTimezone: false });
      const ec = lunarJs.Solar.fromYmdHms(input.year, input.month, input.day, input.time!.hour, input.time!.minute, 0)
        .getLunar().getEightChar();
      const expected = {
        'year.stem': ec.getYearShiShenGan(),
        'month.stem': ec.getMonthShiShenGan(),
        'hour.stem': ec.getTimeShiShenGan(),
        'year.branch': ec.getYearShiShenZhi()[0],
        'month.branch': ec.getMonthShiShenZhi()[0],
        'day.branch': ec.getDayShiShenZhi()[0],
        'hour.branch': ec.getTimeShiShenZhi()[0],
      };
      const mine = Object.fromEntries(c.tenGods.map((t) => [`${t.position}.${t.part}`, t.tenGod]));
      const theirs = Object.fromEntries(Object.entries(expected).map(([k, v]) => [k, LJ_TEN_GOD[v!]]));
      expect(mine).toEqual(theirs);
    }
  });

  it('일간 기준 표 (갑목 일간)', () => {
    const names = Array.from({ length: 10 }, (_, t) => TEN_GOD_KO[tenGodOfStem(0, t)]);
    expect(names).toEqual(['비견', '겁재', '식신', '상관', '편재', '정재', '편관', '정관', '편인', '정인']);
  });
});

describe('오행 분포', () => {
  it('4주는 8글자, 합계가 맞다', () => {
    const c = chartOf(solar(1990, 5, 15, { hour: 14, minute: 30 }));
    expect(c.elements.total).toBe(8);
    expect(Object.values(c.elements.counts).reduce((a, b) => a + b, 0)).toBe(8);
  });
});

describe('합충', () => {
  const p = (y: [number, number], m: [number, number], d: [number, number], h: [number, number] | null): PillarSet => ({
    year: { stem: y[0], branch: y[1] }, month: { stem: m[0], branch: m[1] },
    day: { stem: d[0], branch: d[1] }, hour: h ? { stem: h[0], branch: h[1] } : null,
  });

  it('천간합·충, 지지 육합·충, 삼합', () => {
    // 갑자 기축 경오 병신: 갑기합, 갑경충, 자축합, 자오충, 신자진 중 진 없음 → 삼합 없음
    const rel = computeRelations(p([0, 0], [5, 1], [6, 6], [2, 8]));
    const kinds = rel.map((r) => `${r.kind}:${r.refs.join(',')}`);
    expect(kinds).toContain('stemCombine:year.stem,month.stem');
    expect(kinds).toContain('stemClash:year.stem,day.stem');
    expect(kinds).toContain('branchSixCombine:year.branch,month.branch');
    expect(kinds).toContain('branchClash:year.branch,day.branch');
    expect(kinds.some((k) => k.startsWith('branchTripleCombine'))).toBe(false);
  });

  it('삼합은 세 글자가 모두 있을 때만', () => {
    const rel = computeRelations(p([0, 8], [0, 0], [0, 4], null));
    expect(rel.filter((r) => r.kind === 'branchTripleCombine')).toEqual([
      { kind: 'branchTripleCombine', refs: ['year.branch', 'month.branch', 'day.branch'], resultElement: 'water' },
    ]);
  });
});

describe('근거 목록', () => {
  const cases = [
    solar(1990, 5, 15, { hour: 14, minute: 30 }),
    solar(1988, 9, 17, null, { gender: 'female' }),
    solar(2024, 2, 4, { hour: 17, minute: 0 }),
  ];

  it.each(cases)('$year-$month-$day: id가 유일하고 모든 chartRefs가 유효', (input) => {
    const chart = chartOf(input);
    const ev = buildEvidence(chart);
    expect(new Set(ev.map((e) => e.id)).size).toBe(ev.length);
    for (const e of ev) {
      expect(e.chartRefs.length, e.id).toBeGreaterThan(0);
      for (const ref of e.chartRefs) expect(isValidChartRef(chart, ref), `${e.id} → ${ref}`).toBe(true);
      expect(e.content.length).toBeGreaterThan(0);
    }
  });

  it('시간 모름이면 시주 근거가 없다', () => {
    const ev = buildEvidence(chartOf(cases[1]!));
    expect(ev.some((e) => e.chartRefs.some((r) => r.startsWith('hour.')))).toBe(false);
  });

  it('근거에 등장하는 간지는 차트 값에서만 나온다', () => {
    const chart = chartOf(cases[0]!);
    const ev = buildEvidence(chart);
    const yearEv = ev.find((e) => e.id === 'pillar.year.stem')!;
    expect(yearEv.content).toContain('경(庚)'); // 1990년 = 경오년 (manseryeok README 예시와 같은 값)
  });

  it('isValidChartRef는 없는 위치를 거부', () => {
    const chart = chartOf(cases[1]!);
    expect(isValidChartRef(chart, 'hour.stem')).toBe(false);
    expect(isValidChartRef(chart, 'daewoon[99]')).toBe(false);
    expect(isValidChartRef(chart, 'seun[2]')).toBe(false);
    expect(isValidChartRef(chart, 'month.foo')).toBe(false);
    expect(isValidChartRef(chart, 'elements.wood')).toBe(true);
  });
});

describe('십신 그룹 근거 문구', () => {
  it('원국에 있는 구성 십신 이름만 문구에 적는다 (0개면 이름 없이)', () => {
    for (const input of [solar(1990, 5, 15, { hour: 14, minute: 30 }), solar(1988, 9, 17, null), solar(2001, 3, 21, { hour: 2, minute: 15 })]) {
      const chart = chartOf(input);
      const groups = buildEvidence(chart).filter((e) => e.kind === 'tenGodGroup');
      expect(groups).toHaveLength(5);
      for (const e of groups) {
        const present = e.terms.slice(1); // terms = [그룹명, ...있는 십신]
        const allNames = Object.values(TEN_GOD_KO);
        for (const name of allNames) {
          // 문구에 나오는 십신 이름은 모두 terms(실제로 있는 것)에 들어 있어야 한다
          if (e.content.includes(name)) expect(present, `${e.id}: ${name}`).toContain(name);
        }
        if (e.content.includes(' 0개')) expect(present).toEqual([]);
      }
    }
  });
});
