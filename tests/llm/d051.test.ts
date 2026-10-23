// D-051: 아이 리포트 근거 문구, 옮겨 쓰기·얇은 끝맺음은 기록만, 과거 이력 단정(하드), 개수 기준 두 번 쓰기(soft, 첫 시도만)
// (가짜 LLM, 실제 호출 없음)
import { describe, expect, it } from 'vitest';
import { REPORT_LAYOUT } from '../../src/config/report';
import { buildChart } from '../../src/engine/chart';
import { buildEvidence, childVoiceEvidence } from '../../src/engine/evidence';
import { targetDaewoonIndices } from '../../src/llm/evidenceSelect';
import { COMMON_FORBIDDEN, findForbidden } from '../../src/llm/forbidden';
import { generateReport } from '../../src/llm/generate';
import { SAMPLE_AS_OF, SAMPLE_INPUTS, SAMPLE_REFERENCE_YEAR } from '../../src/llm/samples';
import { validateDoubleBase } from '../../src/llm/validate';
import { FakeModerator, FakeTransport, validResponder } from './fakes';

const adultChart = buildChart(SAMPLE_INPUTS[0]!, { referenceYear: SAMPLE_REFERENCE_YEAR });
const childChart = buildChart(SAMPLE_INPUTS[4]!, { referenceYear: SAMPLE_REFERENCE_YEAR });

describe('1) 아이 리포트 근거 문구', () => {
  it('만 12세 이하는 "일간(나를 나타내는 글자)을 뺀"을 "아이를 나타내는 글자를 뺀"으로, 어른은 그대로', () => {
    const child = buildEvidence(childChart, { child: true });
    const groups = child.filter((e) => e.kind === 'tenGodGroup');
    expect(groups.every((e) => e.content.includes('아이를 나타내는 글자를 뺀') && !e.content.includes('나를 나타내는'))).toBe(true);
    expect(child.find((e) => e.id === 'dayMaster')!.content).toMatch(/^일간\(아이를 나타내는 글자\)은/u);
    expect(child.some((e) => /나를 나타내는|나를 뺀/u.test(e.content))).toBe(false);
    const adult = buildEvidence(adultChart);
    expect(adult.find((e) => e.kind === 'tenGodGroup')!.content).toContain('일간(나를 나타내는 글자)을 뺀');
    expect(adult.find((e) => e.id === 'dayMaster')!.content).toMatch(/^일간\(나를 나타내는 글자\)은/u);
  });
  it('문구만 바뀌고 id·인용 표기·숫자는 같다(두 번 바꿔도 같다)', () => {
    const a = buildEvidence(childChart);
    const c = buildEvidence(childChart, { child: true });
    expect(c.map((e) => [e.id, e.terms, e.chartRefs])).toEqual(a.map((e) => [e.id, e.terms, e.chartRefs]));
    expect(c.map(childVoiceEvidence)).toEqual(c);
  });
  it('아이 리포트 생성 호출에는 어른 근거를 넘겨도 아이 호칭 근거가 들어간다', async () => {
    const indices = targetDaewoonIndices(childChart, SAMPLE_REFERENCE_YEAR, REPORT_LAYOUT.daewoonNoteCount);
    const t = new FakeTransport(validResponder(indices));
    await generateReport({ chart: childChart, evidence: buildEvidence(childChart), topicIds: ['wealth'], referenceYear: SAMPLE_REFERENCE_YEAR, transport: t, moderator: new FakeModerator(), asOf: SAMPLE_AS_OF });
    for (const q of t.requests) {
      expect(q.user).not.toContain('일간(나를 나타내는 글자)');
      expect(q.user).toContain('아이를 나타내는 글자');
    }
  });
});

describe('2) 각도 옮겨 쓰기·합·충 얇은 끝맺음은 다시 쓰지 않고 기록만', () => {
  it('기본 칸에 두 꼴이 있어도 한 번에 끝나고, 본문에 걸린 문장 수를 남긴다', async () => {
    const indices = targetDaewoonIndices(adultChart, SAMPLE_REFERENCE_YEAR, REPORT_LAYOUT.daewoonNoteCount);
    const ok = validResponder(indices);
    const t = new FakeTransport((req, call) => {
      const r = ok(req, call) as { body: any };
      if (req.label !== 'base') return r;
      const traits = r.body.traits.map((x: any, i: number) =>
        i === 0 ? { ...x, text: '이름을 걸고 맡은 일을 해내는 편이에요.' } : i === 1 ? { ...x, text: '두 글자가 서로 어우러지는 모습이 보여요.' } : x,
      );
      return { body: { ...r.body, traits } };
    });
    const r = await generateReport({ chart: adultChart, evidence: buildEvidence(adultChart), topicIds: [], referenceYear: SAMPLE_REFERENCE_YEAR, transport: t, moderator: new FakeModerator(), asOf: SAMPLE_AS_OF });
    expect(t.requests.filter((q) => q.label === 'base')).toHaveLength(1);
    expect(r.body.observed).toMatchObject({ angleCopy: 1, thinRelation: 1 });
  });
});

describe('3) 과거 이력 단정(하드)', () => {
  const hit = (t: string) => findForbidden(t, COMMON_FORBIDDEN).some((f) => f.reason.startsWith('근거에 없는 과거 이력 단정') || f.reason.includes('시기·자리 해석'));
  it('막는 꼴', () => {
    for (const t of [
      '돈을 다뤄 온 감각이 있는 편이에요.', '일찍부터 이 감각을 익혀 온 편이에요.', '꾸준히 해 온 일이 힘이 돼요.', '이런 방식으로 지켜 왔어요.',
      '정리하는 일이 습관이 된 편이에요.', '감각이 몸에 밴 편이에요.', '절약이 몸에 배어 있어요.', '어려서부터 손재주가 있는 편이에요.', '예전부터 사람을 잘 챙겨요.',
    ]) expect(hit(t), t).toBe(true);
  });
  it('앞으로 권하는 말과 흔한 "~이 된"은 통과', () => {
    for (const t of [
      '아침을 일찍부터 챙겨 먹는 습관을 길러 보면 좋아요.', '일찍부터 시작하면 익숙해져요.', '정리하는 습관이 몸에 배도록 하루 한 번 해 보세요.',
      '이 기운이 도움이 된 해로 볼 수 있어요.', '흐름이 이어 오는 해예요.', '새로운 일이 다가온다고 볼 수 있어요.', '습관이 되도록 작게 시작해 보세요.',
      // 리뷰 반영
      '꾸준히 하면 습관이 된다고 해요.', '반복하면 습관이 된답니다.', '새해 온 가족이 함께 모이는 자리예요.', '올해 온 가족과 나누는 시간이 늘어요.',
    ]) expect(hit(t), t).toBe(false);
    for (const t of ['꾸준히 노력해 온 편이에요.', '혼자 해 왔어요.', '정리가 습관이 된 편이에요.']) expect(hit(t), t).toBe(true);
  });
});

describe('3) 한 문장에 개수 기준 두 번 (soft, 첫 시도만)', () => {
  it('"내 사주 8글자 중 … 나를 뺀 7글자 중"은 잡고, 기준 하나면 통과', () => {
    expect(validateDoubleBase([{ path: 'p', text: '내 사주 8글자 중 표현·재능을 뜻하는 글자가 나를 뺀 7글자 중 3개나 있어요.' }]).map((v) => v.code)).toEqual(['doubleBase']);
    expect(validateDoubleBase([{ path: 'p', text: '아이의 사주 6글자 중 … 아이를 나타내는 글자를 뺀 5글자 중 2개예요.' }])).toHaveLength(1);
    expect(validateDoubleBase([{ path: 'p', text: '나를 뺀 7글자 중 3개나 있어요.' }])).toEqual([]);
  });
  it('생성에서는 한 번만 다시 쓰게 한다', async () => {
    const indices = targetDaewoonIndices(adultChart, SAMPLE_REFERENCE_YEAR, REPORT_LAYOUT.daewoonNoteCount);
    const ok = validResponder(indices);
    let topicCalls = 0;
    const t = new FakeTransport((req, call) => {
      const r = ok(req, call) as { body: any };
      if (req.label !== 'topic:wealth') return r;
      topicCalls++;
      return { body: { sentences: r.body.sentences.map((x: any, i: number) => (i === 0 ? { ...x, text: '8글자 중 하나, 7글자 중 둘을 견줘 보는 편이에요.' } : x)) } };
    });
    const r = await generateReport({ chart: adultChart, evidence: buildEvidence(adultChart), topicIds: ['wealth'], referenceYear: SAMPLE_REFERENCE_YEAR, transport: t, moderator: new FakeModerator(), asOf: SAMPLE_AS_OF });
    expect(topicCalls).toBe(2);
    expect(r.attempts.filter((a) => a.label === 'topic:wealth')[0]!.violations.map((v) => v.code)).toContain('doubleBase');
  });
});
