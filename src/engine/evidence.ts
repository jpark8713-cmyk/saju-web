// 풀이 근거 목록. 차트 값만으로 만들며, 풀이 문장은 이 목록의 id만 인용할 수 있다.
import {
  BRANCHES_HANJA, BRANCHES_KO, BRANCH_ELEMENTS, ELEMENTS, ELEMENT_HANJA, ELEMENT_KO, PART_KO,
  POSITION_KO, STEMS_HANJA, STEMS_KO, STEM_ELEMENTS, TEN_GOD_GROUPS, TEN_GOD_KO, branchLabel, pillarHanja,
  pillarKo, pillarLabel, stemLabel, stemYinYang,
} from './constants';
import { daewoonStartLabel } from './daewoon';
import type { ChartRef, Element, Evidence, PillarPosition, Relation, SajuChart } from './types';

const POSITIONS: PillarPosition[] = ['year', 'month', 'day', 'hour'];
const YIN_YANG_KO = { yang: '양(陽)', yin: '음(陰)' } as const;
const RELATION_KO: Record<Relation['kind'], string> = {
  stemCombine: '천간합',
  stemClash: '천간충',
  branchSixCombine: '지지 육합',
  branchClash: '지지 충',
  branchTripleCombine: '지지 삼합',
};

function elementLabel(el: Element): string {
  return `${ELEMENT_KO[el]}(${ELEMENT_HANJA[el]})`;
}

function refLabel(chart: SajuChart, ref: ChartRef): { text: string; terms: string[] } {
  const [pos, part] = ref.split('.') as [PillarPosition, 'stem' | 'branch'];
  const pillar = chart.pillars[pos]!;
  const text = part === 'stem' ? stemLabel(pillar.stem) : branchLabel(pillar.branch);
  const terms = part === 'stem'
    ? [STEMS_KO[pillar.stem]!, STEMS_HANJA[pillar.stem]!]
    : [BRANCHES_KO[pillar.branch]!, BRANCHES_HANJA[pillar.branch]!];
  return { text: `${POSITION_KO[pos]} ${PART_KO[part]} ${text}`, terms };
}

function pillarEvidence(chart: SajuChart): Evidence[] {
  return POSITIONS.flatMap((pos) => {
    const p = chart.pillars[pos];
    if (!p) return [];
    const stem: Evidence = {
      id: `pillar.${pos}.stem`,
      kind: 'pillar',
      content: `${POSITION_KO[pos]} 천간은 ${stemLabel(p.stem)}, 오행 ${elementLabel(STEM_ELEMENTS[p.stem]!)}, ${YIN_YANG_KO[stemYinYang(p.stem)]}`,
      sourceFields: [`pillars.${pos}.stem`],
      chartRefs: [`${pos}.stem`],
      terms: [STEMS_KO[p.stem]!, STEMS_HANJA[p.stem]!, pillarKo(p), pillarHanja(p)],
    };
    const branch: Evidence = {
      id: `pillar.${pos}.branch`,
      kind: 'pillar',
      content: `${POSITION_KO[pos]} 지지는 ${branchLabel(p.branch)}, 오행 ${elementLabel(BRANCH_ELEMENTS[p.branch]!)}`,
      sourceFields: [`pillars.${pos}.branch`],
      chartRefs: [`${pos}.branch`],
      terms: [BRANCHES_KO[p.branch]!, BRANCHES_HANJA[p.branch]!, pillarKo(p), pillarHanja(p)],
    };
    return [stem, branch];
  });
}

function dayMasterEvidence(chart: SajuChart): Evidence {
  const s = chart.pillars.day.stem;
  return {
    id: 'dayMaster',
    kind: 'dayMaster',
    content: `일간(나를 나타내는 글자)은 ${stemLabel(s)}, 오행 ${elementLabel(STEM_ELEMENTS[s]!)}, ${YIN_YANG_KO[stemYinYang(s)]}`,
    sourceFields: ['pillars.day.stem'],
    chartRefs: ['day.stem'],
    terms: [STEMS_KO[s]!, STEMS_HANJA[s]!],
  };
}

function tenGodEvidence(chart: SajuChart): Evidence[] {
  return chart.tenGods.map((t, i) => {
    const ref = `${t.position}.${t.part}` as ChartRef;
    const label = refLabel(chart, ref);
    const name = TEN_GOD_KO[t.tenGod];
    return {
      id: `tenGod.${t.position}.${t.part}`,
      kind: 'tenGod',
      content: `${label.text}은(는) 일간 기준 ${name}`,
      sourceFields: [`tenGods[${i}]`, 'pillars.day.stem'],
      chartRefs: [ref],
      terms: [...label.terms, name],
    };
  });
}

/** 십신 그룹(비겁·식상·재성·관성·인성)별 개수. 0개도 근거가 된다 */
function tenGodGroupEvidence(chart: SajuChart): Evidence[] {
  const dayEl = ELEMENTS.indexOf(STEM_ELEMENTS[chart.pillars.day.stem]!);
  return TEN_GOD_GROUPS.map((g, step): Evidence => {
    const hits = chart.tenGods.filter((t) => (g.members as readonly string[]).includes(t.tenGod));
    const el = ELEMENTS[(dayEl + step) % 5]!;
    // 원국에 실제로 있는 구성 십신만 문구에 적는다. 없는 십신 이름을 보여 주면 모델이 그대로 옮겨 검증에 걸린다
    const present = g.members.filter((m) => hits.some((t) => t.tenGod === m)).map((m) => TEN_GOD_KO[m]);
    const label = present.length ? `${g.ko}(${present.join('·')}, 오행 ${elementLabel(el)})` : `${g.ko}(오행 ${elementLabel(el)})`;
    // 위치와 함께 그 자리의 글자도 적는다 (예: 년주 지지 오(午) 정관). 글자 없이 위치만 있으면 모델이 글자를 써서 검증에 걸렸다(D-018)
    const glyph = (t: (typeof hits)[number]) => {
      const p = chart.pillars[t.position]!;
      return t.part === 'stem' ? stemLabel(p.stem) : branchLabel(p.branch);
    };
    const where = hits.length
      ? `: ${hits.map((t) => `${POSITION_KO[t.position]} ${PART_KO[t.part]} ${glyph(t)} ${TEN_GOD_KO[t.tenGod]}`).join(', ')}`
      : '';
    const glyphTerms = hits.flatMap((t) => {
      const p = chart.pillars[t.position]!;
      return t.part === 'stem' ? [STEMS_KO[p.stem]!, STEMS_HANJA[p.stem]!] : [BRANCHES_KO[p.branch]!, BRANCHES_HANJA[p.branch]!];
    });
    return {
      id: `tenGodGroup.${g.id}`,
      kind: 'tenGodGroup',
      content: `${label}은(는) 일간을 뺀 원국 글자 중 ${hits.length}개${where}`,
      sourceFields: ['tenGods', 'pillars.day.stem'],
      // 0개면 그 오행 칸을, 있으면 해당 글자를 가리킨다
      chartRefs: hits.length ? hits.map((t) => `${t.position}.${t.part}` as ChartRef) : [`elements.${el}`],
      // 그룹 이름 + 실제로 있는 십신 이름 + 그 자리의 글자. 0개면 그룹 이름만("재성이 없다"는 되고 "정재가 있다"는 안 된다)
      terms: [g.ko, ...new Set(hits.map((t) => TEN_GOD_KO[t.tenGod])), ...new Set(glyphTerms)],
    };
  });
}

function elementEvidence(chart: SajuChart): Evidence[] {
  const { counts, total } = chart.elements;
  const perElement = ELEMENTS.map((el): Evidence => ({
    id: `elements.${el}`,
    kind: 'elementBalance',
    content: `${elementLabel(el)}은(는) 원국 ${total}글자 중 ${counts[el]}개`,
    sourceFields: [`elements.counts.${el}`, 'elements.total'],
    chartRefs: [`elements.${el}`],
    terms: [],
  }));
  const max = Math.max(...ELEMENTS.map((el) => counts[el]));
  const most = ELEMENTS.filter((el) => counts[el] === max);
  const missing = ELEMENTS.filter((el) => counts[el] === 0);
  const missingText = missing.length ? `, 없는 오행은 ${missing.map(elementLabel).join('·')}` : ', 다섯 오행이 모두 있음';
  const summary: Evidence = {
    id: 'elements.summary',
    kind: 'elementBalance',
    content: `가장 많은 오행은 ${most.map(elementLabel).join('·')}(${max}개)${missingText}`,
    sourceFields: ['elements.counts'],
    chartRefs: [...new Set([...most, ...missing])].map((el) => `elements.${el}` as ChartRef),
    terms: [],
  };
  return [...perElement, summary];
}

function relationEvidence(chart: SajuChart): Evidence[] {
  return chart.relations.map((r, i) => {
    const labels = r.refs.map((ref) => refLabel(chart, ref));
    const result = r.resultElement ? `(${elementLabel(r.resultElement)})` : '';
    return {
      id: `relation.${r.kind}.${r.refs.join('+')}`,
      kind: 'relation',
      content: `${labels.map((l) => l.text).join(', ')}이(가) ${RELATION_KO[r.kind]}${result} 관계`,
      sourceFields: [`relations[${i}]`],
      chartRefs: [...r.refs],
      terms: labels.flatMap((l) => l.terms),
    };
  });
}

function daewoonEvidence(chart: SajuChart): Evidence[] {
  const s = chart.daewoonStart;
  const direction: Evidence = {
    id: 'daewoon.direction',
    kind: 'daewoonDirection',
    // 시작 시점은 표준 표기(K세(YYYY년 M월)) 하나만 둔다. 다른 표기(출생 후 n년 n개월 등)를 함께 보이면 문장마다 표기가 갈린다(D-022)
    content: chart.daewoon.length
      ? `대운은 ${s.forward ? '순행' : '역행'}하며 첫 대운은 ${daewoonStartLabel(chart.daewoon[0]!)}부터 시작됨(${s.forward ? '다음' : '이전'} 절입 ${s.jieName} 기준, 나이는 세는 나이)`
      : `대운은 ${s.forward ? '순행' : '역행'}함`,
    sourceFields: ['daewoonStart'],
    chartRefs: chart.daewoon.length ? ['daewoon[0]'] : [],
    terms: [],
  };
  const entries = chart.daewoon.map((d): Evidence => ({
    id: `daewoon[${d.index}]`,
    kind: 'daewoon',
    content: `${d.index + 1}번째 대운 ${pillarLabel(d.pillar)}: ${daewoonStartLabel(d)}부터 10년(나이는 세는 나이)`,
    sourceFields: [`daewoon[${d.index}]`],
    chartRefs: [`daewoon[${d.index}]`],
    terms: [pillarKo(d.pillar), pillarHanja(d.pillar), STEMS_KO[d.pillar.stem]!, BRANCHES_KO[d.pillar.branch]!],
  }));
  return [direction, ...entries];
}

function seunEvidence(chart: SajuChart): Evidence[] {
  return chart.seun.map((y, i): Evidence => ({
    id: `seun[${i}]`,
    kind: 'seun',
    content: `${y.year}년 세운은 ${pillarLabel(y.pillar)}`,
    sourceFields: [`seun[${i}]`],
    chartRefs: [`seun[${i}]`],
    terms: [pillarKo(y.pillar), pillarHanja(y.pillar), STEMS_KO[y.pillar.stem]!, BRANCHES_KO[y.pillar.branch]!],
  }));
}

export function buildEvidence(chart: SajuChart): Evidence[] {
  return [
    dayMasterEvidence(chart),
    ...pillarEvidence(chart),
    ...tenGodEvidence(chart),
    ...tenGodGroupEvidence(chart),
    ...elementEvidence(chart),
    ...relationEvidence(chart),
    ...daewoonEvidence(chart),
    ...seunEvidence(chart),
  ];
}

/** chartRef가 차트의 실제 위치를 가리키는지 */
export function isValidChartRef(chart: SajuChart, ref: string): boolean {
  const pillarRef = /^(year|month|day|hour)\.(stem|branch)$/.exec(ref);
  if (pillarRef) return chart.pillars[pillarRef[1] as PillarPosition] !== null;
  const listRef = /^(daewoon|seun)\[(\d+)\]$/.exec(ref);
  if (listRef) return Number(listRef[2]) < chart[listRef[1] as 'daewoon' | 'seun'].length;
  const elRef = /^elements\.(wood|fire|earth|metal|water)$/.exec(ref);
  return elRef !== null;
}
