// 화면 리포트와 PDF가 함께 쓰는 리포트 데이터(같은 템플릿, 같은 섹션 순서, 같은 근거 번호).
// 섹션 순서(SPEC Phase 3, 고정): 표지 → 사주 차트 → 오행 분포 → 총평 → 타고난 성향 → 주제별 풀이 → 대운 흐름 → 올해·내년 흐름
//   → 풀이 근거 목록 → 면책·계산 기준·사업자 정보
import { TOPICS } from '../config/topics';
import { pillarLabel } from '../engine/constants';
import { daewoonStartLabel } from '../engine/daewoon';
import type { Evidence, SajuChart } from '../engine/types';
import type { ReportBody, ReportSentence } from '../llm/types';
import { buildChartView, type ChartView } from './chartView';
import type { ReportAngles } from './angleTable';
import { angleNotesOf, buildEvidenceItems, type CitingSentence, type EvidenceItem } from './evidenceText';

export interface SentenceView {
  /** 문장 앵커 id (근거 목록의 ↳ 줄이 이 문장으로 이동한다) */
  id: string;
  text: string;
  /** 사실 번호 (1부터, 풀이 근거 목록의 순서. D-041) */
  refs: number[];
  /** 사실 번호 → "이 문장은 ○○ 쪽으로 풀었어요." (D-047, 화면 카드에만 보여 준다) */
  angleNotes?: Record<number, string>;
}

export type { EvidenceItem } from './evidenceTerms';

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
  /** 판정이 갈릴 수 있는 경우의 안내(엔진 notices). 차트 바로 아래에 보여 준다(D-039) */
  notices: { code: string; message: string; details: string[] }[];
}

const hhmm = (h: number, m: number) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

function noticeDetails(n: SajuChart['notices'][number]): string[] {
  if (n.minute) {
    const h = n.minute.hour;
    return n.minute.segments.map((s) => {
      const p = s.pillars;
      return `${hhmm(h, s.fromMinute)}~${hhmm(h, s.toMinute)} 출생: 시주 ${p.hour ? pillarLabel(p.hour) : '-'} · 일주 ${pillarLabel(p.day)} · 월주 ${pillarLabel(p.month)} · 년주 ${pillarLabel(p.year)}`;
    });
  }
  if (n.jie) {
    const j = n.jie;
    return [
      `${j.name} 절입(${j.localTime}) 전 출생: 월주 ${pillarLabel(j.ifBefore.month)} · 년주 ${pillarLabel(j.ifBefore.year)}`,
      `${j.name} 절입 뒤 출생: 월주 ${pillarLabel(j.ifAfter.month)} · 년주 ${pillarLabel(j.ifAfter.year)}`,
    ];
  }
  return [];
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
  /** 만 13세 미만 아이 사주: 주제 선택 화면에 아이용 주제 이름을 쓴다(D-046) */
  child: boolean;
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

/** 칸 이름이 붙은 문장 묶음 (근거 목록의 ↳ 줄에 칸 이름을 보여 준다) */
interface LabeledSentences {
  where: string;
  sentences: readonly ReportSentence[];
  /** 각도 칸 키(D-047: summary, traits, topic:wealth, daewoon:0, thisYear, nextYear) */
  section?: string;
}

/**
 * 근거 번호를 매긴다(D-041·D-042). 화면에 나온 문장이 인용한 근거만 목록에 넣고, 같은 사실의 근거는 한 항목·같은 번호로 합친다.
 * 번호는 목록 묶음 순서(타고난 사실 → 시기·흐름)대로 1부터다. 그래서 문장 속 번호는 순서가 섞일 수 있다.
 * 문장 id는 화면에 나오는 순서대로 s0, s1, …이다. 반환하는 sentences는 blocks와 같은 모양이다.
 */
function numberEvidence(chart: SajuChart, evidence: readonly Evidence[], blocks: readonly LabeledSentences[], child = false, angles?: ReportAngles) {
  const byId = new Map(evidence.map((e) => [e.id, e]));
  let k = 0;
  const citing: CitingSentence[][] = blocks.map((b) =>
    b.sentences.map((s) => ({ sentenceId: `s${k++}`, where: b.where, text: s.text, evidenceIds: s.evidenceIds })),
  );
  const { items, numberOf } = buildEvidenceItems(chart, byId, citing.flat(), { child, angles });
  const sentences = citing.map((xs, bi) =>
    xs.map((s): SentenceView => {
      const refs = [...new Set(s.evidenceIds.flatMap((id) => (numberOf.has(id) ? [numberOf.get(id)!] : [])))];
      const notes = angleNotesOf(chart, s.evidenceIds, numberOf, angles?.bySection[blocks[bi]!.section ?? ''] ?? null);
      return { id: s.sentenceId, text: s.text, refs, ...(notes ? { angleNotes: notes } : {}) };
    }),
  );
  return { items, sentences };
}

export function calcBasis(chart: SajuChart): CalcBasis {
  const s = chart.settings;
  return {
    jasi: s.jasiMode === 'split' ? '야자시·조자시 구분(23시대는 당일 일주)' : '23시부터 다음 날 일주',
    timeCorrection: [
      s.longitudeCorrection ? `경도 보정(동경 ${s.longitudeUsed}°)` : '경도 보정 없음',
      s.historicalTimezone ? '서머타임·과거 표준시 반영' : '서머타임 미반영',
      chart.input.hasTime ? null : chart.warnings.includes('unknownMinuteOnBoundary') ? '태어난 분 모름(시주 제외)' : '태어난 시간 모름(시주 제외)',
    ].filter((x): x is string => !!x).join(', '),
    calendar: '절기(절입 시각) 기준 년·월주, 한국천문연구원 음력',
    notices: chart.notices.map((n) => ({ code: n.code, message: n.message, details: noticeDetails(n) })),
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
  const daewoonTitle = (index: number) => {
    const d = args.chart.daewoon[index];
    return d ? `${index + 1}번째 대운 · ${daewoonStartLabel(d)}부터` : `${index + 1}번째 대운`;
  };
  const year = args.chart.seun[0]?.year;
  const topics = TOPICS.filter((t) => args.topicIds.includes(t.id) && args.body.topics[t.id]);
  // 아이 리포트는 주제 이름도 아이용(물건·돈 습관 / 재능·배움 / 관계, D-046)
  const topicLabel = (t: (typeof topics)[number]) => (args.body.audience === 'child' ? t.childLabel : t.label);
  const thisYear = year ? `${year}년` : '올해';
  const nextYear = year ? `${year + 1}년` : '내년';
  // 화면에 나오는 문장만 근거 번호를 매긴다(고르지 않은 주제의 근거는 목록에 없다). 순서는 화면 순서와 같다
  const blocks: LabeledSentences[] = [
    { where: SECTION_TITLES.summary, sentences: args.body.summary, section: 'summary' },
    { where: SECTION_TITLES.traits, sentences: args.body.traits, section: 'traits' },
    ...topics.map((t) => ({ where: topicLabel(t), sentences: args.body.topics[t.id]!, section: `topic:${t.id}` })),
    ...args.body.daewoonNotes.map((n, i) => ({ where: daewoonTitle(n.daewoonIndex), sentences: n.sentences, section: `daewoon:${i}` })),
    { where: thisYear, sentences: args.body.yearly.thisYear, section: 'thisYear' },
    { where: nextYear, sentences: args.body.yearly.nextYear, section: 'nextYear' },
  ];
  // 아이 리포트면 사실 카드도 "아이"로 부른다(D-045). 풀이 각도가 있으면 사실 카드에 뜻 전체와 이 문장의 각도를 보여 준다(D-047)
  const numbering = numberEvidence(args.chart, args.evidence, blocks, args.body.audience === 'child', args.body.angles);
  const [summary, traits, ...rest] = numbering.sentences;
  const topicSentences = rest.slice(0, topics.length);
  const daewoonSentences = rest.slice(topics.length, topics.length + args.body.daewoonNotes.length);
  const [thisYearSentences, nextYearSentences] = rest.slice(topics.length + args.body.daewoonNotes.length);
  const sections: TextSection[] = [
    { id: 'summary', title: SECTION_TITLES.summary, groups: [{ subtitle: null, sentences: summary! }] },
    { id: 'traits', title: SECTION_TITLES.traits, groups: [{ subtitle: null, sentences: traits! }] },
    ...(topics.length
      ? [{ id: 'topics' as const, title: SECTION_TITLES.topics, groups: topics.map((t, i) => ({ subtitle: topicLabel(t), sentences: topicSentences[i]! })) }]
      : []),
    {
      id: 'daewoon',
      title: SECTION_TITLES.daewoon,
      groups: args.body.daewoonNotes.map((n, i) => ({ subtitle: daewoonTitle(n.daewoonIndex), sentences: daewoonSentences[i]! })),
    },
    {
      id: 'yearly',
      title: SECTION_TITLES.yearly,
      groups: [
        { subtitle: thisYear, sentences: thisYearSentences! },
        { subtitle: nextYear, sentences: nextYearSentences! },
      ],
    },
  ];
  return {
    kind: 'full',
    cover: { name: args.name, birthLabel: args.birthLabel },
    chart: buildChartView(args.chart),
    sections,
    evidence: numbering.items,
    basis: calcBasis(args.chart),
  };
}

export function buildPreviewView(args: {
  chart: SajuChart;
  evidence: readonly Evidence[];
  summary: readonly ReportSentence[];
  name: string | null;
  birthLabel: string;
  /** 만 13세 미만 아이(결제 후 리포트와 같은 기준, D-044·D-045) */
  child?: boolean;
}): PreviewView {
  const numbering = numberEvidence(args.chart, args.evidence, [{ where: SECTION_TITLES.summary, sentences: args.summary }], args.child ?? false);
  return {
    kind: 'preview',
    cover: { name: args.name, birthLabel: args.birthLabel },
    child: args.child ?? false,
    chart: buildChartView(args.chart),
    summary: numbering.sentences[0]!,
    locked: [
      { id: 'traits', title: SECTION_TITLES.traits },
      { id: 'topics', title: SECTION_TITLES.topics },
      { id: 'daewoon', title: SECTION_TITLES.daewoon },
      { id: 'yearly', title: SECTION_TITLES.yearly },
    ],
    evidence: numbering.items,
    basis: calcBasis(args.chart),
  };
}

/** 표지의 생년월일시 표기. timeText: 분 모름일 때의 시각 표기(D-039) */
export function birthLabelOf(
  input: { calendar: 'solar' | 'lunar'; isLeapMonth: boolean; year: number; month: number; day: number; time: { hour: number; minute: number } | null; gender: 'male' | 'female' },
  timeText?: string,
): string {
  const cal = input.calendar === 'solar' ? '양력' : input.isLeapMonth ? '음력(윤달)' : '음력';
  const time = timeText ? ` ${timeText}` : input.time ? ` ${String(input.time.hour).padStart(2, '0')}:${String(input.time.minute).padStart(2, '0')}` : ' 시간 모름';
  return `${cal} ${input.year}년 ${input.month}월 ${input.day}일${time} · ${input.gender === 'male' ? '남' : '여'}`;
}
