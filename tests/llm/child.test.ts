// 아이 리포트(만 13세 미만, D-044): 나이 판정, 총평 템플릿, 금지 표현, 생성 흐름 (가짜 LLM, 실제 호출 없음)
import { describe, expect, it } from 'vitest';
import { REPORT_LAYOUT } from '../../src/config/report';
import { buildChart } from '../../src/engine/chart';
import { buildEvidence } from '../../src/engine/evidence';
import { targetDaewoonIndices } from '../../src/llm/evidenceSelect';
import { CHILD_FORBIDDEN, CHILD_VOICE_FORBIDDEN, COMMON_FORBIDDEN, GROWN_NOTE_FORBIDDEN, TODDLER_FORBIDDEN, TODDLER_MONEY_FORBIDDEN, findForbidden } from '../../src/llm/forbidden';
import { PRICES, priceFor } from '../../src/config/prices';
import { generateReport } from '../../src/llm/generate';
import { CHILD_NOTE } from '../../src/llm/prompt';
import { SAMPLE_AS_OF, SAMPLE_INPUTS, SAMPLE_REFERENCE_YEAR } from '../../src/llm/samples';
import { prepareRules, validateSection } from '../../src/llm/validate';
import { audienceOf, fullAge, isChildChart, kstDateOf } from '../../src/report/audience';
import { buildReportView } from '../../src/report/view';
import { summaryTemplate } from '../../src/report/summaryTemplate';
import { FakeModerator, FakeTransport, validResponder, validTopic } from './fakes';

const charts = SAMPLE_INPUTS.map((input) => buildChart(input, { referenceYear: SAMPLE_REFERENCE_YEAR }));
const childRules = [...COMMON_FORBIDDEN, ...CHILD_FORBIDDEN];

describe('만 나이와 아이 리포트 판정', () => {
  it('생일이 지나지 않았으면 한 살 뺀다', () => {
    const birth = { year: 2013, month: 10, day: 23 };
    expect(fullAge(birth, { year: 2026, month: 10, day: 22 })).toBe(12);
    expect(fullAge(birth, { year: 2026, month: 10, day: 23 })).toBe(13);
  });

  it('한국 시간 날짜로 본다 (UTC 15시는 다음 날)', () => {
    expect(kstDateOf(new Date('2026-10-22T15:30:00Z'))).toEqual({ year: 2026, month: 10, day: 23 });
  });

  it('샘플 기준 시각에 2024년생은 아이, 2010년생(만 16세)·1990년생은 어른', () => {
    const byYear = (y: number) => charts.find((c) => c.solarDate.year === y)!;
    expect(isChildChart(byYear(2024), SAMPLE_AS_OF)).toBe(true);
    expect(isChildChart(byYear(2010), SAMPLE_AS_OF)).toBe(false);
    expect(isChildChart(byYear(1990), SAMPLE_AS_OF)).toBe(false);
  });
});

describe('아이 리포트 총평 템플릿', () => {
  it('모든 샘플에서 아이 문장도 검증(아이 금지 표현·길이)을 통과하고, 부모에게 말한다', () => {
    for (const chart of charts) {
      const evidence = buildEvidence(chart);
      const rules = prepareRules({ evidence, forbidden: childRules, maxChars: REPORT_LAYOUT.maxSentenceChars });
      const t = summaryTemplate(chart, { child: true });
      expect(validateSection(t, 'summaryTemplate', REPORT_LAYOUT.summaryTemplateSentences, rules)).toEqual([]);
      expect(t[1]!.text).toMatch(/아이|곁에서|함께|지켜 주면|기다려 주면/u);
      // 첫 문장은 부모가 읽으므로 "아이를 나타내는 글자"로 시작한다(D-045). 나머지는 어른 문장과 같다
      expect(t[0]!.text).toBe(summaryTemplate(chart)[0]!.text.replace(/^나를/u, '아이를'));
      expect(t[0]!.text.startsWith('아이를 나타내는 글자가')).toBe(true);
    }
  });
});

describe('아이 리포트 금지 표현', () => {
  const reasons = (text: string) => findForbidden(text, CHILD_FORBIDDEN).map((r) => r.reason);
  it.each([
    ['멘토나 스터디처럼 이끌어 줄 사람이 있는 배움의 틀을 찾아보세요.', '아이 리포트: 학업 조언'],
    ['발표나 시연 기회를 일부러 작게 만들어 연습해 보세요.', '아이 리포트: 직업 조언'],
    ['정해진 틀 안에서 맡은 몫을 해내는 조직이 잘 맞아요.', '아이 리포트: 직업 조언'],
    ['연애할 때 마음을 먼저 표현해 보세요.', '아이 리포트: 연애 조언'],
    ['새로운 모임에 한 번 나가 보세요.', '아이 리포트: 대인관계 조언'],
    ['큰 지출은 한 번 더 비교한 뒤 정하면 좋아요.', '아이 리포트: 돈 관리 조언'],
  ])('%s → %s', (text, reason) => {
    expect(reasons(text)).toContain(reason);
  });

  it.each([
    '아이가 좋아하는 놀이에 푹 빠져 있을 때는 끝날 때까지 기다려 주세요.',
    '잠들기 전 하루 있었던 일을 짧게 이야기 나눠 보면 아이가 편안해할 수 있어요.',
    '가족에게 먼저 안기며 마음을 표현하는 모습을 보일 수 있어요.',
    '작은 일을 해냈을 때 바로 칭찬해 주면 좋아요.',
    // 리뷰에서 찾은 오탐
    '새로운 놀이를 시험해 보는 걸 즐기는 모습을 보일 수 있어요.',
    '이성적으로 생각하고 차분히 살피는 편이에요.',
    '물건을 조직적으로 정리하는 모습을 보일 수 있어요.',
    '가족 모임에서 편안해하는 모습을 보일 수 있어요.',
    '어린이집이나 유치원에서 또래와 노는 모습을 지켜봐 주세요.',
    '화가 나면 이성을 잃고 울 수 있으니 먼저 안아 주세요.',
    '시험 삼아 새 음식을 먹어 보는 편이에요.',
    '친척 모임에서는 낯을 가릴 수 있어요.',
  ])('막지 않는다: %s', (text) => {
    expect(reasons(text)).toEqual([]);
  });
});

describe('아이 리포트 생성 흐름', () => {
  const chart = charts.find((c) => c.solarDate.year === 2024)!;
  const evidence = buildEvidence(chart);
  const indices = targetDaewoonIndices(chart, SAMPLE_REFERENCE_YEAR, REPORT_LAYOUT.daewoonNoteCount);

  it('아이 안내를 넣고 아이용 템플릿으로 시작하며, 어른 주제 지침은 넣지 않는다', async () => {
    const t = new FakeTransport(validResponder(indices));
    const r = await generateReport({
      chart, evidence, topicIds: ['career'], referenceYear: SAMPLE_REFERENCE_YEAR, transport: t, moderator: new FakeModerator(), asOf: SAMPLE_AS_OF,
    });
    expect(t.requests.every((q) => q.user.startsWith(CHILD_NOTE))).toBe(true);
    expect(r.body.summary.slice(0, 2)).toEqual(summaryTemplate(chart, { child: true }));
    const topicReq = t.requests.find((q) => q.label === 'topic:career')!;
    expect(topicReq.user).toContain('아이가 몰입하고 즐거워하는 놀이·관심사·재능이 드러나는 모습');
    expect(topicReq.user).toContain('## 작성할 칸: 재능·배움 풀이');
    expect(topicReq.user).not.toContain('일하는 방식');
  });

  it('학업·직업 조언 문장은 거부하고 다시 생성한다', async () => {
    let topicCalls = 0;
    const base = validResponder(indices);
    const t = new FakeTransport((req, call) => {
      if (req.label === 'base') return base(req, call);
      topicCalls++;
      const ok = validTopic(['seun[0]']);
      if (topicCalls > 1) return { body: ok };
      return { body: { sentences: ok.sentences.map((s, i) => (i === 0 ? { ...s, text: '발표 연습을 해 보세요.' } : s)) } };
    });
    const r = await generateReport({
      chart, evidence, topicIds: ['career'], referenceYear: SAMPLE_REFERENCE_YEAR, transport: t, moderator: new FakeModerator(), asOf: SAMPLE_AS_OF,
    });
    const attempts = r.attempts.filter((a) => a.label === 'topic:career');
    expect(attempts[0]!.violations.map((v) => v.code)).toContain('forbidden');
    expect(attempts).toHaveLength(2);
  });

  it('같은 사주라도 어른 시점이면 아이 안내를 넣지 않는다', async () => {
    const t = new FakeTransport(validResponder(indices));
    await generateReport({
      chart, evidence, topicIds: [], referenceYear: SAMPLE_REFERENCE_YEAR, transport: t, moderator: new FakeModerator(), asOf: new Date('2040-01-01T00:00:00+09:00'),
    });
    expect(t.requests[0]!.user).not.toContain(CHILD_NOTE);
  });
});

describe('D-045: 아이 호칭·5세 이하·대운 나이', () => {
  const chart = charts.find((c) => c.solarDate.year === 2024)!;
  const evidence = buildEvidence(chart);
  const indices = targetDaewoonIndices(chart, SAMPLE_REFERENCE_YEAR, REPORT_LAYOUT.daewoonNoteCount);

  it('2024년생은 기준 시각에 만 2세(5세 이하)이고, 이 리포트의 두 대운은 모두 13세 이후가 들어 있다', () => {
    const a = audienceOf(chart, SAMPLE_AS_OF, indices);
    expect(a).toMatchObject({ child: true, toddler: true, age: 2 });
    expect(a.daewoon.map((d) => d.grown)).toEqual([true, true]);
    expect(a.daewoon[0]!.fromAge).toBeLessThan(13);
  });

  it('아이 호칭: "나·내 사주"는 막고 "아이·아이의 사주"는 막지 않는다', () => {
    const r = (t: string) => findForbidden(t, CHILD_VOICE_FORBIDDEN).length;
    expect(r('나를 뺀 5글자 중 2개가 있어요.')).toBe(1);
    expect(r('내 사주에 없던 불이 들어와요.')).toBe(1);
    expect(r('아이를 나타내는 글자를 뺀 5글자 중 2개가 있어요.')).toBe(0);
    expect(r('아이의 사주에 없던 불이 들어와요.')).toBe(0);
  });

  it('5세 이하: 약속·책임 풀이는 막고, 묶음 이름 "규칙·책임"과 일과·순서·습관 풀이는 막지 않는다', () => {
    const r = (t: string) => findForbidden(t, TODDLER_FORBIDDEN).length;
    expect(r('가족과 한 약속을 소중히 여기는 모습을 보일 수 있어요.')).toBe(1);
    expect(r('맡은 일에 책임감을 느끼는 편이에요.')).toBe(1);
    expect(r('규칙·책임을 뜻하는 글자가 2개 있어서, 하루 일과가 일정할 때 편안해하는 편이에요.')).toBe(0);
    expect(r('규칙 · 책임을 뜻하는 글자라 반복되는 순서를 좋아할 수 있어요.')).toBe(0);
    expect(r('규칙과 책임을 뜻하는 글자라 하루 순서가 일정할 때 편안해해요.')).toBe(0);
  });

  it('기본 호출: 5세 이하 안내와 대운별 나이 안내를 넣는다', async () => {
    const t = new FakeTransport(validResponder(indices));
    await generateReport({ chart, evidence, topicIds: [], referenceYear: SAMPLE_REFERENCE_YEAR, transport: t, moderator: new FakeModerator(), asOf: SAMPLE_AS_OF });
    const user = t.requests[0]!.user;
    expect(user).toContain('- 만 5세 이하: 규칙·책임을 뜻하는 글자는 하루 일과·반복되는 순서·습관으로');
    expect(user).toMatch(/daewoonIndex 0: 만 9~18세 → 그 나이대/u);
  });

  it('13세 이후 대운 칸은 그 나이대 말(공부·진로)을 쓸 수 있고, 부모가 돌보는 칸은 여전히 막는다', async () => {
    const study = (s: { text: string; evidenceIds: string[] }) => ({ ...s, text: '청소년기에는 공부와 진로를 넓혀 가는 흐름으로 볼 수 있어요.' });
    const base = validResponder(indices);
    const t = new FakeTransport((req, call) => {
      const r = base(req, call) as { body: any };
      const b = r.body;
      return { body: { ...b, daewoonNotes: b.daewoonNotes.map((n: any) => ({ ...n, sentences: [study(n.sentences[0]), ...n.sentences.slice(1)] })) } };
    });
    const r = await generateReport({ chart, evidence, topicIds: [], referenceYear: SAMPLE_REFERENCE_YEAR, transport: t, moderator: new FakeModerator(), asOf: SAMPLE_AS_OF });
    expect(r.attempts.filter((a) => a.label === 'base')).toHaveLength(1);
    expect(r.body.audience).toBe('child');
    expect(r.body.summary[0]!.text.startsWith('아이를 나타내는 글자가')).toBe(true);
  });

  it('사실 카드도 "아이"로 부른다', () => {
    const body = {
      summary: summaryTemplate(chart, { child: true }), traits: [], topics: {}, daewoonNotes: [],
      yearly: { thisYear: [{ text: 'x', evidenceIds: ['seun[0]', 'tenGodGroup.gwanseong'] }], nextYear: [] }, audience: 'child' as const,
    };
    const view = buildReportView({ chart, evidence, body, topicIds: [], name: null, birthLabel: '' });
    const texts = view.evidence.map((e) => e.content).join('\n');
    expect(texts).toContain('아이를 나타내는 글자');
    expect(texts).not.toMatch(/나를 나타내는|내 사주|나에게는/u);
  });
});

describe('D-046: 13세 이후 대운 칸의 "아이", 5세 이하 용돈, 아이 주제 이름', () => {
  const chart = charts.find((c) => c.solarDate.year === 2024)!;
  const evidence = buildEvidence(chart);
  const indices = targetDaewoonIndices(chart, SAMPLE_REFERENCE_YEAR, REPORT_LAYOUT.daewoonNoteCount);

  it('13세 이후 대운 칸에서 "아이"라고 부르면 다시 만든다("아이디어"는 괜찮다)', async () => {
    const base = validResponder(indices);
    let calls = 0;
    const t = new FakeTransport((req, call) => {
      const r = base(req, call) as { body: any };
      if (req.label !== 'base') return r;
      calls++;
      const text = calls === 1 ? '청소년기의 아이는 생각이 깊어지는 편이에요.' : '청소년기에는 아이디어가 많아지는 편이에요.';
      return { body: { ...r.body, daewoonNotes: r.body.daewoonNotes.map((n: any) => ({ ...n, sentences: [{ ...n.sentences[0], text }, ...n.sentences.slice(1)] })) } };
    });
    const r = await generateReport({ chart, evidence, topicIds: [], referenceYear: SAMPLE_REFERENCE_YEAR, transport: t, moderator: new FakeModerator(), asOf: SAMPLE_AS_OF });
    expect(r.attempts.filter((a) => a.label === 'base')[0]!.violations.map((v) => v.code)).toContain('forbidden');
    expect(calls).toBe(2);
  });

  it('5세 이하는 용돈 이야기를 막는다(6세 이상 규칙에는 없다)', () => {
    expect(findForbidden('용돈을 아껴 쓰는 모습을 보일 수 있어요.', [TODDLER_MONEY_FORBIDDEN])).toHaveLength(1);
    expect(findForbidden('용돈을 아껴 쓰는 모습을 보일 수 있어요.', CHILD_FORBIDDEN)).toEqual([]);
  });

  it('아이 사주는 주제 이름이 물건·돈 습관 / 재능·배움 / 관계이고, 가격은 같다', () => {
    const adult = priceFor(['wealth', 'career', 'love']);
    const kid = priceFor(['wealth', 'career', 'love'], PRICES, { child: true });
    expect(kid.topics.map((t) => t.label)).toEqual(['물건·돈 습관', '재능·배움', '관계']);
    expect(kid.total).toBe(adult.total);
  });
});

describe('D-046: 아이 리포트 화면의 주제 이름', () => {
  it('audience가 child면 주제 소제목을 아이용 이름으로 쓴다', () => {
    const chart = charts.find((c) => c.solarDate.year === 2024)!;
    const evidence = buildEvidence(chart);
    const s = [{ text: 'x', evidenceIds: ['seun[0]'] }];
    const body = { summary: summaryTemplate(chart, { child: true }), traits: [], topics: { wealth: s }, daewoonNotes: [], yearly: { thisYear: s, nextYear: s } };
    const titles = (b: any) => buildReportView({ chart, evidence, body: b, topicIds: ['wealth'], name: null, birthLabel: '' }).sections.find((x) => x.id === 'topics')!.groups.map((g) => g.subtitle);
    expect(titles({ ...body, audience: 'child' })).toEqual(['물건·돈 습관']);
    expect(titles(body)).toEqual(['재물']);
  });
});

describe('D-046 리뷰: 아이 안내의 용돈 문구, "아이" 금지의 예외', () => {
  it('5세 이하에는 용돈 허용 문구가 없고 6세 이상에만 있다', async () => {
    const chart = charts.find((c) => c.solarDate.year === 2024)!;
    const evidence = buildEvidence(chart);
    const indices = targetDaewoonIndices(chart, SAMPLE_REFERENCE_YEAR, REPORT_LAYOUT.daewoonNoteCount);
    const t = new FakeTransport(validResponder(indices));
    await generateReport({ chart, evidence, topicIds: [], referenceYear: SAMPLE_REFERENCE_YEAR, transport: t, moderator: new FakeModerator(), asOf: SAMPLE_AS_OF });
    expect(t.requests[0]!.user).not.toContain('용돈을 다루는 모습은 쓸 수 있습니다');
    const t2 = new FakeTransport(validResponder(indices));
    await generateReport({ chart, evidence, topicIds: [], referenceYear: SAMPLE_REFERENCE_YEAR, transport: t2, moderator: new FakeModerator(), asOf: new Date('2032-06-01T12:00:00+09:00') });
    expect(t2.requests[0]!.user).toContain('용돈을 다루는 모습은 쓸 수 있습니다');
  });
  it('"아이템·아이콘·아이스크림"은 막지 않는다', () => {
    for (const t of ['아이템을 고르는 감각이 좋아요.', '아이콘처럼 눈에 띄어요.', '아이스크림 같은 작은 보상도 좋아요.']) expect(findForbidden(t, GROWN_NOTE_FORBIDDEN)).toEqual([]);
    expect(findForbidden('청소년기의 아이는 생각이 깊어져요.', GROWN_NOTE_FORBIDDEN)).toHaveLength(1);
  });
});
