// D-052 (1)단계: 월별·10년 흐름의 사실 계산 — 절입 경계(원국 계산과 같은 값), 12월건 순서, 연말·연초 달, 대운 전환 해, 만 나이, 주된 관계
import { describe, expect, it } from 'vitest';
import { buildChart } from '../../src/engine/chart';
import { pillarLabel } from '../../src/engine/constants';
import { monthEvidence, yearDaewoonLabel, yearEvidence } from '../../src/engine/evidence';
import { monthsFrom, rankRelations, yearsFrom } from '../../src/engine/periods';
import { jieOfYear } from '../../src/engine/solarTerms';
import type { SajuInput } from '../../src/engine/types';
import { SAMPLE_AS_OF, SAMPLE_INPUTS, SAMPLE_REFERENCE_YEAR } from '../../src/llm/samples';
import { fullAge } from '../../src/report/audience';

const chart7 = buildChart(SAMPLE_INPUTS[7]!, { referenceYear: SAMPLE_REFERENCE_YEAR });
const chart4 = buildChart(SAMPLE_INPUTS[4]!, { referenceYear: SAMPLE_REFERENCE_YEAR });
const jie = (year: number, name: string) => jieOfYear(year).find((j) => j.name === name)!;
const MIN = 60_000;
const DAY = 86_400_000;
const names = (ms: number) => monthsFrom(chart7, ms).map((m) => `${m.term}=${pillarLabel(m.pillar)}`);

/** 한국 시각으로 그 순간의 날짜·시각(분 단위)을 출생 입력으로 */
function birthAt(ms: number): SajuInput {
  const d = new Date(ms + 9 * 3_600_000);
  return {
    calendar: 'solar', isLeapMonth: false, year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(),
    time: { hour: d.getUTCHours(), minute: d.getUTCMinutes() }, gender: 'female',
  };
}

describe('12개월: 절기 기준 월건 순서', () => {
  const months = monthsFrom(chart7, SAMPLE_AS_OF.getTime());
  it('2026-10-22 생성: 한로(무술)부터 백로(기유)까지 12개월', () => {
    expect(months.map((m) => `${m.term}=${pillarLabel(m.pillar)}`)).toEqual([
      '한로=무술(戊戌)', '입동=기해(己亥)', '대설=경자(庚子)', '소한=신축(辛丑)', '입춘=임인(壬寅)', '경칩=계묘(癸卯)',
      '청명=갑진(甲辰)', '입하=을사(乙巳)', '망종=병오(丙午)', '소서=정미(丁未)', '입추=무신(戊申)', '백로=기유(己酉)',
    ]);
  });
  it('2026 병오년의 한로는 무술, 2027 정미년의 인월(입춘)은 임인', () => {
    expect(months[0]).toMatchObject({ term: '한로', sajuYear: 2026 });
    expect(pillarLabel(months[0]!.yearPillar)).toBe('병오(丙午)');
    expect(months[4]).toMatchObject({ term: '입춘', sajuYear: 2027 });
    expect(pillarLabel(months[4]!.yearPillar)).toBe('정미(丁未)');
  });
  it('연말·연초에 걸친 달: 대설은 2026-12-07~2027-01-04, 소한(2027년 1월)은 아직 병오년(입춘 전)', () => {
    expect(months[2]).toMatchObject({ term: '대설', from: { year: 2026, month: 12, day: 7 }, to: { year: 2027, month: 1, day: 4 } });
    expect(months[3]).toMatchObject({ term: '소한', from: { year: 2027, month: 1 }, sajuYear: 2026 });
  });
  it('달은 빈틈 없이 이어진다(앞 달의 끝 = 다음 달의 시작 = 절입 순간)', () => {
    for (let i = 1; i < months.length; i++) expect(months[i]!.startMs).toBe(months[i - 1]!.endMs);
  });
});

describe('생성 시각이 절입 시각의 1분 전·뒤일 때 첫 달 (원국 계산과 같은 값)', () => {
  for (const [year, term, before, after] of [[2026, '입동', '한로', '입동'], [2027, '입춘', '소한', '입춘']] as const) {
    const j = jie(year, term);
    it(`${year} ${term}: 1분 전이면 ${before} 달부터, 1분 뒤(와 그 순간)이면 ${term} 달부터`, () => {
      expect(monthsFrom(chart7, j.instantMs - MIN)[0]!.term).toBe(before);
      expect(monthsFrom(chart7, j.instantMs - MIN)[1]!.startMs).toBe(j.instantMs);
      expect(monthsFrom(chart7, j.instantMs)[0]!.term).toBe(after);
      expect(monthsFrom(chart7, j.instantMs + MIN)[0]!.term).toBe(after);
    });
    it(`${year} ${term}: 같은 순간에 태어난 사주의 월주·년주와 첫 달의 간지·사주년이 같다`, () => {
      for (const at of [j.instantMs - 2 * MIN, j.instantMs + 2 * MIN, j.instantMs - DAY, j.instantMs + DAY]) {
        const natal = buildChart(birthAt(at), { referenceYear: SAMPLE_REFERENCE_YEAR });
        const first = monthsFrom(chart7, at)[0]!;
        expect(pillarLabel(first.pillar), new Date(at).toISOString()).toBe(pillarLabel(natal.pillars.month));
        expect(pillarLabel(first.yearPillar), new Date(at).toISOString()).toBe(pillarLabel(natal.pillars.year));
      }
    });
  }
  it('하루 전·뒤: 입동 하루 전 생성은 한로부터(그 달에 입동이 두 번째 달로), 하루 뒤는 입동부터', () => {
    const j = jie(2026, '입동');
    expect(names(j.instantMs - DAY).slice(0, 2)).toEqual(['한로=무술(戊戌)', '입동=기해(己亥)']);
    expect(names(j.instantMs + DAY)[0]).toBe('입동=기해(己亥)');
  });
});

describe('10년: 세운·큰 흐름·만 나이', () => {
  const years7 = yearsFrom(chart7, 2026);
  it('2026~2035, 세운은 입춘 기준 간지', () => {
    expect(years7.map((y) => y.year)).toEqual([2026, 2027, 2028, 2029, 2030, 2031, 2032, 2033, 2034, 2035]);
    expect(pillarLabel(years7[0]!.pillar)).toBe('병오(丙午)');
    expect(pillarLabel(years7[9]!.pillar)).toBe('을묘(乙卯)');
  });
  it('해 중간에 대운이 바뀌면 둘 다 표시한다(샘플 7번: 2029년 11월 기미→경신)', () => {
    const dw = chart7.daewoon.find((d) => d.startYear === 2029)!;
    expect(dw).toBeDefined();
    expect(yearDaewoonLabel(years7[3]!)).toBe(`기미(己未)→경신(庚申)(${dw.startMonth}월 전환)`);
    expect(yearDaewoonLabel(years7[2]!)).toBe('기미(己未)');
    expect(yearDaewoonLabel(years7[4]!)).toBe('경신(庚申)');
  });
  it('첫 대운 전인 아이: "첫 큰 흐름 전", 첫 대운이 시작하는 해는 전환으로 표시', () => {
    const years4 = yearsFrom(chart4, 2026);
    const first = chart4.daewoon[0]!;
    expect(yearDaewoonLabel(years4[0]!)).toBe('첫 큰 흐름 전');
    const startRow = years4.find((y) => y.year === first.startYear)!;
    expect(yearDaewoonLabel(startRow)).toBe(`첫 큰 흐름 전→${pillarLabel(first.pillar)}(${first.startMonth}월 전환)`);
  });
  it('아이 만 나이: 그해 생일이 지난 뒤의 만 나이(그해 12월 31일 기준 만 나이와 같다)', () => {
    const years4 = yearsFrom(chart4, 2026);
    for (const y of years4) expect(y.ageAfterBirthday).toBe(fullAge(chart4.solarDate, { year: y.year, month: 12, day: 31 }));
    // 리포트를 만든 날(2026-10-22) 만 나이와도 맞다(생일이 지났으면 같고, 아직이면 1 적다)
    const now = fullAge(chart4.solarDate, { year: 2026, month: 10, day: 22 });
    expect([now, now + 1]).toContain(years4[0]!.ageAfterBirthday);
  });
});

describe('주된 관계 고르기', () => {
  it('태어난 날 글자와의 충 → 합 → 다른 자리 충 → 합 → 태어난 날과 같은 글자 → 다른 자리와 같은 글자', () => {
    const r = (kind: string, ref: string) => ({ kind, luckPart: 'stem', ref }) as never;
    const ranked = rankRelations([
      r('same', 'year.stem'), r('same', 'day.stem'), r('stemCombine', 'month.stem'), r('stemClash', 'hour.stem'), r('stemCombine', 'day.stem'), r('stemClash', 'day.stem'),
    ]);
    expect(ranked.map((x: { kind: string; ref: string }) => `${x.kind}@${x.ref}`)).toEqual([
      'stemClash@day.stem', 'stemCombine@day.stem', 'stemClash@hour.stem', 'stemCombine@month.stem', 'same@day.stem', 'same@year.stem',
    ]);
  });
  it('관계가 여럿인 달(샘플 7번 2027년 소서 정미)은 태어난 날이 없으면 다른 자리의 충이 먼저', () => {
    const m = monthsFrom(chart7, SAMPLE_AS_OF.getTime())[9]!;
    expect(m.term).toBe('소서');
    expect(['stemClash', 'branchClash']).toContain(m.relations[0]!.kind);
  });
});

describe('근거 문구', () => {
  it('월 근거: 절기 이름·날짜·월건·뜻·관계·주된 관계·속한 해', () => {
    const ev = monthEvidence(chart7, monthsFrom(chart7, SAMPLE_AS_OF.getTime()));
    expect(ev.map((e) => e.id)).toEqual(Array.from({ length: 12 }, (_, i) => `month[${i}]`));
    const nov = ev[1]!;
    expect(nov.kind).toBe('month');
    expect(nov.content).toMatch(/^2026년 11월 월운\(절기 입동 11\/7~12\/6\)은 기해\(己亥\): /u);
    expect(nov.content).toContain('주된 관계: 천간 기(己) ↔ 일주 천간 기(己): 같은 글자');
    expect(nov.content).toContain('이 달이 속한 해(입춘 기준): 2026년 병오(丙午)');
    expect(nov.terms).toEqual(expect.arrayContaining(['기해', '己亥', '기', '해']));
  });
  it('연 근거: 큰 흐름 전환과 만 나이를 적는다', () => {
    const years = yearsFrom(chart7, 2026);
    const ev = yearEvidence(chart7, years);
    const y2029 = ev[3]!;
    expect(y2029.id).toBe('year[3]');
    expect(y2029.content).toContain('기미(己未)→경신(庚申)');
    expect(y2029.content).toContain(`이 해 생일이 지난 뒤 만 ${years[3]!.ageAfterBirthday}세`);
    expect(y2029.terms).toEqual(expect.arrayContaining(['기미', '경신']));
    expect(y2029.chartRefs.filter((r) => r.startsWith('daewoon['))).toHaveLength(2);
  });
});
