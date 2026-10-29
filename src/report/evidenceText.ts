// 풀이 근거를 "이 사람에 대한 사실" 목록으로 바꾼다(화면·PDF 공통, D-041·D-042). 차트 값과 정해진 문구만 쓴다(AI를 쓰지 않는다).
// AI에게 넘기는 근거 문구(Evidence.content)·근거 id·검증 규칙은 바꾸지 않는다. 보여 주는 문구만 바꾼다.
// - 같은 사실은 한 항목으로 합친다: 일간 + 일주 천간 → "나", 오행 근거 전부 → 오행 한 줄,
//   글자·십신 근거와 십신 묶음 → 그 십신 묶음(표현·재능 등) 한 줄.
// - 기본 문구는 쉬운 말만 쓴다(나를 나타내는 글자, 내 사주 8글자, 윗글자·아랫글자, 태어난 해·달·날·시).
//   용어 풀이와 전문 표기는 detail("자세히")에만 둔다.
// 서버에서만 쓴다(대운 표기 때문에 절기 계산 모듈을 가져온다). 화면 번들에는 evidenceTerms.ts만 들어간다.
import {
  BRANCH_ELEMENTS, ELEMENTS, ELEMENT_HANJA, ELEMENT_KO, ELEMENT_PLAIN, PART_PLAIN, POSITION_PLAIN, STEM_ELEMENTS,
  TEN_GOD_GROUPS, TEN_GOD_KO, branchLabel, pillarLabel, stemLabel,
} from '../engine/constants';
import { daewoonStartLabel } from '../engine/daewoon';
import { yearDaewoonLabel } from '../engine/evidence';
import type { MonthPeriod, YearPeriod } from '../engine/periods';
import { luckRelations } from '../engine/relations';

/** 월별·10년 흐름 사실(D-052) */
type PeriodFactsInput = { months: readonly MonthPeriod[]; years: readonly YearPeriod[] };
import { tenGodOfBranch, tenGodOfStem } from '../engine/tenGods';
import type { ChartRef, Evidence, Pillar, PillarPosition, Relation, SajuChart, TenGod } from '../engine/types';
import type { ReportAngles } from './angleTable';
import { EVIDENCE_GROUP_ORDER, hasBatchim, josa, type EvidenceGroupId, type EvidenceItem, type EvidenceUse } from './evidenceTerms';

export type { EvidenceItem } from './evidenceTerms';

type Part = 'stem' | 'branch';

const SHORT_PLACE: Record<PillarPosition, string> = { year: '해', month: '달', day: '날', hour: '시' };
/** 사실 문장에서 이 사주의 주인을 부르는 말. 아이 리포트는 부모가 읽으므로 "아이"로 부른다(D-045) */
interface Voice {
  /** 나를 나타내는 글자 */
  me: string;
  /** 내 사주 */
  mine: string;
  /** 나에게는 */
  toMe: string;
  /** 십신 묶음(TEN_GOD_GROUPS 순서)이 나와 어떤 사이인지 */
  relation: readonly string[];
  /** 일간 용어 풀이의 "나" */
  meTerm: string;
}
const ADULT_VOICE: Voice = {
  me: '나를 나타내는 글자', mine: '내 사주', toMe: '나에게는',
  relation: ['나와 같은', '내가 키워 내는', '내가 다스리는', '나를 다스리는', '나를 도와주는'], meTerm: '"나"',
};
const CHILD_VOICE: Voice = {
  me: '아이를 나타내는 글자', mine: '아이의 사주', toMe: '아이에게는',
  relation: ['아이와 같은', '아이가 키워 내는', '아이가 다스리는', '아이를 다스리는', '아이를 도와주는'], meTerm: '이 사주의 주인(아이)',
};
/** 일간별 모습 (총평 템플릿과 같은 비유) */
const STEM_IMAGE = ['큰 나무', '풀과 덩굴', '한낮의 해', '등불', '큰 산', '기름진 밭', '단단한 원석', '다듬어진 보석', '큰 강물', '이슬과 빗물'];

const RELATION_TEXT: Record<Relation['kind'], { name: string; plain: string }> = {
  stemCombine: { name: '천간합', plain: '서로 끌려 묶이는 관계' },
  stemClash: { name: '천간충', plain: '서로 부딪치는 관계' },
  branchSixCombine: { name: '지지 육합', plain: '짝을 이뤄 묶이는 관계' },
  branchClash: { name: '지지 충', plain: '정면으로 부딪치는 관계' },
  branchTripleCombine: { name: '지지 삼합', plain: '모여 한 기운의 힘을 키우는 관계' },
};

const groupIndexOf = (tg: TenGod) => TEN_GOD_GROUPS.findIndex((g) => (g.members as readonly string[]).includes(tg));

function glyphLabel(chart: SajuChart, pos: PillarPosition, part: Part): string {
  const p = chart.pillars[pos]!;
  return part === 'stem' ? stemLabel(p.stem) : branchLabel(p.branch);
}

/** "태어난 해의 윗글자 을(乙)" */
function placeGlyph(chart: SajuChart, ref: ChartRef): string {
  const [pos, part] = ref.split('.') as [PillarPosition, Part];
  return `${POSITION_PLAIN[pos]}의 ${PART_PLAIN[part]} ${glyphLabel(chart, pos, part)}`;
}

// ---- 사실 키 ----

interface Slot {
  key: string;
  group: EvidenceGroupId;
  order: number;
}

/** 같은 사실로 합칠 근거끼리 같은 키를 준다. 묶음과 묶음 안의 순서도 함께 준다 */
function slotOf(chart: SajuChart, id: string): Slot {
  if (id === 'dayMaster' || id === 'pillar.day.stem') return { key: 'me', group: 'natal', order: 0 };
  if (id.startsWith('elements.')) return { key: 'elements', group: 'natal', order: 1 };
  if (id.startsWith('tenGodGroup.')) {
    const i = TEN_GOD_GROUPS.findIndex((g) => `tenGodGroup.${g.id}` === id);
    return { key: `group.${TEN_GOD_GROUPS[i]?.id ?? id}`, group: 'natal', order: 2 + i };
  }
  const glyph = /^(?:pillar|tenGod)\.(year|month|day|hour)\.(stem|branch)$/.exec(id);
  if (glyph) {
    const tg = chart.tenGods.find((t) => t.position === glyph[1] && t.part === glyph[2])?.tenGod;
    if (tg) {
      const i = groupIndexOf(tg);
      return { key: `group.${TEN_GOD_GROUPS[i]!.id}`, group: 'natal', order: 2 + i };
    }
    return { key: `glyph.${glyph[1]}.${glyph[2]}`, group: 'natal', order: 20 };
  }
  if (id.startsWith('relation.')) return { key: id, group: 'natal', order: 10 };
  if (id === 'daewoon.direction') return { key: id, group: 'luck', order: 0 };
  const dw = /^daewoon\[(\d+)\]$/.exec(id);
  if (dw) return { key: id, group: 'luck', order: 1 + Number(dw[1]) };
  const se = /^seun\[(\d+)\]$/.exec(id);
  if (se) return { key: id, group: 'luck', order: 1000 + Number(se[1]) };
  // D-052: 월별·10년 흐름의 그달·그해 근거는 따로 묶는다(달 먼저, 해 다음)
  const mo = /^month\[(\d+)\]$/.exec(id);
  if (mo) return { key: id, group: 'period', order: Number(mo[1]) };
  const yr = /^year\[(\d+)\]$/.exec(id);
  if (yr) return { key: id, group: 'period', order: 100 + Number(yr[1]) };
  return { key: id, group: 'luck', order: 2000 };
}

// ---- 쉬운 사실 문장 ----

function meText(chart: SajuChart, v: Voice): string {
  const s = chart.pillars.day.stem;
  return `${v.me}는 태어난 날의 윗글자 ${josa(stemLabel(s), '이에요/예요')}. ${STEM_IMAGE[s]} 같은 ${ELEMENT_PLAIN[STEM_ELEMENTS[s]!]}의 기운이에요.`;
}

function elementsText(chart: SajuChart, v: Voice): string {
  const { counts, total } = chart.elements;
  const sorted = [...ELEMENTS].sort((a, b) => counts[b] - counts[a]);
  const max = counts[sorted[0]!];
  const most = sorted.filter((el) => counts[el] === max).map((el) => ELEMENT_PLAIN[el]).join('·');
  const missing = sorted.filter((el) => counts[el] === 0).map((el) => ELEMENT_PLAIN[el]).join('·');
  const list = sorted.map((el) => `${ELEMENT_PLAIN[el]} ${counts[el]}개`).join(' · ');
  const tail = missing ? `${josa(missing, '은/는')} 없어요` : '다섯 기운이 모두 있어요';
  return `${v.mine} ${total}글자의 기운은 ${list}예요. ${josa(most, '이/가')} 가장 많고 ${tail}.`;
}

function groupText(chart: SajuChart, i: number, v: Voice): string {
  const g = TEN_GOD_GROUPS[i]!;
  const hits = chart.tenGods.filter((t) => groupIndexOf(t.tenGod) === i);
  // 센 기준은 나를 나타내는 글자를 뺀 글자 수다(근거 문구와 같은 수, D-043)
  const counted = `${v.me}를 뺀 ${chart.elements.total - 1}글자 중`;
  if (!hits.length) return `${v.relation[i]} ${g.plain}의 글자는 ${counted}에 없어요.`;
  const glyphs = hits.map((t) => glyphLabel(chart, t.position, t.part));
  const parts = new Set(hits.map((t) => t.part));
  let subject: string;
  if (parts.size === 1) {
    const places = [...new Set(hits.map((t) => SHORT_PLACE[t.position]))].join('·');
    const where = `태어난 ${places}의 ${PART_PLAIN[hits[0]!.part]}`;
    subject = hits.length === 1 ? `${where} ${glyphs[0]}` : `${where} ${glyphs.join('·')} ${hits.length}개`;
  } else {
    subject = `${hits.map((t) => placeGlyph(chart, `${t.position}.${t.part}` as ChartRef)).join(', ')} ${hits.length}개`;
  }
  // 묶음의 글자는 모두 같은 기운이다(일간에서 같은 칸만큼 떨어진 오행). 글자 하나를 말한 문장도 이 줄로 뒷받침된다
  const el = ELEMENTS[(ELEMENTS.indexOf(STEM_ELEMENTS[chart.pillars.day.stem]!) + i) % 5]!;
  const all = hits.length > 1 ? '모두 ' : '';
  return `${counted} ${josa(subject, '이/가')} ${josa(g.plain, '을/를')} 뜻하는 글자예요. ${all}${v.relation[i]} ${ELEMENT_PLAIN[el]}의 기운이에요.`;
}

function glyphText(chart: SajuChart, pos: PillarPosition, part: Part): string {
  const p = chart.pillars[pos]!;
  const el = part === 'stem' ? STEM_ELEMENTS[p.stem]! : BRANCH_ELEMENTS[p.branch]!;
  return `${POSITION_PLAIN[pos]}의 ${PART_PLAIN[part]} ${josa(glyphLabel(chart, pos, part), '은/는')} ${ELEMENT_PLAIN[el]}의 기운이에요.`;
}

function relationText(chart: SajuChart, r: Relation): string {
  const names = r.refs.map((ref) => placeGlyph(chart, ref));
  const subject = names.length === 2 ? `${josa(names[0]!, '와/과')} ${names[1]}` : names.join(', ');
  const result = r.resultElement ? ` 함께 묶이면 ${ELEMENT_PLAIN[r.resultElement]}의 기운이 커져요.` : '';
  return `${josa(subject, '이/가')} ${RELATION_TEXT[r.kind].plain}예요.${result}`;
}

/** 대운·세운 간지의 윗글자·아랫글자가 무슨 기운이고 나에게 어떤 뜻인지 (기운이 같으면 뜻도 같다) */
function luckGlyphText(chart: SajuChart, pillar: Pillar, v: Voice): string {
  const day = chart.pillars.day.stem;
  const gs = TEN_GOD_GROUPS[groupIndexOf(tenGodOfStem(day, pillar.stem))]!.plain;
  const gb = TEN_GOD_GROUPS[groupIndexOf(tenGodOfBranch(day, pillar.branch))]!.plain;
  const es = ELEMENT_PLAIN[STEM_ELEMENTS[pillar.stem]!];
  const eb = ELEMENT_PLAIN[BRANCH_ELEMENTS[pillar.branch]!];
  const s = stemLabel(pillar.stem);
  const b = branchLabel(pillar.branch);
  return es === eb
    ? `윗글자 ${josa(s, '와/과')} 아랫글자 ${b} 모두 ${es}의 기운이고, ${v.toMe} ${josa(gs, '을/를')} 뜻해요.`
    : `윗글자 ${josa(s, '은/는')} ${es}의 기운으로 ${gs}, 아랫글자 ${josa(b, '은/는')} ${eb}의 기운으로 ${josa(gb, '을/를')} 뜻해요.`;
}

function luckTenGods(chart: SajuChart, pillar: Pillar): string {
  const day = chart.pillars.day.stem;
  return `${stemLabel(pillar.stem)} ${TEN_GOD_KO[tenGodOfStem(day, pillar.stem)]} · ${branchLabel(pillar.branch)} ${TEN_GOD_KO[tenGodOfBranch(day, pillar.branch)]}`;
}

function luckText(chart: SajuChart, key: string, v: Voice): string {
  if (key === 'daewoon.direction') {
    const first = chart.daewoon[0];
    return first ? `큰 흐름은 10년마다 바뀌어요. 첫 큰 흐름은 ${daewoonStartLabel(first, chart.solarDate)}부터 시작돼요.` : '큰 흐름은 10년마다 바뀌어요.';
  }
  const dw = /^daewoon\[(\d+)\]$/.exec(key);
  if (dw) {
    const d = chart.daewoon[Number(dw[1])];
    return d ? `${daewoonStartLabel(d, chart.solarDate)}부터 10년은 ${pillarLabel(d.pillar)}의 큰 흐름이에요. ${luckGlyphText(chart, d.pillar, v)}` : '';
  }
  const se = /^seun\[(\d+)\]$/.exec(key);
  const y = se ? chart.seun[Number(se[1])] : undefined;
  return y ? `${y.year}년은 ${pillarLabel(y.pillar)}년이에요. ${luckGlyphText(chart, y.pillar, v)}${luckRelationText(chart, y.pillar, v)}` : '';
}

/** 그해 글자와 원국 글자의 관계(D-048). 세운 근거 문구와 같은 계산(luckRelations)이다 */
function luckRelationText(chart: SajuChart, pillar: Pillar, v: Voice, unit = '그해'): string {
  const rels = luckRelations(chart.pillars, pillar);
  if (!rels.length) return ` ${v.mine} 글자와 같은 글자·묶이는 관계·부딪치는 관계는 없어요.`;
  return rels
    .map((r) => {
      const own = r.luckPart === 'stem' ? `${unit} 윗글자 ${stemLabel(pillar.stem)}` : `${unit} 아랫글자 ${branchLabel(pillar.branch)}`;
      const what = r.kind === 'same' ? '같은 글자예요' : `${RELATION_TEXT[r.kind].plain}예요`;
      return ` ${josa(own, '은/는')} ${josa(placeGlyph(chart, r.ref), '와/과')} ${what}.`;
    })
    .join('');
}

/** 그달·그해 사실(D-052). periods: 리포트의 월별·10년 흐름 사실(생성 때와 같은 계산) */
function periodText(chart: SajuChart, key: string, v: Voice, periods?: PeriodFactsInput): string | null {
  const mo = /^month\[(\d+)\]$/.exec(key);
  const m = mo ? periods?.months[Number(mo[1])] : undefined;
  if (m) {
    const name = `${m.from.year}년 ${m.from.month}월(${m.term} ${m.from.month}/${m.from.day}~${m.to.month}/${m.to.day})`;
    return `${name}은 ${pillarLabel(m.pillar)}의 달이에요. ${luckGlyphText(chart, m.pillar, v)}${luckRelationText(chart, m.pillar, v, '그달')}`;
  }
  const yr = /^year\[(\d+)\]$/.exec(key);
  const y = yr ? periods?.years[Number(yr[1])] : undefined;
  if (y) {
    return `${y.year}년은 ${pillarLabel(y.pillar)}의 해예요. ${luckGlyphText(chart, y.pillar, v)}${luckRelationText(chart, y.pillar, v)} 큰 흐름은 ${yearDaewoonLabel(y)}이고, 그해 생일이 지나면 만 ${y.ageAfterBirthday}세예요.`;
  }
  return null;
}

function plainTextOf(chart: SajuChart, key: string, v: Voice, periods?: PeriodFactsInput): string {
  const period = periodText(chart, key, v, periods);
  if (period !== null) return period;
  if (key === 'me') return meText(chart, v);
  if (key === 'elements') return elementsText(chart, v);
  if (key.startsWith('group.')) return groupText(chart, TEN_GOD_GROUPS.findIndex((g) => `group.${g.id}` === key), v);
  const glyph = /^glyph\.(year|month|day|hour)\.(stem|branch)$/.exec(key);
  if (glyph) return glyphText(chart, glyph[1] as PillarPosition, glyph[2] as Part);
  if (key.startsWith('relation.')) {
    const r = chart.relations.find((x) => `relation.${x.kind}.${x.refs.join('+')}` === key);
    return r ? relationText(chart, r) : '';
  }
  return luckText(chart, key, v);
}

// ---- 자세히(용어 풀이 + 전문 표기) ----

/** 괄호(겹친 괄호 포함)를 모두 지운다: "비겁(겁재, 오행 수(水))" → "비겁" */
function stripParens(text: string): string {
  let s = text;
  for (let prev = ''; prev !== s; ) {
    prev = s;
    s = s.replace(/\([^()]*\)/g, '');
  }
  return s;
}

/** 근거 문구의 "은(는)"·"이(가)"를 앞말의 받침에 맞춘다 (앞말 뒤의 괄호는 건너뛴다) */
function fixJosa(text: string): string {
  return text.replace(/은\(는\)|이\(가\)/gu, (j: string, offset: number) => {
    const batchim = hasBatchim(stripParens(text.slice(0, offset)));
    if (j === '은(는)') return batchim ? '은' : '는';
    return batchim ? '이' : '가';
  });
}

const elementName = (el: (typeof ELEMENTS)[number]) => `${ELEMENT_PLAIN[el]}(${ELEMENT_KO[el]}·${ELEMENT_HANJA[el]})`;
const GLYPH_TERMS = '천간·지지: 네 기둥(년주·월주·일주·시주)의 윗글자·아랫글자예요.';

/** 사실마다 먼저 보여 줄 용어 풀이와, 늘 함께 보여 줄 근거 id */
function definitionOf(chart: SajuChart, key: string, v: Voice = ADULT_VOICE): { terms: string[]; baseIds: string[]; extra: string[] } {
  if (key === 'me') return { terms: [`일간: 태어난 날의 윗글자예요. 사주에서 ${v.meTerm}를 나타내요.`], baseIds: ['dayMaster'], extra: [] };
  if (key === 'elements') {
    return { terms: [`오행: ${ELEMENTS.map(elementName).join('·')} 다섯 기운이에요. 원국은 ${v.mine} ${chart.elements.total}글자예요.`], baseIds: ['elements.summary'], extra: [] };
  }
  if (key.startsWith('group.')) {
    const i = TEN_GOD_GROUPS.findIndex((g) => `group.${g.id}` === key);
    const g = TEN_GOD_GROUPS[i]!;
    const members = g.members.map((m) => TEN_GOD_KO[m]).join('·');
    return { terms: [`${g.ko}(${members}): ${v.relation[i]} 기운의 글자를 함께 부르는 이름이에요.`, GLYPH_TERMS], baseIds: [`tenGodGroup.${g.id}`], extra: [] };
  }
  if (key.startsWith('glyph.')) return { terms: [GLYPH_TERMS], baseIds: [], extra: [] };
  if (key.startsWith('relation.')) {
    const r = chart.relations.find((x) => `relation.${x.kind}.${x.refs.join('+')}` === key);
    return { terms: r ? [`${RELATION_TEXT[r.kind].name}: ${RELATION_TEXT[r.kind].plain}를 부르는 이름이에요.`] : [], baseIds: [], extra: [] };
  }
  if (key === 'daewoon.direction') return { terms: ['대운: 10년마다 바뀌는 큰 흐름이에요. 순행·역행은 대운이 이어지는 방향이에요.'], baseIds: [], extra: [] };
  const dw = /^daewoon\[(\d+)\]$/.exec(key);
  if (dw) {
    const d = chart.daewoon[Number(dw[1])];
    return { terms: ['대운: 10년마다 바뀌는 큰 흐름이에요.'], baseIds: [], extra: d ? [luckTenGods(chart, d.pillar)] : [] };
  }
  const se = /^seun\[(\d+)\]$/.exec(key);
  const y = se ? chart.seun[Number(se[1])] : undefined;
  if (se) return { terms: ['세운: 그해의 간지가 가져오는 한 해의 흐름이에요.'], baseIds: [], extra: y ? [luckTenGods(chart, y.pillar)] : [] };
  if (/^month\[\d+\]$/.test(key)) return { terms: ['월운: 절기(절입 시각)로 나눈 달의 간지예요. 절입일부터 다음 절입 전날까지를 한 달로 봐요.'], baseIds: [], extra: [] };
  if (/^year\[\d+\]$/.test(key)) return { terms: ['연운(세운): 그해의 간지예요. 입춘부터 그해로 봐요.', '대운: 10년마다 바뀌는 큰 흐름이에요.'], baseIds: [], extra: [] };
  return { terms: [], baseIds: [], extra: [] };
}

function detailOf(chart: SajuChart, key: string, cited: readonly string[], byId: ReadonlyMap<string, Evidence>, v: Voice): string[] {
  const def = definitionOf(chart, key, v);
  const technical = [...new Set([...def.baseIds, ...cited])].flatMap((id) => {
    const e = byId.get(id);
    return e ? [fixJosa(e.content)] : [];
  });
  return [...def.terms, ...technical, ...def.extra];
}

function chartRefsOf(chart: SajuChart, key: string, cited: readonly string[], byId: ReadonlyMap<string, Evidence>): ChartRef[] {
  const def = definitionOf(chart, key);
  const refs = [...new Set([...def.baseIds, ...cited])].flatMap((id) => byId.get(id)?.chartRefs ?? []);
  if (key === 'elements') {
    // 가장 많은 기운의 글자도 차트에서 강조한다
    const { counts } = chart.elements;
    const max = Math.max(...ELEMENTS.map((el) => counts[el]));
    const glyphs = (['year', 'month', 'day', 'hour'] as const).flatMap((pos) => {
      const p = chart.pillars[pos];
      if (!p) return [];
      return [
        ...(counts[STEM_ELEMENTS[p.stem]!] === max ? [`${pos}.stem` as ChartRef] : []),
        ...(counts[BRANCH_ELEMENTS[p.branch]!] === max ? [`${pos}.branch` as ChartRef] : []),
      ];
    });
    return [...new Set([...refs, ...glyphs])];
  }
  return [...new Set(refs)];
}

// ---- 풀이 각도(D-047) ----

/** 근거 id가 가리키는 각도 슬롯: 개별 오행 근거 → 그 기운, 십신·묶음 근거 → 그 묶음, 합·충 근거 → 묶임·부딪침(D-048). 그 밖에는 없음 */
function angleSlotOf(chart: SajuChart, id: string): string | null {
  const el = /^elements\.(wood|fire|earth|metal|water)$/u.exec(id);
  if (el) return el[1]!;
  const rel = /^relation\.(\w+)\./u.exec(id);
  if (rel) return /Clash$/u.test(rel[1]!) ? 'clash' : 'combine';
  const key = slotOf(chart, id).key;
  return key.startsWith('group.') ? key.slice('group.'.length) : null;
}

const RELATION_SLOT_LABEL: Record<string, string> = { combine: '묶이는 관계', clash: '부딪치는 관계' };

function angleSlotLabel(slot: string): string {
  const el = ELEMENTS.find((e) => e === slot);
  return el ? ELEMENT_PLAIN[el] : (TEN_GOD_GROUPS.find((g) => g.id === slot)?.plain ?? RELATION_SLOT_LABEL[slot] ?? slot);
}

/** 사실 하나의 "뜻 전체" 줄: 그 사실을 이루는 근거가 가리키는 기운·묶음마다 하나 */
function meaningsOf(chart: SajuChart, ids: readonly string[], options: ReportAngles['options']): string[] {
  const slots = [...new Set(ids.flatMap((id) => angleSlotOf(chart, id) ?? []))].filter((s) => options[s]?.length);
  return slots.map((s) => `${angleSlotLabel(s)}의 뜻: ${options[s]!.join(' / ')}`);
}

/**
 * 문장 하나의 사실 번호별 "이 문장은 ○○ 쪽으로 풀었어요." (화면 카드용). sectionAngles: 그 문장이 있는 칸의 슬롯별 각도.
 * 각도는 생성 때 이 칸에 정해 준 방향이다.
 */
export function angleNotesOf(
  chart: SajuChart,
  evidenceIds: readonly string[],
  numberOf: ReadonlyMap<string, number>,
  sectionAngles: Record<string, string> | null,
): Record<number, string> | null {
  if (!sectionAngles) return null;
  const byFact = new Map<number, string[]>();
  for (const id of evidenceIds) {
    const n = numberOf.get(id);
    const slot = angleSlotOf(chart, id);
    if (n === undefined || !slot || !sectionAngles[slot]) continue;
    const list = byFact.get(n) ?? [];
    const part = `${angleSlotLabel(slot)} "${sectionAngles[slot]}"`;
    if (!list.includes(part)) byFact.set(n, [...list, part]);
  }
  if (!byFact.size) return null;
  return Object.fromEntries([...byFact].map(([n, parts]) => [n, `이 문장은 ${parts.join(', ')} 쪽으로 풀었어요.`]));
}

/** 근거를 인용한 문장 하나 (화면에 나온 순서) */
export interface CitingSentence extends EvidenceUse {
  evidenceIds: readonly string[];
}

/**
 * 문장이 인용한 근거로 사실 목록을 만든다. 같은 사실은 한 항목, 번호는 묶음 순서대로 1부터.
 * numberOf: 근거 id → 사실 번호 (합친 근거는 같은 번호)
 */
export function buildEvidenceItems(
  chart: SajuChart,
  byId: ReadonlyMap<string, Evidence>,
  sentences: readonly CitingSentence[],
  /**
   * 아이 리포트(D-045): 사실 문장에서 "나" 대신 "아이"로 부른다. angles: 풀이 각도(D-047, 있으면 뜻 전체를 보여 준다).
   * periods: 월별·10년 흐름 사실(D-052, 있으면 month[i]·year[i]를 쉬운 문장으로)
   */
  opts: { child?: boolean; angles?: ReportAngles; periods?: PeriodFactsInput } = {},
): { items: EvidenceItem[]; numberOf: Map<string, number> } {
  const voice = opts.child ? CHILD_VOICE : ADULT_VOICE;
  const slots = new Map<string, Slot & { firstSeen: number; ids: string[] }>();
  sentences.flatMap((s) => s.evidenceIds).forEach((id, i) => {
    if (!byId.has(id)) return;
    const s = slotOf(chart, id);
    const cur = slots.get(s.key);
    if (!cur) slots.set(s.key, { ...s, firstSeen: i, ids: [id] });
    else if (!cur.ids.includes(id)) slots.set(s.key, { ...cur, ids: [...cur.ids, id] });
  });
  const sorted = [...slots.values()].sort(
    (a, b) => EVIDENCE_GROUP_ORDER.indexOf(a.group) - EVIDENCE_GROUP_ORDER.indexOf(b.group) || a.order - b.order || a.firstSeen - b.firstSeen,
  );
  const numberOf = new Map<string, number>();
  const items = sorted.map((s, i): EvidenceItem => {
    const n = i + 1;
    for (const id of s.ids) numberOf.set(id, n);
    const usedBy = sentences
      .filter((x) => x.evidenceIds.some((id) => s.ids.includes(id)))
      .map(({ sentenceId, where, text }) => ({ sentenceId, where, text }));
    return {
      n,
      id: s.key,
      ids: s.ids,
      group: s.group,
      content: plainTextOf(chart, s.key, voice, opts.periods) || byId.get(s.ids[0]!)!.content,
      detail: detailOf(chart, s.key, s.ids, byId, voice),
      chartRefs: chartRefsOf(chart, s.key, s.ids, byId),
      usedBy,
      ...(opts.angles ? (() => {
        const meanings = meaningsOf(chart, s.ids, opts.angles!.options);
        return meanings.length ? { meanings } : {};
      })() : {}),
    };
  });
  return { items, numberOf };
}
