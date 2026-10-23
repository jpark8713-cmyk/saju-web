// 월별·10년 흐름의 사실(D-052). 코드가 계산하고, 풀이 문장은 이 사실만 근거로 쓴다.
// - 달은 절기 기준이다. 원국 계산과 같은 절입표(prevJie·nextJie)와 같은 월주·년주 함수(monthPillarAt·yearPillarAt)를 쓴다.
//   리포트를 만든 순간이 들어 있는 절기 달이 첫 달이고, 절입 시각 바로 그 순간은 새 달에 넣는다(원국의 prevJie와 같다).
// - 10년은 올해(기준 연도)부터 해마다 세운, 그해의 큰 흐름(대운, 해 중간에 바뀌면 둘 다), 그해 생일이 지난 뒤의 만 나이를 담는다.
// - 원국과의 관계는 luckRelations(같은 글자·천간합·천간충·지지 육합·지지 충)이고, 그중 하나를 주된 관계로 고른다.
import { pillarFromCycle } from './constants';
import { monthPillarAt, yearPillarAt } from './pillars';
import { luckRelations, type LuckRelation } from './relations';
import { nextJie, prevJie } from './solarTerms';
import type { DaewoonEntry, Pillar, SajuChart } from './types';

const KST_OFFSET_MS = 9 * 3_600_000;
const DAY_MS = 86_400_000;

export interface KstDate {
  year: number;
  month: number;
  day: number;
}

function kstDate(ms: number): KstDate {
  const d = new Date(ms + KST_OFFSET_MS);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/** 주된 관계 고르기 순서: 태어난 날 글자와의 충 → 합 → 다른 자리와의 충 → 합 → 태어난 날 글자와 같은 글자 → 다른 자리와 같은 글자 */
function relationRank(r: LuckRelation): number {
  const day = r.ref.startsWith('day.');
  const kind = r.kind === 'stemClash' || r.kind === 'branchClash' ? 0 : r.kind === 'same' ? 2 : 1;
  return kind === 2 ? (day ? 4 : 5) : (day ? 0 : 2) + kind;
}

/** 관계를 고르는 순서로 늘어놓는다(같은 순위는 luckRelations 순서: 윗글자 먼저, 원국 자리 순) */
export function rankRelations(rels: readonly LuckRelation[]): LuckRelation[] {
  return rels.map((r, i) => ({ r, i })).sort((a, b) => relationRank(a.r) - relationRank(b.r) || a.i - b.i).map((x) => x.r);
}

export interface MonthPeriod {
  /** 0부터 (리포트를 만든 달이 0) */
  index: number;
  /** 절기 이름 (입동 등) */
  term: string;
  /** 절입 순간(ms) — 이 달의 시작. 다음 달의 절입 순간 직전까지가 이 달이다 */
  startMs: number;
  endMs: number;
  /** 한국 날짜로 시작일과 마지막 날 */
  from: KstDate;
  to: KstDate;
  /** 이 달의 간지(월건) */
  pillar: Pillar;
  /** 이 달이 속한 사주년(입춘 기준)과 그해 간지 */
  sajuYear: number;
  yearPillar: Pillar;
  /** 원국과의 관계(고르는 순서대로). 맨 앞이 주된 관계 */
  relations: LuckRelation[];
}

/**
 * 리포트를 만든 순간(asOf)부터 절기 달 count개. 첫 달은 asOf가 들어 있는 절기 달(직전 절입부터)이다.
 * 월주는 그 달 시작 순간의 monthPillarAt(원국 계산과 같은 함수)이다
 */
export function monthsFrom(chart: SajuChart, asOfMs: number, count = 12): MonthPeriod[] {
  const out: MonthPeriod[] = [];
  let start = prevJie(asOfMs);
  for (let index = 0; index < count; index++) {
    const end = nextJie(start.instantMs);
    const year = yearPillarAt(start.instantMs);
    const pillar = monthPillarAt(start.instantMs, year.pillar.stem);
    out.push({
      index,
      term: start.name,
      startMs: start.instantMs,
      endMs: end.instantMs,
      from: kstDate(start.instantMs),
      // 다음 절입이 있는 날의 하루 전까지를 이 달로 보여 준다(절입일은 다음 달의 첫날)
      to: kstDate(end.instantMs - DAY_MS),
      pillar,
      sajuYear: year.sajuYear,
      yearPillar: year.pillar,
      relations: rankRelations(luckRelations(chart.pillars, pillar)),
    });
    start = end;
  }
  return out;
}

export interface YearPeriod {
  index: number;
  year: number;
  /** 그해 세운 간지(입춘 기준) */
  pillar: Pillar;
  /** 그해 1월 1일에 이어지고 있는 큰 흐름(첫 대운 전이면 null) */
  daewoon: DaewoonEntry | null;
  /** 그해 안에 새로 시작하는 큰 흐름(해 중간 전환). 없으면 null */
  nextDaewoon: DaewoonEntry | null;
  /** 그해 생일이 지난 뒤의 만 나이 */
  ageAfterBirthday: number;
  relations: LuckRelation[];
}

/** 기준 연도부터 count년. 대운 시작 날짜(startYear·startMonth·startDay)로 그해의 큰 흐름과 해 중간 전환을 정한다 */
export function yearsFrom(chart: SajuChart, referenceYear: number, count = 10): YearPeriod[] {
  const startKey = (d: DaewoonEntry) => d.startYear * 10_000 + d.startMonth * 100 + d.startDay;
  return Array.from({ length: count }, (_, index): YearPeriod => {
    const year = referenceYear + index;
    const pillar = pillarFromCycle(year - 4);
    const jan1 = year * 10_000 + 101;
    const current = [...chart.daewoon].filter((d) => startKey(d) <= jan1).sort((a, b) => startKey(b) - startKey(a))[0] ?? null;
    const next = chart.daewoon.find((d) => d.startYear === year && startKey(d) > jan1) ?? null;
    return {
      index,
      year,
      pillar,
      daewoon: current,
      nextDaewoon: next,
      ageAfterBirthday: year - chart.solarDate.year,
      relations: rankRelations(luckRelations(chart.pillars, pillar)),
    };
  });
}
