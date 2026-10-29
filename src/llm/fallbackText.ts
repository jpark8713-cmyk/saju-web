// 시간 상한 대체 문장(D-049): 리포트 전체 시간 상한(GENERATION.hardDeadlineMs)까지 고치지 못한 칸은
// AI 문장 대신 이 코드 템플릿의 사실 문장으로 채워 주문을 실패시키지 않는다. 차트 값과 정해진 문구만 쓴다(AI를 쓰지 않는다).
// 문장은 그 사실의 근거 id를 인용하고, 생성 문장과 같은 검증(validateSection)을 통과하도록 쓴다(테스트에서 샘플 전부로 확인).
import type { TopicConfig } from '../config/topics';
import { REPORT_LAYOUT } from '../config/report';
import {
  BRANCH_ELEMENTS, ELEMENTS, ELEMENT_PLAIN, PART_PLAIN, POSITION_PLAIN, STEM_ELEMENTS, TEN_GOD_GROUPS, branchLabel, pillarLabel, stemLabel,
} from '../engine/constants';
import { daewoonStartLabel } from '../engine/daewoon';
import { luckRelations, type LuckRelation } from '../engine/relations';
import { tenGodOfBranch, tenGodOfStem } from '../engine/tenGods';
import type { ChartRef, Evidence, PillarPosition, SajuChart, TenGod } from '../engine/types';
import { yearDaewoonLabel } from '../engine/evidence';
import type { MonthPeriod, SeasonPeriod, YearPeriod } from '../engine/periods';
import type { Audience } from '../report/audience';
import { hasBatchim, josa } from '../report/evidenceTerms';
import type { BaseDraft, ChildPeriodDraft, PeriodDraft, PeriodNote, ReportSentence, TopicDraft } from './types';

interface Voice {
  /** "나를 뺀" */
  minus: string;
  /** "내 사주" */
  mine: string;
}
const ADULT: Voice = { minus: '나를 뺀', mine: '내 사주' };
const CHILD: Voice = { minus: '아이를 나타내는 글자를 뺀', mine: '아이의 사주' };

const RELATION_PLAIN: Record<LuckRelation['kind'] | 'branchTripleCombine', string> = {
  same: '같은 글자',
  stemCombine: '서로 끌려 묶이는 관계',
  stemClash: '서로 부딪치는 관계',
  branchSixCombine: '짝을 이뤄 묶이는 관계',
  branchClash: '정면으로 부딪치는 관계',
  branchTripleCombine: '모여 한 기운의 힘을 키우는 관계',
};

const s = (text: string, ...evidenceIds: string[]): ReportSentence => ({ text, evidenceIds });

function groupPlain(tg: TenGod): string {
  return TEN_GOD_GROUPS.find((g) => (g.members as readonly string[]).includes(tg))!.plain;
}

/** "태어난 해의 윗글자 을(乙)" */
function placeGlyph(chart: SajuChart, ref: ChartRef): string {
  const [pos, part] = ref.split('.') as [PillarPosition, 'stem' | 'branch'];
  const p = chart.pillars[pos]!;
  return `${POSITION_PLAIN[pos]}의 ${PART_PLAIN[part]} ${part === 'stem' ? stemLabel(p.stem) : branchLabel(p.branch)}`;
}

function groupFact(chart: SajuChart, id: string, v: Voice): ReportSentence {
  const g = TEN_GOD_GROUPS.find((x) => `tenGodGroup.${x.id}` === id)!;
  const n = chart.tenGods.filter((t) => (g.members as readonly string[]).includes(t.tenGod)).length;
  const base = `${v.minus} ${chart.elements.total - 1}글자`;
  return n
    ? s(`${josa(g.plain, '을/를')} 뜻하는 글자는 ${base} 중 ${n}개예요.`, id)
    : s(`${josa(g.plain, '을/를')} 뜻하는 글자는 ${base} 중에 보이지 않아요.`, id);
}

function elementFact(chart: SajuChart, el: (typeof ELEMENTS)[number], v: Voice): ReportSentence {
  const n = chart.elements.counts[el];
  const base = `${v.mine} ${chart.elements.total}글자`;
  return n
    ? s(`${ELEMENT_PLAIN[el]}의 기운은 ${base} 중 ${n}개예요.`, `elements.${el}`)
    : s(`${ELEMENT_PLAIN[el]}의 기운은 ${base} 중에 보이지 않아요.`, `elements.${el}`);
}

function tenGodFact(chart: SajuChart, id: string): ReportSentence | null {
  const m = /^tenGod\.(year|month|day|hour)\.(stem|branch)$/u.exec(id);
  const t = m && chart.tenGods.find((x) => x.position === m[1] && x.part === m[2]);
  if (!m || !t) return null;
  return s(`${josa(placeGlyph(chart, `${m[1]}.${m[2]}` as ChartRef), '은/는')} ${josa(groupPlain(t.tenGod), '을/를')} 뜻하는 글자예요.`, id);
}

function relationFact(chart: SajuChart, e: Evidence): ReportSentence | null {
  const r = chart.relations.find((x) => `relation.${x.kind}.${x.refs.join('+')}` === e.id);
  if (!r) return null;
  const names = r.refs.map((ref) => placeGlyph(chart, ref));
  const subject = names.length === 2 ? `${josa(names[0]!, '와/과')} ${names[1]}` : names.join(', ');
  return s(`${josa(subject, '은/는')} ${RELATION_PLAIN[r.kind]}예요.`, e.id);
}

function daewoonFacts(chart: SajuChart, index: number): ReportSentence[] {
  const d = chart.daewoon[index]!;
  const id = `daewoon[${index}]`;
  const name = `${pillarLabel(d.pillar)}의 큰 흐름`;
  return [
    s(`${daewoonStartLabel(d, chart.solarDate)}부터 10년은 ${name}이에요.`, id),
    s(`${name}에서 윗글자 ${josa(stemLabel(d.pillar.stem), '은/는')} ${ELEMENT_PLAIN[STEM_ELEMENTS[d.pillar.stem]!]}의 기운이에요.`, id),
    s(`${name}에서 아랫글자 ${josa(branchLabel(d.pillar.branch), '은/는')} ${ELEMENT_PLAIN[BRANCH_ELEMENTS[d.pillar.branch]!]}의 기운이에요.`, id),
  ];
}

function yearFacts(chart: SajuChart, i: number, v: Voice): ReportSentence[] {
  const y = chart.seun[i]!;
  const id = `seun[${i}]`;
  const day = chart.pillars.day.stem;
  const stem = stemLabel(y.pillar.stem);
  const branch = branchLabel(y.pillar.branch);
  const rel = luckRelations(chart.pillars, y.pillar)[0];
  const own = rel ? (rel.luckPart === 'stem' ? `윗글자 ${stem}` : `아랫글자 ${branch}`) : '';
  const relSentence = rel
    ? s(`${y.year}년의 ${josa(own, '은/는')} ${josa(placeGlyph(chart, rel.ref), '와/과')} ${RELATION_PLAIN[rel.kind]}예요.`, id)
    : s(`${y.year}년의 두 글자는 ${v.mine} 글자와 같은 글자나 묶이는·부딪치는 관계가 없어요.`, id);
  return [
    s(`${y.year}년은 ${pillarLabel(y.pillar)}의 해로, 윗글자 ${josa(stem, '은/는')} ${josa(groupPlain(tenGodOfStem(day, y.pillar.stem)), '을/를')} 뜻하는 글자예요.`, id),
    s(`${y.year}년의 아랫글자 ${josa(branch, '은/는')} ${josa(groupPlain(tenGodOfBranch(day, y.pillar.branch)), '을/를')} 뜻하는 글자예요.`, id),
    relSentence,
    s(`${y.year}년의 윗글자는 ${ELEMENT_PLAIN[STEM_ELEMENTS[y.pillar.stem]!]}의 기운, 아랫글자는 ${ELEMENT_PLAIN[BRANCH_ELEMENTS[y.pillar.branch]!]}의 기운이에요.`, id),
  ];
}

/** 기본 칸(총평 이어 쓰기·성향·대운·올해·내년) 전체를 사실 문장으로 */
export function fallbackBase(chart: SajuChart, daewoonIndices: readonly number[], audience: Pick<Audience, 'child'>): BaseDraft {
  const v = audience.child ? CHILD : ADULT;
  const L = REPORT_LAYOUT;
  const { counts } = chart.elements;
  // 총평 이어 쓰기: 가장 많은 기운과 가장 적은 기운(템플릿 두 문장이 이미 일간·오행 요약을 썼다)
  const byCount = [...ELEMENTS].sort((a, b) => counts[b] - counts[a]);
  const summary = [elementFact(chart, byCount[0]!, v), elementFact(chart, byCount.at(-1)!, v)].slice(0, L.summaryAiSentences);
  const traits = TEN_GOD_GROUPS.map((g) => groupFact(chart, `tenGodGroup.${g.id}`, v)).slice(0, L.traitsSentences);
  return {
    summary,
    traits,
    daewoonNotes: daewoonIndices.map((d) => ({ daewoonIndex: d, sentences: daewoonFacts(chart, d).slice(0, L.daewoonNoteSentences) })),
    yearly: { thisYear: yearFacts(chart, 0, v).slice(0, L.yearlySentences), nextYear: yearFacts(chart, 1, v).slice(0, L.yearlySentences) },
  };
}

/** 주제 칸 하나를 사실 문장으로: 주제 근거(묶음 → 글자 → 합·충) 다음 올해·대운 사실로 채운다 */
export function fallbackTopic(chart: SajuChart, evidence: readonly Evidence[], daewoonIndices: readonly number[], audience: Pick<Audience, 'child'>): TopicDraft {
  const v = audience.child ? CHILD : ADULT;
  const ids = new Set(evidence.map((e) => e.id));
  const candidates: ReportSentence[] = [
    ...evidence.filter((e) => e.kind === 'tenGodGroup').map((e) => groupFact(chart, e.id, v)),
    ...evidence.filter((e) => e.kind === 'tenGod').flatMap((e) => tenGodFact(chart, e.id) ?? []),
    ...evidence.filter((e) => e.kind === 'relation').flatMap((e) => relationFact(chart, e) ?? []),
    ...(ids.has('seun[0]') ? yearFacts(chart, 0, v).slice(0, 2) : []),
    ...daewoonIndices.filter((d) => ids.has(`daewoon[${d}]`)).flatMap((d) => daewoonFacts(chart, d).slice(0, 1)),
    ...(ids.has('seun[1]') ? yearFacts(chart, 1, v).slice(0, 2) : []),
  ];
  return { sentences: candidates.slice(0, REPORT_LAYOUT.topicSentences) };
}

/**
 * 검증·검수를 끝내 통과하지 못한 문장만 사실 문장으로 바꾼다(D-050: 주문을 실패시키지 않는다).
 * paths: 위반 위치(summary[1], daewoonNotes[0][2], yearly.thisYear[3], 칸 전체를 가리키는 summary·daewoonNotes[0]·daewoonNotes, 빈 문자열은 전체).
 * 알 수 없는 위치가 있으면 기본 칸 전체를 바꾼다. replaced: 바꾼 문장 수
 */
export function patchBase(draft: BaseDraft, tpl: BaseDraft, paths: readonly string[]): { value: BaseDraft; replaced: number } {
  const count = (d: BaseDraft) => d.summary.length + d.traits.length + d.daewoonNotes.reduce((n, x) => n + x.sentences.length, 0) + d.yearly.thisYear.length + d.yearly.nextYear.length;
  const next: BaseDraft = {
    summary: [...draft.summary],
    traits: [...draft.traits],
    daewoonNotes: draft.daewoonNotes.map((n) => ({ ...n, sentences: [...n.sentences] })),
    yearly: { thisYear: [...draft.yearly.thisYear], nextYear: [...draft.yearly.nextYear] },
  };
  let replaced = 0;
  const swap = (xs: ReportSentence[], ys: readonly ReportSentence[], i: number) => {
    if (i < ys.length && xs[i] !== ys[i]) {
      xs[i] = ys[i]!;
      replaced++;
    }
  };
  const section = (name: string): [ReportSentence[], readonly ReportSentence[]] | null => {
    if (name === 'summary') return [next.summary, tpl.summary];
    if (name === 'traits') return [next.traits, tpl.traits];
    if (name === 'yearly.thisYear') return [next.yearly.thisYear, tpl.yearly.thisYear];
    if (name === 'yearly.nextYear') return [next.yearly.nextYear, tpl.yearly.nextYear];
    return null;
  };
  for (const p of new Set(paths)) {
    const one = /^(summary|traits|yearly\.thisYear|yearly\.nextYear)\[(\d+)\]$/u.exec(p);
    const whole = /^(summary|traits|yearly\.thisYear|yearly\.nextYear)$/u.exec(p);
    const noteOne = /^daewoonNotes\[(\d+)\]\[(\d+)\]$/u.exec(p);
    const noteWhole = /^daewoonNotes\[(\d+)\]$/u.exec(p);
    if (one) {
      const [xs, ys] = section(one[1]!)!;
      swap(xs, ys, Number(one[2]));
    } else if (whole) {
      const [xs, ys] = section(whole[1]!)!;
      replaced += xs.length;
      xs.splice(0, xs.length, ...ys);
    } else if (noteOne && next.daewoonNotes[Number(noteOne[1])] && tpl.daewoonNotes[Number(noteOne[1])]) {
      swap(next.daewoonNotes[Number(noteOne[1])]!.sentences, tpl.daewoonNotes[Number(noteOne[1])]!.sentences, Number(noteOne[2]));
    } else if (noteWhole && tpl.daewoonNotes[Number(noteWhole[1])]) {
      const i = Number(noteWhole[1]);
      replaced += next.daewoonNotes[i]?.sentences.length ?? 0;
      next.daewoonNotes[i] = { ...tpl.daewoonNotes[i]!, sentences: [...tpl.daewoonNotes[i]!.sentences] };
    } else if (p === 'daewoonNotes') {
      // 리뷰 반영: 칸 수가 모자란 응답이면 사실 문장으로 채운 문장이 AI 문장보다 많다. 둘 중 큰 수를 센다
      const before = next.daewoonNotes.reduce((n, x) => n + x.sentences.length, 0);
      replaced += Math.max(before, tpl.daewoonNotes.reduce((n, x) => n + x.sentences.length, 0));
      next.daewoonNotes = tpl.daewoonNotes.map((n) => ({ ...n, sentences: [...n.sentences] }));
    } else {
      return { value: tpl, replaced: count(tpl) };
    }
  }
  return { value: next, replaced };
}

/** 주제 칸에서 통과하지 못한 문장만 사실 문장으로 바꾼다(D-050). prefix: 위반 위치의 앞부분(topics.wealth) */
export function patchTopic(draft: TopicDraft, tpl: TopicDraft, paths: readonly string[], prefix: string): { value: TopicDraft; replaced: number } {
  const next = [...draft.sentences];
  let replaced = 0;
  for (const p of new Set(paths)) {
    const one = p.startsWith(`${prefix}[`) ? /\[(\d+)\]$/u.exec(p) : null;
    const i = one ? Number(one[1]) : -1;
    if (one && i < tpl.sentences.length && i < next.length) {
      if (next[i] !== tpl.sentences[i]) {
        next[i] = tpl.sentences[i]!;
        replaced++;
      }
    } else {
      return { value: tpl, replaced: tpl.sentences.length };
    }
  }
  return { value: { sentences: next }, replaced };
}

// ---- 월별·10년 흐름(D-052) ----

const REL_SHORT: Record<LuckRelation['kind'], string> = {
  same: '같은 글자', stemCombine: '서로 끌려 묶이는 관계', stemClash: '서로 부딪치는 관계', branchSixCombine: '짝을 이뤄 묶이는 관계', branchClash: '정면으로 부딪치는 관계',
};

/** 달 하나의 사실 문장 2개(그달 근거 month[i]를 인용) */
export function monthFacts(chart: SajuChart, m: MonthPeriod): ReportSentence[] {
  const id = `month[${m.index}]`;
  const day = chart.pillars.day.stem;
  const name = `${m.from.year}년 ${m.from.month}월`;
  const stem = stemLabel(m.pillar.stem);
  const branch = branchLabel(m.pillar.branch);
  const rel = m.relations[0];
  const second = rel
    ? s(`${name}의 ${josa(rel.luckPart === 'stem' ? `윗글자 ${stem}` : `아랫글자 ${branch}`, '은/는')} ${josa(placeGlyph(chart, rel.ref), '와/과')} ${REL_SHORT[rel.kind]}예요.`, id)
    : s(`${name}의 아랫글자 ${josa(branch, '은/는')} ${josa(groupPlain(tenGodOfBranch(day, m.pillar.branch)), '을/를')} 뜻하는 글자예요.`, id);
  return [
    s(`${name}은 ${pillarLabel(m.pillar)}의 달로, 윗글자 ${josa(stem, '은/는')} ${josa(groupPlain(tenGodOfStem(day, m.pillar.stem)), '을/를')} 뜻하는 글자예요.`, id),
    second,
  ];
}

/** 해 하나의 사실 문장(그해 근거 year[i]를 인용). 아이 요약은 첫 문장만 쓴다. grown: 만 13세 이상이 되는 해(아이 호칭을 쓰지 않는다) */
export function yearFacts10(chart: SajuChart, y: YearPeriod, audience: Pick<Audience, 'child'>): ReportSentence[] {
  const id = `year[${y.index}]`;
  const day = chart.pillars.day.stem;
  const stem = stemLabel(y.pillar.stem);
  const meaning = `윗글자 ${josa(stem, '은/는')} ${josa(groupPlain(tenGodOfStem(day, y.pillar.stem)), '을/를')} 뜻하는 글자예요.`;
  const first = audience.child
    ? s(`${y.year}년은 ${y.ageAfterBirthday < 13 ? '아이가 ' : ''}만 ${y.ageAfterBirthday}세가 되는 해로, ${meaning}`, id)
    : s(`${y.year}년은 ${pillarLabel(y.pillar)}의 해로, ${meaning}`, id);
  const flow = y.nextDaewoon
    ? s(`${y.year}년에는 큰 흐름이 ${yearDaewoonLabel(y)}${hasBatchim(yearDaewoonLabel(y)) ? '으로' : '로'} 바뀌어요.`, id)
    : y.daewoon
      ? s(`${y.year}년의 큰 흐름은 ${josa(pillarLabel(y.daewoon.pillar), '이에요/예요')}.`, id)
      : s(`${y.year}년은 첫 큰 흐름이 시작되기 전이에요.`, id);
  return [first, flow];
}

/** 어른 월별 흐름 전체를 사실 문장으로 */
export function fallbackMonths(chart: SajuChart, months: readonly MonthPeriod[]): PeriodDraft {
  return { periods: months.map((m) => ({ index: m.index, sentences: monthFacts(chart, m).slice(0, REPORT_LAYOUT.monthSentences) })) };
}

/** 어른 10년 흐름 전체를 사실 문장으로 */
export function fallbackYears(chart: SajuChart, years: readonly YearPeriod[]): PeriodDraft {
  return { periods: years.map((y) => ({ index: y.index, sentences: yearFacts10(chart, y, { child: false }).slice(0, REPORT_LAYOUT.yearSentences) })) };
}

/** 아이 부모 관점 요약 전체를 사실 문장으로: 묶음마다 첫 달·가운데 달의 첫 사실, 해마다 첫 사실 */
export function fallbackChildPeriods(chart: SajuChart, months: readonly MonthPeriod[], seasons: readonly SeasonPeriod[], years: readonly YearPeriod[]): ChildPeriodDraft {
  return {
    seasons: seasons.map((g) => ({
      index: g.index,
      sentences: [g.monthIndices[0]!, g.monthIndices[1] ?? g.monthIndices[0]!].map((i) => monthFacts(chart, months[i]!)[0]!).slice(0, REPORT_LAYOUT.seasonSentences),
    })),
    years: years.map((y) => ({ index: y.index, sentences: yearFacts10(chart, y, { child: true }).slice(0, REPORT_LAYOUT.childYearSentences) })),
  };
}

/** 칸 묶음 하나(prefix: months·years·seasons)에서 걸린 문장만 바꾼다. 위치를 알 수 없으면 null(칸 전체를 바꾼다) */
function patchNotes(notes: readonly PeriodNote[], tpl: readonly PeriodNote[], paths: readonly string[], prefix: string): { notes: PeriodNote[]; replaced: number } | null {
  const next = notes.map((n) => ({ ...n, sentences: [...n.sentences] }));
  let replaced = 0;
  for (const p of paths) {
    const one = new RegExp(`^${prefix}\\[(\\d+)\\]\\[(\\d+)\\]$`, 'u').exec(p);
    const whole = new RegExp(`^${prefix}\\[(\\d+)\\]$`, 'u').exec(p);
    if (one) {
      const [i, j] = [Number(one[1]), Number(one[2])];
      const t = tpl[i]?.sentences[j];
      if (!t || !next[i] || j >= next[i]!.sentences.length) return null;
      if (next[i]!.sentences[j] !== t) {
        next[i]!.sentences[j] = t;
        replaced++;
      }
    } else if (whole) {
      const i = Number(whole[1]);
      if (!tpl[i]) return null;
      // 이미 사실 문장으로 바꾼 문장은 다시 세지 않는다(C안 1문장 칸: 문장 위반 + 칸 인용 위반이 함께 나와 두 번 셌다)
      const cur = next[i]?.sentences ?? [];
      const t = tpl[i]!.sentences;
      replaced += t.filter((x, k) => cur[k] !== x).length + Math.max(0, cur.length - t.length);
      next[i] = { ...tpl[i]!, sentences: [...tpl[i]!.sentences] };
    } else {
      return null;
    }
  }
  return { notes: next, replaced };
}

const noteSize = (ns: readonly PeriodNote[]) => ns.reduce((n, x) => n + x.sentences.length, 0);

/** 월별·10년 흐름에서 통과하지 못한 문장만 사실 문장으로(D-050과 같은 규칙). prefix: months 또는 years */
export function patchPeriods(draft: PeriodDraft, tpl: PeriodDraft, paths: readonly string[], prefix: string): { value: PeriodDraft; replaced: number } {
  const r = patchNotes(draft.periods, tpl.periods, paths, prefix);
  return r ? { value: { periods: r.notes }, replaced: r.replaced } : { value: tpl, replaced: noteSize(tpl.periods) };
}

/** 아이 부모 관점 요약에서 통과하지 못한 문장만 사실 문장으로 */
export function patchChildPeriods(draft: ChildPeriodDraft, tpl: ChildPeriodDraft, paths: readonly string[]): { value: ChildPeriodDraft; replaced: number } {
  const seasonPaths = paths.filter((p) => p.startsWith('seasons'));
  const yearPaths = paths.filter((p) => p.startsWith('years'));
  const other = paths.filter((p) => !p.startsWith('seasons') && !p.startsWith('years'));
  const sz = patchNotes(draft.seasons, tpl.seasons, seasonPaths, 'seasons');
  const yz = patchNotes(draft.years, tpl.years, yearPaths, 'years');
  if (other.length || !sz || !yz) return { value: tpl, replaced: noteSize(tpl.seasons) + noteSize(tpl.years) };
  return { value: { seasons: sz.notes, years: yz.notes }, replaced: sz.replaced + yz.replaced };
}
