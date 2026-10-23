// 화면 리포트와 PDF가 함께 쓰는 리포트 데이터(같은 템플릿, 같은 섹션 순서, 같은 근거 번호).
// 섹션 순서(SPEC Phase 3, 고정): 표지 → 사주 차트 → 오행 분포 → 총평 → 타고난 성향 → 주제별 풀이 → 대운 흐름 → 올해·내년 흐름
//   → 월별 흐름(아이는 계절별 흐름) → 10년 흐름(D-052) → 풀이 근거 목록 → 면책·계산 기준·사업자 정보
import { REPORT_LAYOUT } from '../config/report';
import { TOPICS } from '../config/topics';
import { BRANCHES_HANJA, BRANCHES_KO, PART_PLAIN, POSITION_PLAIN, STEMS_HANJA, STEMS_KO, TEN_GOD_GROUPS, branchLabel, pillarLabel, stemLabel } from '../engine/constants';
import { tenGodOfBranch, tenGodOfStem } from '../engine/tenGods';
import { josa } from './evidenceTerms';
import { daewoonStartLabel } from '../engine/daewoon';
import { buildPeriodEvidence, yearDaewoonLabel } from '../engine/evidence';
import { rankRelations, type MonthPeriod, type SeasonPeriod, type YearPeriod } from '../engine/periods';
import { luckRelations, type LuckRelation } from '../engine/relations';
import type { PillarPosition } from '../engine/types';
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

/** 원국 글자와의 관계 칩(D-052): "기(己) ↔ 태어난 날 윗글자 · 같은 글자" */
export interface RelationChip {
  text: string;
  kind: 'same' | 'combine' | 'clash';
}

export interface SectionGroup {
  subtitle: string | null;
  sentences: SentenceView[];
  /** 월별 흐름의 계절 묶음 이름(바뀔 때 화면에 머리로 보여 준다, D-052) */
  cluster?: string;
  /** 원국 글자와의 관계 칩(D-052) */
  chips?: RelationChip[];
  /** 10년 흐름의 큰 흐름 표시와 전환 해 여부(D-052) */
  flow?: { label: string; turning: boolean };
  /**
   * 코드 사실 줄(D-052 3단계): 어른 월별·10년은 AI 문장 앞에, 10년 흐름의 올해·내년은 AI 문장 대신(링크: 올해·내년 칸).
   * PDF에는 링크 대신 문구만
   */
  fact?: { text: string; link?: { href: string; label: string } };
}

export interface TextSection {
  id: 'summary' | 'traits' | 'topics' | 'daewoon' | 'yearly' | 'months' | 'seasons' | 'years';
  title: string;
  /** 소제목이 있는 묶음 (주제별, 대운별, 연도별, 달별). 소제목이 없으면 title 하나 */
  groups: SectionGroup[];
  /** 칸 아래 안내 한 줄과 링크(D-052: 올해·내년 칸 → 월별·10년 흐름) */
  note?: { text: string; links: { href: string; label: string }[] };
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
  months: '월별 흐름',
  seasons: '계절별 흐름',
  years: '10년 흐름',
} as const;

const REL_KIND: Record<LuckRelation['kind'], { word: string; kind: RelationChip['kind'] }> = {
  same: { word: '같은 글자', kind: 'same' },
  stemCombine: { word: '묶임', kind: 'combine' },
  branchSixCombine: { word: '묶임', kind: 'combine' },
  stemClash: { word: '부딪침', kind: 'clash' },
  branchClash: { word: '부딪침', kind: 'clash' },
};

function relationChips(p: { stem: number; branch: number }, rels: readonly LuckRelation[]): RelationChip[] {
  return rels.map((r) => {
    const own = r.luckPart === 'stem' ? `${STEMS_KO[p.stem]}(${STEMS_HANJA[p.stem]})` : `${BRANCHES_KO[p.branch]}(${BRANCHES_HANJA[p.branch]})`;
    const [pos, part] = r.ref.split('.') as [PillarPosition, 'stem' | 'branch'];
    return { text: `${own} ↔ ${POSITION_PLAIN[pos]} ${PART_PLAIN[part]} · ${REL_KIND[r.kind].word}`, kind: REL_KIND[r.kind].kind };
  });
}

const md = (d: { month: number; day: number }) => `${d.month}/${d.day}`;
const monthTitle = (m: MonthPeriod) => `${m.from.year}년 ${m.from.month}월 · ${m.term} ${md(m.from)}~${md(m.to)} · ${pillarLabel(m.pillar)}`;
/** 묶음 이름(D-052 3단계): 계절 이름 대신 날짜 범위와 절기. "2026년 10/8 ~ 2027년 1/4 (한로·입동·대설)" */
const seasonTitle = (g: SeasonPeriod, months: readonly MonthPeriod[]) =>
  `${g.from.year}년 ${md(g.from)} ~ ${g.to.year}년 ${md(g.to)} (${g.monthIndices.map((i) => months[i]!.term).join('·')})`;
const yearTitle = (y: YearPeriod) => `${y.year}년 · ${pillarLabel(y.pillar)} · 만 ${y.ageAfterBirthday}세(생일 뒤)`;

/** 올해(0)·내년(1) 글자와 원국 글자의 관계 칩: 월·10년 칸과 같은 계산(D-052 3단계) */
export function seunRelations(chart: SajuChart, i: number): LuckRelation[] {
  const y = chart.seun[i];
  return y ? rankRelations(luckRelations(chart.pillars, y.pillar)) : [];
}

function seunChips(chart: SajuChart, i: number): RelationChip[] {
  const y = chart.seun[i];
  return y ? relationChips(y.pillar, seunRelations(chart, i)) : [];
}

const REL_SENTENCE: Record<LuckRelation['kind'], string> = {
  same: '같은 글자예요', stemCombine: '서로 묶이는 관계예요', branchSixCombine: '서로 묶이는 관계예요', stemClash: '서로 부딪치는 관계예요', branchClash: '서로 부딪치는 관계예요',
};

/**
 * 달·해 사실 줄(D-052 3단계, 코드 문구): 윗글자·아랫글자의 뜻 묶음과 주된 관계 하나.
 * 어른 월별·10년은 칸마다 이 줄 + AI 1문장, 10년 흐름의 올해·내년은 이 줄만(올해·내년 칸 링크)
 */
function periodFactLine(chart: SajuChart, p: { stem: number; branch: number }, rels: readonly LuckRelation[]): string {
  const day = chart.pillars.day.stem;
  const plain = (tg: string) => TEN_GOD_GROUPS.find((g) => (g.members as readonly string[]).includes(tg))!.plain;
  const meaning = `윗글자 ${josa(stemLabel(p.stem), '은/는')} ${josa(plain(tenGodOfStem(day, p.stem)), '을/를')}, 아랫글자 ${josa(branchLabel(p.branch), '은/는')} ${josa(plain(tenGodOfBranch(day, p.branch)), '을/를')} 뜻하는 글자예요.`;
  const r = rels[0];
  if (!r) return meaning;
  const [pos, part] = r.ref.split('.') as [PillarPosition, 'stem' | 'branch'];
  const target = chart.pillars[pos];
  if (!target) return meaning;
  const own = r.luckPart === 'stem' ? `윗글자 ${stemLabel(p.stem)}` : `아랫글자 ${branchLabel(p.branch)}`;
  const theirs = `${POSITION_PLAIN[pos]} ${PART_PLAIN[part]} ${part === 'stem' ? stemLabel(target.stem) : branchLabel(target.branch)}`;
  return `${meaning} ${josa(own, '은/는')} ${josa(theirs, '와/과')} ${REL_SENTENCE[r.kind]}.`;
}

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
function numberEvidence(
  chart: SajuChart,
  evidence: readonly Evidence[],
  blocks: readonly LabeledSentences[],
  child = false,
  angles?: ReportAngles,
  periods?: { months: readonly MonthPeriod[]; years: readonly YearPeriod[] },
) {
  const byId = new Map(evidence.map((e) => [e.id, e]));
  let k = 0;
  const citing: CitingSentence[][] = blocks.map((b) =>
    b.sentences.map((s) => ({ sentenceId: `s${k++}`, where: b.where, text: s.text, evidenceIds: s.evidenceIds })),
  );
  const { items, numberOf } = buildEvidenceItems(chart, byId, citing.flat(), { child, angles, periods });
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
  const child = args.body.audience === 'child';
  // 월별·10년 흐름(D-052): 사실은 저장하지 않고 차트와 asOf로 다시 계산한다(생성 때와 같은 함수)
  const bp = args.body.periods;
  const facts = bp ? buildPeriodEvidence(args.chart, new Date(bp.asOf), bp.referenceYear, { child }) : null;
  const periodBlocks: LabeledSentences[] = bp && facts
    ? [
        ...(bp.months ?? []).map((n, i) => ({ where: `${facts.months[i]!.from.year}년 ${facts.months[i]!.from.month}월`, sentences: n.sentences, section: `month:${i}` })),
        ...(bp.seasons ?? []).map((n, i) => ({ where: seasonTitle(facts.seasons[i]!, facts.months), sentences: n.sentences, section: `season:${i}` })),
        // 10년 흐름 문장의 index는 그해 순번이다(올해·내년을 뺀 새 리포트는 2부터, D-052 3단계)
        ...bp.years.map((n) => ({ where: `${facts.years[n.index]!.year}년`, sentences: n.sentences, section: `year:${n.index}` })),
      ]
    : [];
  // 화면에 나오는 문장만 근거 번호를 매긴다(고르지 않은 주제의 근거는 목록에 없다). 순서는 화면 순서와 같다
  const blocks: LabeledSentences[] = [
    { where: SECTION_TITLES.summary, sentences: args.body.summary, section: 'summary' },
    { where: SECTION_TITLES.traits, sentences: args.body.traits, section: 'traits' },
    ...topics.map((t) => ({ where: topicLabel(t), sentences: args.body.topics[t.id]!, section: `topic:${t.id}` })),
    ...args.body.daewoonNotes.map((n, i) => ({ where: daewoonTitle(n.daewoonIndex), sentences: n.sentences, section: `daewoon:${i}` })),
    { where: thisYear, sentences: args.body.yearly.thisYear, section: 'thisYear' },
    { where: nextYear, sentences: args.body.yearly.nextYear, section: 'nextYear' },
    ...periodBlocks,
  ];
  // 아이 리포트면 사실 카드도 "아이"로 부른다(D-045). 풀이 각도가 있으면 사실 카드에 뜻 전체와 이 문장의 각도를 보여 준다(D-047)
  const numbering = numberEvidence(args.chart, args.evidence, blocks, child, args.body.angles, facts ?? undefined);
  const [summary, traits, ...rest] = numbering.sentences;
  const topicSentences = rest.slice(0, topics.length);
  const daewoonSentences = rest.slice(topics.length, topics.length + args.body.daewoonNotes.length);
  const [thisYearSentences, nextYearSentences, ...periodSentences] = rest.slice(topics.length + args.body.daewoonNotes.length);
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
      // D-052 3단계 버그 수정: 올해·내년 머리 칩도 월·10년 칸과 같은 관계 데이터(rankRelations(luckRelations))로 계산한다
      groups: [
        { subtitle: thisYear, sentences: thisYearSentences!, chips: seunChips(args.chart, 0) },
        { subtitle: nextYear, sentences: nextYearSentences!, chips: seunChips(args.chart, 1) },
      ],
      // D-052: 달·해 흐름은 아래 칸에서 자세히(코드가 붙이는 안내 줄이다. AI 문장이 아니다)
      ...(bp
        ? {
            note: {
              text: child ? '계절마다의 흐름은 아래 계절별 흐름, 앞으로 10년은 10년 흐름에서 볼 수 있어요.' : '달마다의 흐름은 아래 월별 흐름, 앞으로 10년은 10년 흐름에서 볼 수 있어요.',
              links: [
                child ? { href: '#section-seasons', label: SECTION_TITLES.seasons } : { href: '#section-months', label: SECTION_TITLES.months },
                { href: '#section-years', label: SECTION_TITLES.years },
              ],
            },
          }
        : {}),
    },
    ...(bp && facts ? periodSections(args.chart, bp, facts, periodSentences) : []),
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

/** 월별(아이는 계절별)·10년 흐름 섹션(D-052). sentences: 번호를 매긴 문장 묶음(달·묶음 → 해 순서) */
function periodSections(
  chart: SajuChart,
  bp: NonNullable<ReportBody['periods']>,
  facts: ReturnType<typeof buildPeriodEvidence>,
  sentences: readonly SentenceView[][],
): TextSection[] {
  const first = bp.months ?? bp.seasons ?? [];
  const lead = sentences.slice(0, first.length);
  const yearList = sentences.slice(first.length);
  const seasonOfMonth = new Map(facts.seasons.flatMap((g) => g.monthIndices.map((i) => [i, seasonTitle(g, facts.months)] as const)));
  const top: TextSection = bp.months
    ? {
        id: 'months',
        title: SECTION_TITLES.months,
        groups: bp.months.map((_, i) => {
          const m = facts.months[i]!;
          // C안(D-052 3단계): 코드 사실 줄 + AI 1문장
          return { subtitle: monthTitle(m), sentences: lead[i]!, cluster: seasonOfMonth.get(i), chips: relationChips(m.pillar, m.relations), fact: { text: periodFactLine(chart, m.pillar, m.relations) } };
        }),
      }
    : {
        id: 'seasons',
        title: SECTION_TITLES.seasons,
        groups: (bp.seasons ?? []).map((n, i) => {
          const g = facts.seasons[i]!;
          // 칩은 문장이 실제로 다룬(인용한) 달만(D-052 3단계)
          const cited = new Set(n.sentences.flatMap((s) => s.evidenceIds));
          const ms = g.monthIndices.filter((k) => cited.has(`month[${k}]`)).map((k) => facts.months[k]!);
          return {
            subtitle: seasonTitle(g, facts.months),
            sentences: lead[i]!,
            chips: ms.flatMap((m) => relationChips(m.pillar, m.relations.slice(0, 1)).map((c) => ({ ...c, text: `${m.from.month}월 ${c.text}` }))),
          };
        }),
      };
  // 10년 흐름: 해마다 한 줄. AI 문장이 없는 올해·내년은 코드 사실 줄 + 올해·내년 칸 링크(D-052 3단계). 예전 리포트는 10해 모두 문장이 있다
  const noteAt = new Map(bp.years.map((n, k) => [n.index, k] as const));
  const years: TextSection = {
    id: 'years',
    title: SECTION_TITLES.years,
    groups: facts.years.flatMap((y): SectionGroup[] => {
      const k = noteAt.get(y.index);
      const head = { subtitle: yearTitle(y), chips: relationChips(y.pillar, y.relations), flow: { label: yearDaewoonLabel(y), turning: !!y.nextDaewoon } };
      // 어른은 AI 문장 앞에도 사실 줄(C안). 아이 요약은 문장만
      if (k !== undefined) return [{ ...head, sentences: yearList[k]!, ...(bp.months ? { fact: { text: periodFactLine(chart, y.pillar, y.relations) } } : {}) }];
      if (y.index >= REPORT_LAYOUT.yearAiFrom) return [];
      return [{ ...head, sentences: [], fact: { text: periodFactLine(chart, y.pillar, y.relations), link: { href: '#section-yearly', label: `위 ${SECTION_TITLES.yearly} 칸 참고` } } }];
    }),
  };
  return [top, years];
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
