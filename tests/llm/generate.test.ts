// 풀이 생성 흐름 (가짜 LLM, 실제 호출 없음)
import { describe, expect, it } from 'vitest';
import { REPORT_LAYOUT } from '../../src/config/report';
import { findTopic } from '../../src/config/topics';
import { buildChart } from '../../src/engine/chart';
import { buildEvidence } from '../../src/engine/evidence';
import { targetDaewoonIndices, topicEvidence } from '../../src/llm/evidenceSelect';
import { GenerationError, GenerationInterrupted, generateReport } from '../../src/llm/generate';
import { SAMPLE_INPUTS, SAMPLE_REFERENCE_YEAR } from '../../src/llm/samples';
import { summaryTemplate } from '../../src/report/summaryTemplate';
import { FakeModerator, FakeTransport, evidenceIdsIn, validBase, validResponder, validTopic } from './fakes';

const chart = buildChart(SAMPLE_INPUTS[0]!, { referenceYear: SAMPLE_REFERENCE_YEAR });
const evidence = buildEvidence(chart);
const indices = targetDaewoonIndices(chart, SAMPLE_REFERENCE_YEAR, REPORT_LAYOUT.daewoonNoteCount);
const args = (transport: FakeTransport, topicIds: string[], moderator: FakeModerator = new FakeModerator()) => ({
  chart, evidence, topicIds, referenceYear: SAMPLE_REFERENCE_YEAR, transport, moderator,
});

describe('generateReport', () => {
  it('기본 리포트 + 선택한 주제만 호출하고, 총평은 템플릿 문장으로 시작한다', async () => {
    const t = new FakeTransport(validResponder(indices));
    const r = await generateReport(args(t, ['wealth']));
    expect(t.requests.map((q) => q.label).sort()).toEqual(['base', 'topic:wealth']);
    expect(Object.keys(r.body.topics)).toEqual(['wealth']);
    const template = summaryTemplate(chart);
    expect(r.body.summary.slice(0, 2)).toEqual(template);
    expect(r.body.summary).toHaveLength(REPORT_LAYOUT.summaryTemplateSentences + REPORT_LAYOUT.summaryAiSentences);
    expect(r.attempts.every((a) => a.attempt === 1 && a.violations.length === 0)).toBe(true);
  });

  it('주제를 고르지 않으면 기본 리포트만 호출한다', async () => {
    const t = new FakeTransport(validResponder(indices));
    const r = await generateReport(args(t, []));
    expect(t.requests.map((q) => q.label)).toEqual(['base']);
    expect(r.body.topics).toEqual({});
  });

  it('없는 주제나 꺼진 주제는 거부한다', async () => {
    const t = new FakeTransport(validResponder(indices));
    await expect(generateReport(args(t, ['health']))).rejects.toThrow('사용할 수 없는 주제');
    expect(t.requests).toHaveLength(0);
  });

  it('주제 호출: 1차 거부 → 2차 통과, 재시도 메시지에 위반 내용이 들어간다', async () => {
    let topicCalls = 0;
    const t = new FakeTransport((req) => {
      if (req.label === 'base') return { body: validBase(indices, ['dayMaster']) };
      topicCalls++;
      const ok = validTopic(['seun[0]']);
      return topicCalls === 1 ? { body: { sentences: [{ text: '근거 없는 문장이에요.', evidenceIds: [] }] } } : { body: ok };
    });
    const r = await generateReport(args(t, ['career']));
    const topicAttempts = r.attempts.filter((a) => a.label === 'topic:career');
    expect(topicAttempts.map((a) => a.violations.length > 0)).toEqual([true, false]);
    const retryReq = t.requests.filter((q) => q.label === 'topic:career')[1]!;
    expect(retryReq.user).toContain('이전 응답이 어긴 규칙');
    expect(retryReq.user).toContain('근거 id 없음');
  });

  it('3회 모두 실패하면 GenerationError (시도 기록 포함)', async () => {
    const t = new FakeTransport((req) =>
      req.label === 'base' ? { text: '{"summary": 1}' } : { body: validTopic(['seun[0]']) },
    );
    const err = await generateReport(args(t, [])).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GenerationError);
    const ge = err as GenerationError;
    expect(ge.attempts).toHaveLength(3);
    expect(ge.attempts.every((a) => a.violations[0]?.code === 'schema')).toBe(true);
  });

  it('JSON이 아니거나 거절(refusal)·길이 초과면 재시도한다', async () => {
    const replies = [{ text: '이건 JSON이 아니에요' }, { stopReason: 'refusal', text: null }, { stopReason: 'max_tokens', text: '{' }];
    let n = 0;
    const t = new FakeTransport(() => (n < 3 ? replies[n++]! : { body: validBase(indices, ['dayMaster']) }));
    const err = await generateReport(args(t, [])).catch((e: unknown) => e);
    expect((err as GenerationError).attempts.map((a) => a.violations[0]?.code)).toEqual(['schema', 'refusal', 'maxTokens']);
  });

  it('대운 해설은 지정한 대운 순서와 그 대운 근거 인용을 지킨다', async () => {
    const wrong = validBase(indices, ['dayMaster']);
    const swapped = { ...wrong, daewoonNotes: [...wrong.daewoonNotes].reverse() };
    let n = 0;
    const t = new FakeTransport(() => ({ body: n++ === 0 ? swapped : validBase(indices, ['dayMaster']) }));
    const r = await generateReport(args(t, []));
    expect(r.attempts[0]!.violations.map((v) => v.code)).toContain('wrongDaewoon');
    expect(r.attempts).toHaveLength(2);
  });
});

describe('주제별 근거 선택', () => {
  it('주제 호출에는 그 주제 설정의 근거와 공통 근거만 들어간다', async () => {
    const t = new FakeTransport(validResponder(indices));
    await generateReport(args(t, ['wealth', 'career']));
    const wealthIds = evidenceIdsIn(t.requests.find((q) => q.label === 'topic:wealth')!.user);
    const expected = topicEvidence(findTopic('wealth')!, chart, evidence).map((e) => e.id);
    expect(wealthIds).toEqual(expected);
    expect(wealthIds).not.toContain('tenGodGroup.gwanseong');
    expect(wealthIds).toContain('tenGodGroup.jaeseong');
    const careerIds = evidenceIdsIn(t.requests.find((q) => q.label === 'topic:career')!.user);
    expect(careerIds).toContain('pillar.month.branch');
  });

  it('기본 리포트 호출에는 출생 정보 원문이 들어가지 않는다', async () => {
    const t = new FakeTransport(validResponder(indices));
    await generateReport(args(t, ['love']));
    for (const q of t.requests) {
      expect(q.user).not.toMatch(/1990|14:30|05-15|5월 15일/);
      expect(q.system).not.toMatch(/1990/);
    }
  });
});

describe('한 작업이 실패하면', () => {
  it('나머지 작업의 남은 시도를 취소하고, 모든 작업의 시도 기록을 에러에 담는다 (리뷰 재현)', async () => {
    // 기본 리포트는 바로 실패하고, 주제 호출은 느리게(진행 중에 취소된다) 실패하는 응답을 준다
    const t = new FakeTransport(
      (req) => (req.label === 'base' ? { text: '{"summary": 1}' } : { body: { sentences: [] } }),
      (label) => (label === 'base' ? 0 : 50),
    );
    const err = (await generateReport(args(t, ['wealth', 'career', 'love'])).catch((e: unknown) => e)) as GenerationError;
    expect(err).toBeInstanceOf(GenerationError);
    // 취소가 없다면 4작업 × 3회 = 12회 호출된다
    expect(t.requests.length).toBeLessThan(12);
    // 취소된 진행 중 호출은 응답이 없어 시도 기록이 없다. 나머지는 모두 기록된다
    expect(err.attempts.filter((a) => a.label === 'base')).toHaveLength(3);
  });
});

describe('대운 해설 대상', () => {
  const d = chart.daewoon;
  it('연중에 대운이 바뀌면 7월 1일이 속한 대운을 현재로 본다', () => {
    const switching = d[2]!; // 이 대운이 시작되는 해
    const expectedStart = switching.startMonth <= 7 ? 2 : 1;
    expect(targetDaewoonIndices(chart, switching.startYear, 2)).toEqual([expectedStart, expectedStart + 1]);
  });
  it('첫 대운 전이면 첫 두 개, 마지막 대운 이후면 마지막 두 개', () => {
    expect(targetDaewoonIndices(chart, d[0]!.startYear - 5, 2)).toEqual([0, 1]);
    expect(targetDaewoonIndices(chart, d[d.length - 1]!.startYear + 20, 2)).toEqual([d.length - 2, d.length - 1]);
  });
});

describe('검증이 아닌 이유로 멈추면', () => {
  it('원래 오류를 cause로, 그때까지의 시도 기록을 attempts로 담아 GenerationInterrupted를 던진다', async () => {
    const apiError = new Error('429 rate limited');
    let calls = 0;
    const t = new FakeTransport(
      (req) => {
        calls++;
        if (req.label === 'topic:wealth') throw apiError;
        return { body: validBase(indices, ['dayMaster']) }; // 기본 리포트는 바로 성공
      },
      (label) => (label === 'topic:wealth' ? 30 : 0),
    );
    const err = await generateReport(args(t, ['wealth'])).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GenerationInterrupted);
    const gi = err as GenerationInterrupted;
    expect(gi.cause).toBe(apiError);
    // 먼저 끝난 기본 리포트의 결제된 시도가 기록에 남는다 (API 오류 호출은 응답이 없어 기록 없음)
    expect(gi.attempts.map((a) => [a.label, a.attempt])).toEqual([['base', 1]]);
    expect(calls).toBe(2);
  });
});
