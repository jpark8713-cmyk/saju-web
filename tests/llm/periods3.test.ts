// D-052 3단계 정정(실측 후, 새 측정 없이): 계절 묶음 이름·칩, 10년 흐름의 올해·내년 사실 줄, 첫머리 틀, 칸 사이 반복, "곁에서", 각도 이름 옮겨 쓰기
import { describe, expect, it } from 'vitest';
import { REPORT_LAYOUT } from '../../src/config/report';
import { buildChart } from '../../src/engine/chart';
import { buildEvidence, buildPeriodEvidence } from '../../src/engine/evidence';
import { angleLines, assignAngles } from '../../src/llm/angles';
import { targetDaewoonIndices } from '../../src/llm/evidenceSelect';
import { generateReport } from '../../src/llm/generate';
import { decadeUserMessage } from '../../src/llm/prompt';
import { SAMPLE_AS_OF, SAMPLE_INPUTS, SAMPLE_REFERENCE_YEAR } from '../../src/llm/samples';
import type { ReportBody } from '../../src/llm/types';
import { prepareRules, validateSentence } from '../../src/llm/validate';
import {
  openerFrame, relationWordsMismatch, validateOpenerFrame, validatePeriodAngleCopy, validatePeriodNameStart, validatePeriodRelationAdvice, validatePhraseRepeat, validateWordCap,
} from '../../src/llm/validate';
import { findForbidden, PERIOD_SCENE_FORBIDDEN, PERIOD_TIME_FORBIDDEN } from '../../src/llm/forbidden';
import { buildReportView, seunRelations } from '../../src/report/view';
import { FakeModerator, FakeTransport, validResponder } from './fakes';

const L = REPORT_LAYOUT;
const setup = (sample: number) => {
  const chart = buildChart(SAMPLE_INPUTS[sample]!, { referenceYear: SAMPLE_REFERENCE_YEAR });
  return { chart, evidence: buildEvidence(chart), indices: targetDaewoonIndices(chart, SAMPLE_REFERENCE_YEAR, L.daewoonNoteCount) };
};
const adult = setup(7);
const child = setup(4);
const gen = (s: ReturnType<typeof setup>, transport: FakeTransport) =>
  generateReport({ chart: s.chart, evidence: s.evidence, topicIds: ['wealth'], referenceYear: SAMPLE_REFERENCE_YEAR, transport, moderator: new FakeModerator(), asOf: SAMPLE_AS_OF });
const ss = (texts: string[], prefix = 'years') => texts.map((text, i) => ({ path: `${prefix}[${i}][0]`, text }));

describe('첫머리 틀(10년 흐름, 첫 시도에서만)', () => {
  // 3단계 실측(아이 4번)의 10년 칸 문장 꼴
  const real = [
    '2027년은 정미(丁未)의 해로, 윗글자 정(丁)과 태어난 해의 윗글자 계(癸)가 서로 부딪치는 관계라 만 3세 아이에게 예민함이 보일 수 있어요.',
    '2028년은 무신(戊申)의 해로, 윗글자 무(戊)와 태어난 해의 윗글자 계(癸)가 서로 묶이는 관계라 만 4세 아이가 부드럽게 어울리는 편이에요.',
    '2029년은 기유(己酉)의 해로, 아랫글자 유(酉)와 태어난 해의 아랫글자 묘(卯)가 서로 부딪치는 관계라 만 5세 아이가 달라 보여요.',
    '2030년은 경술(庚戌)의 해로, 윗글자 경(庚)과 태어난 달의 윗글자 을(乙)이 서로 묶이는 관계라 만 6세 아이가 어울리는 모습이 보여요.',
  ];
  it('연도·간지·한자·나이·월을 가리고 앞 세 어절로 비교한다', () => {
    expect(openerFrame(real[0]!)).toBe('Y G 해로');
    expect(openerFrame('만 4세가 되는 2028년에는 스스로 해 보려는 마음이 커져요.')).toBe('A 되는 Y');
    expect(openerFrame('11월 기해(己亥)의 달은 차분해요.')).toBe('M G 달은');
  });
  it('같은 틀이 3문장을 넘으면(4문장) 다시 쓰게 하고, 3문장까지는 통과한다', () => {
    expect(validateOpenerFrame(ss(real)).map((v) => v.code)).toEqual(['openerFrame']);
    expect(validateOpenerFrame(ss(real.slice(0, 3)))).toEqual([]);
  });
  it('생성: 10년 칸 8칸의 첫 문장이 모두 같은 틀이면 첫 시도에서 한 번 다시 쓰고, 그래도 같으면 통과시킨다', async () => {
    const ok = validResponder(adult.indices);
    let calls = 0;
    const t = new FakeTransport((req, n) => {
      const r = ok(req, n) as { body: any };
      if (req.label !== 'decade') return r;
      calls++;
      r.body.periods.forEach((p: any, k: number) => { p.sentences[0].text = `${2028 + k}년은 같은 틀로 ${p.sentences[0].text}`; });
      return r;
    }, () => 0, 'raw');
    const r = await gen(adult, t);
    expect(calls).toBe(2);
    expect(r.attempts.filter((a) => a.label === 'decade')[0]!.violations.map((v) => v.code)).toContain('openerFrame');
    expect(r.body.templated).toBeUndefined();
  });
});

describe('같은 글귀·"곁에서"·각도 이름(월·연 칸, 첫 시도에서만)', () => {
  it('사실 표기를 뺀 5어절 글귀가 두 번 나오면 뒤 문장을 다시 쓰게 한다', () => {
    const v = validatePhraseRepeat(ss([
      '2027년 1월은 부딪치는 관계라 아이가 늘 하던 자리나 방식을 바꿔 보려는 모습이 보일 수 있어요.',
      '2029년은 만 5세 아이가 늘 하던 자리나 방식을 바꿔 보려는 모습이 보일 수 있어요.',
    ]));
    expect(v.map((x) => [x.code, x.path])).toEqual([['repeatedPhrase', 'years[1][0]']]);
  });
  it('근거를 옮기는 사실 글귀("태어난 해의 윗글자 계(癸)가 서로 묶이는")는 반복으로 보지 않는다', () => {
    expect(validatePhraseRepeat(ss([
      '2028년은 윗글자 무(戊)와 태어난 해의 윗글자 계(癸)가 서로 묶이는 관계라 차분해요.',
      '2033년은 윗글자 무(戊)와 태어난 해의 윗글자 계(癸)가 서로 묶이는 관계라 든든해요.',
    ]))).toEqual([]);
  });
  it('다른 칸(올해·내년)에 나온 글귀를 또 쓰면 걸린다', () => {
    const v = validatePhraseRepeat(ss(['이 달에는 하루 일과를 일정하게 지켜 보세요.'], 'months'), ['올해는 하루 일과를 일정하게 지켜 보세요.']);
    expect(v.map((x) => x.detail)).toEqual([expect.stringContaining('리포트의 다른 칸')]);
  });
  it('"곁에서"는 리포트 전체 3번까지(다른 칸 문장까지 센다)', () => {
    const three = ss(['곁에서 지켜봐 주세요.', '곁에서 기다려 주세요.', '곁에서 들어 주세요.']);
    expect(validateWordCap(three)).toEqual([]);
    expect(validateWordCap(three, ['올해는 곁에서 챙겨 주세요.']).map((v) => v.path)).toEqual(['years[2][0]']);
  });
  it('합·충 각도 이름의 활용 꼴과 뜻 설명 옮기기를 잡고, 근거의 관계 이름·묶음 각도 이름은 잡지 않는다(묶음·오행은 기록만)', () => {
    const hit = (t: string) => validatePeriodAngleCopy(ss([t])).length > 0;
    for (const t of [
      '아이가 부딪치며 바뀌듯 하던 방식을 고쳐요.', '마음이 흔들려 깨어나는 모습이에요.', '합쳐 새 힘을 내듯 이어 가요.', '늘 하던 자리나 방식을 바꿔 보려 해요.',
      // 2차 실측에서 옮겨 쓴 뜻 설명 문구
      '가만있던 것이 움직이는 쪽으로 흐르는 편이에요.', '흩어진 것이 모이는 쪽으로 흐르는 편이에요.', '날 선 마음이 무뎌지고 부드러워지는 편이에요.',
    ]) expect(hit(t), t).toBe(true);
    for (const t of ['서로 끌어당기는 관계라 가까워져요.', '서로 부딪치는 관계라 예민해질 수 있어요.', '새로운 방식을 시도해 보세요.', '맡은 몫을 하나씩 챙겨 보세요.', '내 몫을 지키는 마음이 커져요.']) expect(hit(t), t).toBe(false);
  });
  it('생성: 월별 문장에 각도 이름을 옮기면 한 번 다시 쓰고, 끝내 못 고쳐도 통과한다(사실 문장으로 바꾸지 않는다)', async () => {
    const ok = validResponder(adult.indices);
    let calls = 0;
    const t = new FakeTransport((req, n) => {
      const r = ok(req, n) as { body: any };
      if (req.label !== 'monthly') return r;
      calls++;
      r.body.periods[4].sentences[0].text = '하던 방식이 부딪치며 바뀌듯 달라져요.';
      return r;
    }, () => 0, 'raw');
    const r = await gen(adult, t);
    expect(calls).toBe(2);
    expect(r.body.periods!.months![4]!.sentences[0]!.text).toBe('하던 방식이 부딪치며 바뀌듯 달라져요.');
    expect(r.body.templated).toBeUndefined();
  });
});

describe('칸 사이 반복(월별 ↔ 10년 ↔ 올해·내년): 다시 만들지 않고 기록만(사업자 결정)', () => {
  it('"곁에서"가 리포트 전체 3번을 넘겨도 다시 만들지 않고, 넘긴 문장 수를 남긴다', async () => {
    const ok = validResponder(adult.indices);
    const t = new FakeTransport((req, n) => {
      const r = ok(req, n) as { body: any };
      // 월별 2번 + 10년 2번 = 4번(칸 안에서는 각각 2번이라 칸 안 검사는 통과한다)
      if (req.label === 'monthly') [0, 1].forEach((k) => { r.body.periods[k].sentences[0].text = `곁에서 ${k + 1}번째 달을 챙겨요.`; });
      if (req.label === 'decade') [0, 1].forEach((k) => { r.body.periods[k].sentences[0].text = `곁에서 ${k + 1}번째 해를 챙겨요.`; });
      return r;
    }, () => 0, 'raw');
    const r = await gen(adult, t);
    expect(t.requests.map((q) => q.label).sort()).toEqual(['base', 'decade', 'monthly', 'topic:wealth']);
    expect(r.body.observed).toMatchObject({ besideOver: 1 });
  });
  it('반복이 없으면 기록도 0', async () => {
    const r = await gen(adult, new FakeTransport(validResponder(adult.indices)));
    // 같은 글귀 수는 가짜 올해·내년 문장끼리도 겹쳐 0이 아닐 수 있다(기록만)
    expect(r.body.observed).toMatchObject({ besideOver: 0 });
  });
});

describe('프롬프트', () => {
  it('어른 10년 흐름(C안): year[2]부터 칸마다 1문장, 사실 줄을 되풀이하지 않고 해 이름으로 시작하지 않으며, 관계 표를 넣지 않는다', () => {
    const angles = assignAngles(adult.chart, { child: false, toddler: false }, ['year:2']);
    const msg = decadeUserMessage({ evidence: [], indices: [2, 3, 4, 5, 6, 7, 8, 9], angleBlock: angleLines(angles, [{ key: 'year:2', name: 'periods[2]' }], { omitRelation: true }) });
    expect(msg).toContain('periods: index 2, 3, 4, 5, 6, 7, 8, 9 차례로 8칸, 칸마다 1문장');
    expect(msg).toContain('올해와 내년은 위 올해·내년 칸에서 따로');
    expect(msg).toContain('해 이름(○○○○년 ○월, ○○○○년, 이해, 간지)으로 문장을 시작하지 않습니다');
    expect(msg).toContain('같은 것을 세 문장까지만');
    expect(msg).toContain('처음 들어오는, 처음으로, 비로소, 새로 들어오는');
    expect(msg).not.toContain('[관계 표]');
  });
  it('월·연 칸의 각도 안내는 관계 표를 각도 이름 대신 뜻 설명으로 준다', () => {
    const angles = assignAngles(adult.chart, { child: false, toddler: false }, ['month:0']);
    const name = angles.bySection['month:0']!.clash!;
    const plain = angleLines(angles, [{ key: 'month:0', name: 'periods[0]' }]);
    const meaning = angleLines(angles, [{ key: 'month:0', name: 'periods[0]' }], { relationMeaning: true });
    expect(plain).toContain(`부딪치는 관계=${name}`);
    expect(meaning).not.toContain(`부딪치는 관계=${name}`);
    expect(meaning).toMatch(/부딪치는 관계=[가-힣 ]+쪽/u);
  });
});

describe('화면 데이터', () => {
  const view = async (s: ReturnType<typeof setup>) => {
    const r = await gen(s, new FakeTransport(validResponder(s.indices)));
    return { body: r.body, v: buildReportView({ chart: s.chart, evidence: [...s.evidence, ...r.periodEvidence], body: r.body, topicIds: ['wealth'], name: null, birthLabel: '' }) };
  };
  it('10년 흐름: 10해를 보여 주고, 올해·내년은 AI 문장 없이 사실 줄 + 올해·내년 칸 링크', async () => {
    const { v } = await view(adult);
    const years = v.sections.find((s) => s.id === 'years')!;
    expect(years.groups).toHaveLength(10);
    expect(years.groups.slice(0, 2).map((g) => [g.sentences.length, g.fact?.link?.href])).toEqual([[0, '#section-yearly'], [0, '#section-yearly']]);
    expect(years.groups[0]!.fact!.text).toMatch(/^윗글자 .+ 아랫글자 .+ 뜻하는 글자예요\./u);
    // C안: 나머지 해는 사실 줄(링크 없음) + AI 1문장
    expect(years.groups.slice(2).every((g) => g.sentences.length === L.yearSentences && g.fact && !g.fact.link)).toBe(true);
  });
  it('예전 리포트(10해 모두 AI 문장)는 그대로 10해 문장을 보여 준다', async () => {
    const { body } = await view(adult);
    const old: ReportBody = {
      ...body,
      periods: { ...body.periods!, years: [0, 1, ...body.periods!.years.map((n) => n.index)].map((index) => ({ index, sentences: [{ text: `${index}번째 해예요.`, evidenceIds: [`year[${index}]`] }] })) },
    };
    const v = buildReportView({ chart: adult.chart, evidence: adult.evidence, body: old, topicIds: ['wealth'], name: null, birthLabel: '' });
    const years = v.sections.find((s) => s.id === 'years')!;
    expect(years.groups.map((g) => g.sentences.length)).toEqual(Array(10).fill(1));
    expect(years.groups.some((g) => g.fact?.link)).toBe(false);
  });
  it('계절 묶음 이름은 날짜 범위와 절기(어른 월별 머리도 같다)', async () => {
    const { v } = await view(child);
    const seasons = v.sections.find((s) => s.id === 'seasons')!;
    for (const g of seasons.groups) expect(g.subtitle).toMatch(/^\d{4}년 \d{1,2}\/\d{1,2} ~ \d{4}년 \d{1,2}\/\d{1,2} \([가-힣]+·[가-힣]+·[가-힣]+\)$/u);
    expect(seasons.groups.map((g) => g.subtitle).join()).not.toMatch(/봄|여름|가을|겨울/u);
    const months = (await view(adult)).v.sections.find((s) => s.id === 'months')!;
    expect(months.groups[0]!.cluster).toMatch(/^\d{4}년 .+\)$/u);
  });
  it('계절 묶음 칩은 문장이 인용한 달만 보여 준다', async () => {
    const { body, v } = await view(child);
    const seasons = v.sections.find((s) => s.id === 'seasons')!;
    body.periods!.seasons!.forEach((n, i) => {
      const cited = new Set(n.sentences.flatMap((s) => s.evidenceIds));
      const monthsShown = new Set((seasons.groups[i]!.chips ?? []).map((c) => c.text.split('월')[0]));
      // 가짜 응답은 묶음마다 첫 달만 인용한다
      expect(cited.size).toBe(1);
      expect(monthsShown.size).toBeLessThanOrEqual(1);
    });
  });
});

describe('C안: 사실 줄 + AI 1문장(어른 월별·10년)', () => {
  it('어른 월별은 달마다 사실 줄(간지 뜻 + 주된 관계)과 AI 1문장', async () => {
    const r = await gen(adult, new FakeTransport(validResponder(adult.indices)));
    const v = buildReportView({ chart: adult.chart, evidence: [...adult.evidence, ...r.periodEvidence], body: r.body, topicIds: ['wealth'], name: null, birthLabel: '' });
    const months = v.sections.find((s) => s.id === 'months')!;
    expect(months.groups.every((g) => g.sentences.length === 1 && g.fact && !g.fact.link)).toBe(true);
    // 관계가 있는 달은 사실 줄 끝에 주된 관계 한 문장
    const withRel = months.groups.find((g) => (g.chips ?? []).length > 0)!;
    expect(withRel.fact!.text).toMatch(/(같은 글자예요|서로 묶이는 관계예요|서로 부딪치는 관계예요)\.$/u);
  });
  it('달·해 이름으로 시작하는 AI 문장은 첫 시도에서 다시 쓰게 한다("이해"로 시작하는 낱말은 아니다)', () => {
    const starts = (t: string) => validatePeriodNameStart(ss([t])).length > 0;
    for (const t of ['2026년 11월은 차분해요.', '11월에는 쉬어 보세요.', '2029년은 바뀌어요.', '이달은 정리해 보세요.', '그해에는 쉬어요.']) expect(starts(t), t).toBe(true);
    // D: 간지는 그 칸 자기 간지로 시작할 때만 건다. 대운·큰 흐름 이름은 통과(C안 실측 오탐)
    const own = new Map([['years[0][0]', '기유(己酉)']]);
    expect(validatePeriodNameStart(ss(['기유(己酉)의 기운이 커요.']), own).length).toBe(1);
    expect(validatePeriodNameStart(ss(['경오(庚午)의 큰 흐름에서 신미(辛未)의 큰 흐름으로 바뀌는 때라 익힐 것을 골라 보세요.']), own)).toEqual([]);
    for (const t of ['이해심을 넓혀 보세요.', '규칙·책임을 뜻하는 글자라 맡은 일을 정리해 보세요.']) expect(starts(t), t).toBe(false);
  });
});

describe('월·연 칸 하드 금지: 근거에 없는 시간 서술', () => {
  const hit = (t: string) => findForbidden(t, [PERIOD_TIME_FORBIDDEN]).length > 0;
  it('다른 달·해와 견주는 시간 서술을 막는다(2차 실측의 사실 오류 문장 포함)', () => {
    for (const t of [
      '쇠의 기운이 처음 들어오는 달이니, 미뤄 둔 일 하나에 분명하게 선을 그어 마무리해 보세요.',
      '처음으로 규칙·책임을 뜻하는 글자가 들어와요.', '비로소 마음이 놓이는 달이에요.', '배움·보살핌을 뜻하는 글자가 새로 들어오는 해예요.',
      '익숙한 기운이 다시 돌아오는 달이에요.', '오랜만에 물의 기운이 들어와요.', '드디어 큰 흐름이 바뀌어요.',
    ]) expect(hit(t), t).toBe(true);
  });
  it('시간 서술이 아닌 말은 통과한다', () => {
    for (const t of ['처음 해 보는 일을 하나 골라 보세요.', '새로 알게 된 방법을 일상에 시험해 보세요.', '다시 한 번 계획을 살펴보세요.', '처음 와 닿는 말을 적어 두세요.', '처음 맞는 일도 차분히 해 보세요.', '다시 돌아보면 정리가 쉬워요.']) expect(hit(t), t).toBe(false);
    // "처음으로"는 사업자가 하드 금지 목록에 넣은 말이라 행동 제안("처음으로 해 보세요")도 막는다
    expect(hit('처음으로 해 보세요.')).toBe(true);
  });
  it('생성: 끝내 못 고친 시간 서술 문장은 사실 문장으로 바꾸고 주문은 끝난다', async () => {
    const ok = validResponder(adult.indices);
    const t = new FakeTransport((req, n) => {
      const r = ok(req, n) as { body: any };
      if (req.label === 'decade') r.body.periods[3].sentences[0].text = '쇠의 기운이 처음 들어오는 해예요.';
      return r;
    }, () => 0, 'raw');
    const r = await gen(adult, t);
    expect(r.body.periods!.years[3]!.sentences[0]!.text).not.toContain('처음 들어오는');
    expect(r.body).toMatchObject({ templated: ['decade'], templatedSentences: 1 });
  });
});

describe('버그 수정: 올해·내년 머리 칩과 문장의 관계 일관성', () => {
  const setupAt = (sample: number) => {
    const chart = buildChart(SAMPLE_INPUTS[sample]!, { referenceYear: SAMPLE_REFERENCE_YEAR });
    return { chart, evidence: buildEvidence(chart), indices: targetDaewoonIndices(chart, SAMPLE_REFERENCE_YEAR, L.daewoonNoteCount) };
  };
  // (3)단계 실측에서 나온 올해·내년 문장: 문장이 말한 관계가 그해 관계 목록(칩과 같은 데이터)에 있어야 한다
  const measured: [number, number, string][] = [
    [10, 0, '2026년은 병오(丙午)의 해라 재물·활동을 뜻하는 글자가 들어오고, 윗글자 병(丙)은 내 사주의 임(壬)과 서로 부딪치는 관계라 움직임이 잦아지는 편이에요.'],
    [10, 1, '내년인 2027년은 정미(丁未)의 해라 윗글자 정(丁)이 내 사주의 임(壬)과 서로 묶이는 관계라 부드럽게 맞물리는 모습이 나타나는 편이에요.'],
    [4, 1, '2027년은 정미(丁未)의 해라, 윗글자 정(丁)은 태어난 해의 윗글자 계(癸)와, 아랫글자 미(未)는 태어난 달의 아랫글자 축(丑)과 서로 부딪치는 관계라 팽팽한 긴장이 도는 모습이 보여요.'],
  ];
  for (const [sample, i, text] of measured) {
    it(`샘플 ${sample} ${i === 0 ? '올해' : '내년'}: 머리 칩이 있고, 문장의 관계가 관계 목록에 있다`, async () => {
      const s = setupAt(sample);
      const rels = seunRelations(s.chart, i);
      expect(rels.length).toBeGreaterThan(0);
      expect(relationWordsMismatch(text, rels)).toEqual([]);
      const r = await gen(s, new FakeTransport(validResponder(s.indices)));
      const v = buildReportView({ chart: s.chart, evidence: [...s.evidence, ...r.periodEvidence], body: r.body, topicIds: ['wealth'], name: null, birthLabel: '' });
      const yearly = v.sections.find((x) => x.id === 'yearly')!;
      expect(yearly.groups[i]!.chips!.length).toBe(rels.length);
    });
  }
  it('문장이 관계 목록에 없는 관계를 말하면 잡는다', () => {
    const rels = seunRelations(setupAt(10).chart, 0);
    const kinds = new Set(rels.map((r) => r.kind));
    const text = kinds.has('stemCombine') || kinds.has('branchSixCombine') ? '서로 부딪치는 관계예요.' : '서로 묶이는 관계예요.';
    if (kinds.has('stemClash') || kinds.has('branchClash')) {
      if (!(kinds.has('stemCombine') || kinds.has('branchSixCombine'))) expect(relationWordsMismatch('서로 묶이는 관계예요.', rels)).toEqual(['combine']);
    } else {
      expect(relationWordsMismatch(text, rels)).toEqual(['clash']);
    }
    expect(relationWordsMismatch('같은 글자가 들어와요.', [])).toEqual(['same']);
  });
});

describe('월·연 문장 마감(D-052 3단계, A~F)', () => {
  // C안 재측정(run20, 어른 10번)의 월별 12문장
  const RUN20_MONTHS = [
    '나를 뺀 7글자 중 규칙·책임을 뜻하는 글자가 2개 있는 사람인데, 이런 달에는 맡은 일의 범위를 먼저 말해 두면 믿음을 주기 좋아요.',
    '새로 맡게 된 일에 이름을 걸고 하는 편이 어울리는 달이라, 내 사주에 규칙·책임을 뜻하는 글자가 2개 있는 만큼 맡은 몫을 한 줄로 정리해 두면 좋아요.',
    '배움·보살핌을 뜻하는 글자가 내 사주에 하나도 없어서, 이 달에 들어오는 쇠의 기운은 군더더기를 덜어 내고 필요한 것만 다듬는 쪽으로 쓰면 잘 맞아요.',
    '쇠의 기운이 내 사주 8글자 중 하나도 없는 편이라, 이런 달에는 미뤄 둔 일 하나를 골라 끝맺는 데 힘을 쓰면 마음이 한결 가벼워질 수 있어요.',
    '나를 뺀 7글자 중 표현·재능을 뜻하는 글자가 3개나 있어서, 가진 재능을 일로 이어 볼 작은 작업 하나를 시작해 보기 좋은 달이에요.',
    '표현·재능을 뜻하는 글자가 3개나 있는 사람이라, 여유를 갖고 즐겁게 할 수 있는 취미 활동을 일상에 넣어 보면 어울려요.',
    '나무의 기운이 내 사주 8글자 중 3개로 가장 많은 편이라, 마음이 쏠리는 분야로 조금씩 넓혀 가 보기 좋은 달이에요.',
    '표현·재능을 뜻하는 글자가 3개 있어서, 궁금한 주제 하나를 골라 깊이 파고들어 보면 만족감이 클 수 있어요.',
    '재물·활동을 뜻하는 글자가 나를 뺀 7글자 중 1개뿐이라, 지출은 꼭 필요한 곳에만 쓰도록 실속을 따져 보는 편이 잘 어울려요.',
    '재물·활동을 뜻하는 글자가 1개 있는 사람이라, 눈에 들어온 기회는 서두르지 말고 기준을 세워 하나씩 살펴보면 좋아요.',
    '규칙·책임을 뜻하는 글자가 나를 뺀 7글자 중 2개 있어서, 맡은 몫을 하나씩 갈무리해 두면 마음이 편해질 수 있어요.',
    '규칙·책임을 뜻하는 글자가 2개 있는 편이라, 이런 달에는 꾸준히 지킬 수 있는 순서를 정해 하루 일과에 넣어 보면 좋아요.',
  ];
  const biggestFrame = (texts: string[]) => Math.max(...[...texts.reduce((m, t) => m.set(openerFrame(t), (m.get(openerFrame(t)) ?? 0) + 1), new Map<string, number>()).values()]);

  it('C: 뜻 묶음 개수로 시작하는 꼴을 한 틀로 본다(run20 월별: 가장 큰 같은 틀 묶음 → 9문장, 3문장을 넘어 첫 시도에서 다시 쓰기)', () => {
    expect(RUN20_MONTHS.filter((t) => openerFrame(t) === '뜻하는 글자가 N개 있는')).toHaveLength(9);
    expect(biggestFrame(RUN20_MONTHS)).toBe(9);
    expect(validateOpenerFrame(ss(RUN20_MONTHS, 'months')).map((v) => v.code)).toEqual(['openerFrame']);
    // 세 문장까지는 통과
    expect(validateOpenerFrame(ss([RUN20_MONTHS[0]!, RUN20_MONTHS[4]!, RUN20_MONTHS[5]!, RUN20_MONTHS[6]!], 'months'))).toEqual([]);
  });
  it('C: 두 번째 시도에서 넘어도 기록만 하고 통과한다(사실 문장으로 바꾸지 않는다)', async () => {
    const ok = validResponder(adult.indices);
    let calls = 0;
    const t = new FakeTransport((req, n) => {
      const r = ok(req, n) as { body: any };
      if (req.label !== 'monthly') return r;
      calls++;
      r.body.periods.forEach((p: any, k: number) => { if (k < 5) p.sentences[0].text = `${/그 글자가 (.+)의 뜻이에요/u.exec(p.sentences[0].text)![1]}을 뜻하는 글자가 하나도 없는 ${k + 1}번째 칸이에요.`; });
      return r;
    }, () => 0, 'raw');
    const r = await gen(adult, t);
    expect(calls).toBe(2);
    expect(r.attempts.filter((a) => a.label === 'monthly')[0]!.violations.map((v) => v.code)).toContain('openerFrame');
    expect(r.body.templated).toBeUndefined();
  });
  it('A: 관계를 말한 월·연 문장이 행동 제안으로 끝나면 걸고, 모습으로 끝나면 통과한다', () => {
    const v = (t: string) => validatePeriodRelationAdvice(ss([t])).length > 0;
    expect(v('신(申)이 내 사주의 인(寅) 두 글자와 서로 부딪치는 관계라, 급한 결정은 미루고 생각을 정리하는 시간을 가져 보세요.')).toBe(true);
    expect(v('해(亥)가 내 사주의 인(寅) 두 글자와 서로 묶이는 관계라, 미뤄 둔 일을 하나 꺼내 꾸준히 이어 가 보세요.')).toBe(true);
    expect(v('신(申)이 내 사주의 인(寅)과 서로 부딪치는 관계라 마음이 자주 오가는 편이에요.')).toBe(false);
    expect(v('규칙·책임을 뜻하는 글자가 들어오니 맡은 일의 순서를 정해 보세요.')).toBe(false);
  });
  it('E: 대운이 바뀌는 해의 근거에 새 대운의 시작 표기가 있어, 그 표기를 쓴 문장이 숫자 검사를 통과한다', () => {
    const s = setup(10);
    const p = buildPeriodEvidence(s.chart, SAMPLE_AS_OF, SAMPLE_REFERENCE_YEAR);
    const turn = p.years.find((y) => y.nextDaewoon)!;
    const ev = p.evidence.find((e) => e.id === `year[${turn.index}]`)!;
    expect(ev.content).toMatch(/대운\(\d+세\(\d{4}년 \d{1,2}월\)부터\)으로 바뀜/u);
    const label = /대운\((\d+세\(\d{4}년 \d{1,2}월\))부터\)으로 바뀜/u.exec(ev.content)![1]!;
    const rules = prepareRules({ evidence: [...s.evidence, ...p.evidence], forbidden: [], maxChars: L.maxSentenceChars });
    expect(validateSentence({ text: `${label}부터 큰 흐름이 바뀌니 익힐 것을 하나 골라 보세요.`, evidenceIds: [`year[${turn.index}]`] }, 'p', rules).map((x) => x.code)).not.toContain('numberNotInEvidence');
  });
  it('F: 근거에 없는 새 일거리(새로 맡게 된 일·새 일·새 프로젝트)를 막고, 권하는 문장은 통과한다', () => {
    const hit = (t: string) => findForbidden(t, [PERIOD_SCENE_FORBIDDEN]).length > 0;
    for (const t of ['새로 맡게 된 일에 이름을 걸고 해 보세요.', '새로 맡은 업무를 정리해요.', '새 일을 시작하기 좋은 달이에요.', '새 프로젝트를 꾸려 보세요.']) expect(hit(t), t).toBe(true);
    for (const t of ['새 방법을 한 가지 시험해 보세요.', '새 일정을 적어 두세요.', '새 일과를 하나 넣어 보세요.', '새로 알게 된 방법을 써 보세요.']) expect(hit(t), t).toBe(false);
  });
});
