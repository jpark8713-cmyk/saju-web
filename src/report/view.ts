// 화면 리포트와 PDF가 함께 쓰는 리포트 데이터(같은 템플릿, 같은 섹션 순서, 같은 근거 번호).
// 섹션 순서(SPEC Phase 3, 고정): 표지 → 사주 차트 → 오행 분포 → 총평 → 타고난 성향 → 주제별 풀이 → 대운 흐름 → 올해·내년 흐름
//   → 풀이 근거 목록 → 면책·계산 기준·사업자 정보
import { TOPICS } from '../config/topics';
import { daewoonStartLabel } from '../engine/daewoon';
import type { ChartRef, Evidence, SajuChart } from '../engine/types';
import type { ReportBody, ReportSentence } from '../llm/types';
import { buildChartView, type ChartView } from './chartView';

export interface SentenceView {
  text: string;
  /** 근거 번호 (1부터, 리포트 전체에서 처음 나온 순서) */
  refs: number[];
}

export interface EvidenceItem {
  n: number;
  id: string;
  content: string;
  chartRefs: ChartRef[];
}

export interface TextSection {
  id: 'summary' | 'traits' | 'topics' | 'daewoon' | 'yearly';
  title: string;
  /** 소제목이 있는 묶음 (주제별, 대운별, 연도별). 소제목이 없으면 title 하나 */
  groups: { subtitle: string | null; sentences: SentenceView[] }[];
}

export interface CalcBasis {
  jasi: string;
  timeCorrection: string;
  calendar: string;
}

export interface ReportView {
  kind: 'full';
  cover: { name: string | null; birthLabel: string };
  chart: ChartView;
  sections: TextSection[];
  evidence: EvidenceItem[];
  basis: CalcBasis;
}

export interface LockedSection {
  id: 'traits' | 'topics' | 'daewoon' | 'yearly';
  title: string;
}

export interface PreviewView {
  kind: 'preview';
  cover: { name: string | null; birthLabel: string };
  chart: ChartView;
  /** 총평 무료 공개분 (코드 템플릿 문장) */
  summary: SentenceView[];
  /** 잠긴 섹션: 제목만 보낸다(본문은 결제 전에 서버가 보내지 않는다) */
  locked: LockedSection[];
  evidence: EvidenceItem[];
  basis: CalcBasis;
}

export const SECTION_TITLES = {
  summary: '총평',
  traits: '타고난 성향',
  topics: '주제별 풀이',
  daewoon: '대운 흐름',
  yearly: '올해·내년 흐름',
} as const;

/** 문장에 처음 나온 순서대로 근거 번호를 매긴다 */
class Numbering {
  private readonly order = new Map<string, number>();
  constructor(private readonly byId: ReadonlyMap<string, Evidence>) {}

  sentence(s: ReportSentence): SentenceView {
    const refs = s.evidenceIds.filter((id) => this.byId.has(id)).map((id) => this.number(id));
    return { text: s.text, refs: [...new Set(refs)] };
  }

  private number(id: string): number {
    const found = this.order.get(id);
    if (found) return found;
    const n = this.order.size + 1;
    this.order.set(id, n);
    return n;
  }

  items(): EvidenceItem[] {
    return [...this.order.entries()].map(([id, n]) => {
      const e = this.byId.get(id)!;
      return { n, id, content: e.content, chartRefs: e.chartRefs };
    });
  }
}

export function calcBasis(chart: SajuChart): CalcBasis {
  const s = chart.settings;
  return {
    jasi: s.jasiMode === 'split' ? '야자시·조자시 구분(23시대는 당일 일주)' : '23시부터 다음 날 일주',
    timeCorrection: [
      s.longitudeCorrection ? `경도 보정(동경 ${s.longitudeUsed}°)` : '경도 보정 없음',
      s.historicalTimezone ? '서머타임·과거 표준시 반영' : '서머타임 미반영',
      chart.input.hasTime ? null : '태어난 시간 모름(시주 제외)',
    ].filter((x): x is string => !!x).join(', '),
    calendar: '절기(절입 시각) 기준 년·월주, 한국천문연구원 음력',
  };
}

export function buildReportView(args: {
  chart: SajuChart;
  evidence: readonly Evidence[];
  body: ReportBody;
  /** 소비자가 고른 주제 (이 주제만 보여 주고, 근거 목록에도 이 주제의 근거만 남는다) */
  topicIds: readonly string[];
  name: string | null;
  birthLabel: string;
}): ReportView {
  const numbering = new Numbering(new Map(args.evidence.map((e) => [e.id, e])));
  const map = (xs: readonly ReportSentence[]) => xs.map((s) => numbering.sentence(s));
  const daewoonTitle = (index: number) => {
    const d = args.chart.daewoon[index];
    return d ? `${index + 1}번째 대운 · ${daewoonStartLabel(d)}부터` : `${index + 1}번째 대운`;
  };
  const year = args.chart.seun[0]?.year;
  const topics = TOPICS.filter((t) => args.topicIds.includes(t.id) && args.body.topics[t.id]);
  const sections: TextSection[] = [
    { id: 'summary', title: SECTION_TITLES.summary, groups: [{ subtitle: null, sentences: map(args.body.summary) }] },
    { id: 'traits', title: SECTION_TITLES.traits, groups: [{ subtitle: null, sentences: map(args.body.traits) }] },
    ...(topics.length
      ? [{ id: 'topics' as const, title: SECTION_TITLES.topics, groups: topics.map((t) => ({ subtitle: t.label, sentences: map(args.body.topics[t.id]!) })) }]
      : []),
    {
      id: 'daewoon',
      title: SECTION_TITLES.daewoon,
      groups: args.body.daewoonNotes.map((n) => ({ subtitle: daewoonTitle(n.daewoonIndex), sentences: map(n.sentences) })),
    },
    {
      id: 'yearly',
      title: SECTION_TITLES.yearly,
      groups: [
        { subtitle: year ? `${year}년` : '올해', sentences: map(args.body.yearly.thisYear) },
        { subtitle: year ? `${year + 1}년` : '내년', sentences: map(args.body.yearly.nextYear) },
      ],
    },
  ];
  return {
    kind: 'full',
    cover: { name: args.name, birthLabel: args.birthLabel },
    chart: buildChartView(args.chart),
    sections,
    evidence: numbering.items(),
    basis: calcBasis(args.chart),
  };
}

export function buildPreviewView(args: {
  chart: SajuChart;
  evidence: readonly Evidence[];
  summary: readonly ReportSentence[];
  name: string | null;
  birthLabel: string;
}): PreviewView {
  const numbering = new Numbering(new Map(args.evidence.map((e) => [e.id, e])));
  return {
    kind: 'preview',
    cover: { name: args.name, birthLabel: args.birthLabel },
    chart: buildChartView(args.chart),
    summary: args.summary.map((s) => numbering.sentence(s)),
    locked: [
      { id: 'traits', title: SECTION_TITLES.traits },
      { id: 'topics', title: SECTION_TITLES.topics },
      { id: 'daewoon', title: SECTION_TITLES.daewoon },
      { id: 'yearly', title: SECTION_TITLES.yearly },
    ],
    evidence: numbering.items(),
    basis: calcBasis(args.chart),
  };
}

/** 표지의 생년월일시 표기 */
export function birthLabelOf(input: { calendar: 'solar' | 'lunar'; isLeapMonth: boolean; year: number; month: number; day: number; time: { hour: number; minute: number } | null; gender: 'male' | 'female' }): string {
  const cal = input.calendar === 'solar' ? '양력' : input.isLeapMonth ? '음력(윤달)' : '음력';
  const time = input.time ? ` ${String(input.time.hour).padStart(2, '0')}:${String(input.time.minute).padStart(2, '0')}` : ' 시간 모름';
  return `${cal} ${input.year}년 ${input.month}월 ${input.day}일${time} · ${input.gender === 'male' ? '남' : '여'}`;
}
