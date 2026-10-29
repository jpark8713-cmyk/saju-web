// 풀이 근거를 "이 사람에 대한 사실" 목록으로 (D-041, D-042): 조사 처리, 같은 사실 합치기, 쉬운 말, 묶음 순서 번호, 쓴 문장 연결
import { describe, expect, it } from 'vitest';
import { buildEvidence } from '../../src/engine/evidence';
import { EVIDENCE_GROUP_ORDER, hasBatchim, josa } from '../../src/report/evidenceTerms';
import { buildEvidenceItems, type CitingSentence } from '../../src/report/evidenceText';
import { buildReportView } from '../../src/report/view';
import { validateBirthFormOnServer } from '../../src/web/birthServer';
import { chartOf, solar } from '../engine/helpers';

const LEFTOVER_JOSA = /[은이을와]\((는|가|를|과)\)/u;
/** 기본 문구에 나오면 안 되는 전문 용어 (자세히에만 둔다) */
const JARGON = /일간|원국|천간|지지|[년월일시]주|오행|음양|비견|겁재|식신|상관|편재|정재|편관|정관|편인|정인|비겁|식상|재성|관성|인성|대운|세운|순행|역행|[목화토금수]\(/u;

/** 계산 오류 사례(가상 데이터): 음력 1967-07-01 08시(분 모름), 경남 남해군, 남 → 일간 임수(壬水) */
function reportedChart() {
  const r = validateBirthFormOnServer({ name: '', calendar: 'lunar', isLeapMonth: false, year: 1967, month: 7, day: 1, timeUnknown: false, hour: 8, minuteUnknown: true, gender: 'male', regionId: 'gyeongnam:남해군', consent: true });
  if (!r.ok) throw new Error('입력 오류');
  return chartOf(r.value.input);
}

const cite = (id: string, ids: string[], where = '총평'): CitingSentence => ({ sentenceId: id, where, text: `${id} 문장`, evidenceIds: ids });

function allItems(chart: ReturnType<typeof chartOf>) {
  const evidence = buildEvidence(chart);
  return { evidence, ...buildEvidenceItems(chart, new Map(evidence.map((e) => [e.id, e])), [cite('s0', evidence.map((e) => e.id))]) };
}

describe('조사', () => {
  it.each([
    ['을(乙)', '은/는', '을(乙)은'],
    ['사(巳)', '은/는', '사(巳)는'],
    ['임(壬)', '이에요/예요', '임(壬)이에요'],
    ['갑(甲) 2개', '이/가', '갑(甲) 2개가'],
    ['태어난 해의 아랫글자 사(巳)', '와/과', '태어난 해의 아랫글자 사(巳)와'],
    ['태어난 날의 아랫글자 진(辰)', '와/과', '태어난 날의 아랫글자 진(辰)과'],
    ['표현·재능', '을/를', '표현·재능을'],
  ] as const)('%s + %s → %s', (word, kind, expected) => {
    expect(josa(word, kind)).toBe(expected);
  });

  it('한글이 없으면 받침 없음으로 본다', () => {
    expect(hasBatchim('(乙)')).toBe(false);
  });
});

describe('계산 오류 사례(가상 데이터)의 사실 목록', () => {
  const chart = reportedChart();
  const { items, numberOf } = allItems(chart);
  const textOf = (id: string) => items.find((e) => e.n === numberOf.get(id))!.content;

  it('근거 24개 남짓이 같은 사실끼리 합쳐진다 (일간·일주 천간, 오행 전부, 글자·십신·십신 묶음)', () => {
    expect(numberOf.get('dayMaster')).toBe(numberOf.get('pillar.day.stem'));
    const elementNs = new Set(['elements.summary', 'elements.wood', 'elements.metal', 'elements.earth'].map((id) => numberOf.get(id)));
    expect(elementNs.size).toBe(1);
    // 인(寅) 식신(지지) · 갑(甲) 식신(천간) · 식상 묶음 → "표현·재능" 한 줄
    const siksang = ['pillar.day.branch', 'tenGod.day.branch', 'tenGod.hour.stem', 'pillar.hour.stem', 'tenGodGroup.siksang'].map((id) => numberOf.get(id));
    expect(new Set(siksang).size).toBe(1);
    // 미(未) 정관 · 미(未) 정관 · 진(辰) 편관 · 관성 묶음 → "규칙·책임" 한 줄
    const gwan = ['tenGod.year.branch', 'tenGod.month.branch', 'pillar.hour.branch', 'tenGodGroup.gwanseong'].map((id) => numberOf.get(id));
    expect(new Set(gwan).size).toBe(1);
    // 원국 안의 관계(정(丁)-임(壬) 천간합 두 번)도 타고난 사실 묶음에 들어간다
    expect(items.filter((e) => e.group === 'natal').map((e) => e.id)).toEqual([
      'me', 'elements', 'group.bigeop', 'group.siksang', 'group.jaeseong', 'group.gwanseong', 'group.inseong',
      'relation.stemCombine.year.stem+day.stem', 'relation.stemCombine.month.stem+day.stem',
    ]);
  });

  it('사실 문장은 이 사람에 대한 사실만 쉬운 말로 말한다', () => {
    expect(textOf('dayMaster')).toBe('나를 나타내는 글자는 태어난 날의 윗글자 임(壬)이에요. 큰 강물 같은 물의 기운이에요.');
    expect(textOf('elements.summary')).toBe('내 사주 8글자의 기운은 흙 3개 · 나무 2개 · 불 2개 · 물 1개 · 쇠 0개예요. 흙이 가장 많고 쇠는 없어요.');
    // 천간과 지지에 걸친 묶음(인(寅)·갑(甲))
    expect(textOf('tenGod.hour.stem')).toBe('나를 나타내는 글자를 뺀 7글자 중 태어난 날의 아랫글자 인(寅), 태어난 시의 윗글자 갑(甲) 2개가 표현·재능을 뜻하는 글자예요. 모두 내가 키워 내는 나무의 기운이에요.');
    expect(textOf('tenGod.year.stem')).toBe('나를 나타내는 글자를 뺀 7글자 중 태어난 해·달의 윗글자 정(丁)·정(丁) 2개가 재물·활동을 뜻하는 글자예요. 모두 내가 다스리는 불의 기운이에요.');
    expect(textOf('tenGodGroup.bigeop')).toBe('나와 같은 자립·경쟁의 글자는 나를 나타내는 글자를 뺀 7글자 중에 없어요.');
    expect(textOf('tenGodGroup.gwanseong')).toBe('나를 나타내는 글자를 뺀 7글자 중 태어난 해·달·시의 아랫글자 미(未)·미(未)·진(辰) 3개가 규칙·책임을 뜻하는 글자예요. 모두 나를 다스리는 흙의 기운이에요.');
    expect(textOf('tenGodGroup.inseong')).toBe('나를 도와주는 배움·보살핌의 글자는 나를 나타내는 글자를 뺀 7글자 중에 없어요.');
    expect(textOf('daewoon[5]')).toBe('61세(만 59세, 2027년 4월)부터 10년은 신축(辛丑)의 큰 흐름이에요. 윗글자 신(辛)은 쇠의 기운으로 배움·보살핌, 아랫글자 축(丑)은 흙의 기운으로 규칙·책임을 뜻해요.');
    // D-048: 그해 글자와 원국 글자의 관계(병-임 천간충, 오-미 육합 두 번)도 사실로 보여 준다
    expect(textOf('seun[0]')).toBe(
      '2026년은 병오(丙午)년이에요. 윗글자 병(丙)과 아랫글자 오(午) 모두 불의 기운이고, 나에게는 재물·활동을 뜻해요. ' +
        '그해 윗글자 병(丙)은 태어난 날의 윗글자 임(壬)과 서로 부딪치는 관계예요. 그해 아랫글자 오(午)는 태어난 해의 아랫글자 미(未)와 짝을 이뤄 묶이는 관계예요. ' +
        '그해 아랫글자 오(午)는 태어난 달의 아랫글자 미(未)와 짝을 이뤄 묶이는 관계예요.',
    );
  });

  it('용어 풀이·전문 표기는 자세히(detail)에만 있고, 조사 표기가 받침에 맞는다', () => {
    const siksang = items.find((e) => e.id === 'group.siksang')!;
    expect(siksang.detail[0]).toBe('식상(식신·상관): 내가 키워 내는 기운의 글자를 함께 부르는 이름이에요.');
    expect(siksang.detail).toContain('일주 지지 인(寅)은 일간 기준 식신');
    const jaeseong = items.find((e) => e.id === 'group.jaeseong')!;
    expect(jaeseong.detail).toContain('재성(정재, 오행 화(火))은 원국 8글자 중 일간(나를 나타내는 글자)을 뺀 7글자에서 2개: 년주 천간 정(丁) 정재, 월주 천간 정(丁) 정재');
    const bigeop = items.find((e) => e.id === 'group.bigeop')!;
    expect(bigeop.detail).toContain('비겁(오행 수(水))은 원국 8글자 중 일간(나를 나타내는 글자)을 뺀 7글자에서 0개');
    expect(items.find((e) => e.id === 'seun[0]')!.detail).toContain('병(丙) 편재 · 오(午) 정재');
    for (const e of items) for (const d of e.detail) expect(d).not.toMatch(LEFTOVER_JOSA);
  });

  it('차트 강조: 묶음 사실은 그 묶음의 글자 전부, 오행 사실은 가장 많은 기운의 글자도 가리킨다', () => {
    expect(items.find((e) => e.id === 'group.gwanseong')!.chartRefs).toEqual(['year.branch', 'month.branch', 'hour.branch']);
    expect(items.find((e) => e.id === 'elements')!.chartRefs).toEqual(expect.arrayContaining(['year.branch', 'month.branch', 'hour.branch', 'elements.earth']));
    expect(items.find((e) => e.id === 'group.inseong')!.chartRefs).toEqual(['elements.metal']);
  });

  it('번호는 묶음 순서(타고난 사실 → 시기·흐름)대로 1부터다', () => {
    expect(items.map((e) => e.n)).toEqual(items.map((_, i) => i + 1));
    const groupIdx = items.map((e) => EVIDENCE_GROUP_ORDER.indexOf(e.group));
    expect(groupIdx).toEqual([...groupIdx].sort((a, b) => a - b));
  });

  it('사실마다 그 사실을 인용한 문장을 화면 순서대로 갖는다 (같은 사실의 다른 근거를 인용해도 연결된다)', () => {
    const evidence = buildEvidence(chart);
    const { items: xs } = buildEvidenceItems(chart, new Map(evidence.map((e) => [e.id, e])), [
      cite('s0', ['tenGod.day.branch']),
      cite('s1', ['seun[0]'], '2026년'),
      cite('s2', ['tenGodGroup.siksang', 'tenGod.hour.stem'], '재물'),
    ]);
    expect(xs.find((e) => e.id === 'group.siksang')!.usedBy.map((u) => [u.sentenceId, u.where])).toEqual([['s0', '총평'], ['s2', '재물']]);
    expect(xs.find((e) => e.id === 'seun[0]')!.usedBy.map((u) => u.sentenceId)).toEqual(['s1']);
  });
});

describe('여러 차트에서', () => {
  const charts = [1924, 1950, 1965, 1979, 1988, 1999, 2004, 2013, 2024].flatMap((y) =>
    [0, 5, 11, 13, 17, 23].map((h, i) => chartOf(solar(y, ((y + i) % 12) + 1, ((y * 7 + h) % 28) + 1, { hour: h, minute: (y + h) % 60 }, { birthplaceLongitude: 126 + (i % 4) }))),
  );
  charts.push(chartOf(solar(1990, 5, 15, null)));

  it('모든 근거가 번호를 받고, 사실 문장에 전문 용어·조사 표기가 없으며 문장으로 끝난다', () => {
    for (const chart of charts) {
      const { evidence, items, numberOf } = allItems(chart);
      expect(evidence.every((e) => numberOf.has(e.id))).toBe(true);
      for (const e of items) {
        expect(e.content).not.toMatch(LEFTOVER_JOSA);
        expect(e.content).not.toMatch(JARGON);
        expect(e.content).toMatch(/요\.$/u);
        expect(e.detail.length).toBeGreaterThan(0);
        for (const d of e.detail) expect(d).not.toMatch(LEFTOVER_JOSA);
      }
    }
  });

  it('시간 모름이면 "내 사주 6글자"로 말한다', () => {
    const chart = charts.at(-1)!;
    const { items } = allItems(chart);
    expect(items.find((e) => e.id === 'elements')!.content).toMatch(/^내 사주 6글자의 기운은/u);
  });

  it('리포트 뷰: 같은 사실의 근거를 함께 인용한 문장은 번호 하나, 모든 문장 번호가 목록에 있고 문장 id가 화면 순서다', () => {
    const chart = charts[3]!;
    const evidence = buildEvidence(chart);
    const s = (ids: string[]) => ({ text: '문장', evidenceIds: ids });
    const view = buildReportView({
      chart, evidence, topicIds: [], name: null, birthLabel: 'x',
      body: {
        summary: [s(['pillar.year.stem', 'tenGod.year.stem']), s(['seun[0]'])],
        traits: [s(['dayMaster'])],
        topics: {},
        daewoonNotes: [{ daewoonIndex: 0, sentences: [s(['daewoon[0]'])] }],
        yearly: { thisYear: [s(['elements.summary'])], nextYear: [s(['seun[1]'])] },
      },
    });
    const sentences = view.sections.flatMap((x) => x.groups.flatMap((g) => g.sentences));
    expect(sentences.map((x) => x.id)).toEqual(['s0', 's1', 's2', 's3', 's4', 's5']);
    expect(sentences[0]!.refs).toHaveLength(1);
    const listed = new Set(view.evidence.map((e) => e.n));
    expect(sentences.flatMap((x) => x.refs).every((n) => listed.has(n))).toBe(true);
    // 나(일간)가 1번, 오행이 2번(목록 순서), 문장 순서와 다르다
    expect(view.evidence.slice(0, 2).map((e) => e.id)).toEqual(['me', 'elements']);
    const year = chart.seun[0]!.year;
    expect(view.evidence.find((e) => e.id === 'seun[0]')!.usedBy.map((u) => u.where)).toEqual(['총평']);
    expect(view.evidence.find((e) => e.id === 'elements')!.usedBy.map((u) => u.where)).toEqual([`${year}년`]);
  });
});
