// AI 검수(2차 필터): 정규식을 통과한 문장만 검수하고, 걸리면 다시 생성하며, 검수 실패는 생성 실패로 처리한다
import { describe, expect, it } from 'vitest';
import { REPORT_LAYOUT } from '../../src/config/report';
import { buildChart } from '../../src/engine/chart';
import { buildEvidence } from '../../src/engine/evidence';
import { targetDaewoonIndices } from '../../src/llm/evidenceSelect';
import { GenerationError, generateReport } from '../../src/llm/generate';
import { LlmModerator, MODERATION_MAX_ATTEMPTS, ModerationUnavailable } from '../../src/llm/moderation';
import { SAMPLE_INPUTS, SAMPLE_REFERENCE_YEAR } from '../../src/llm/samples';
import { summaryTemplate } from '../../src/report/summaryTemplate';
import { FakeModerator, FakeTransport, validBase, validResponder, validTopic } from './fakes';

const chart = buildChart(SAMPLE_INPUTS[0]!, { referenceYear: SAMPLE_REFERENCE_YEAR });
const evidence = buildEvidence(chart);
const indices = targetDaewoonIndices(chart, SAMPLE_REFERENCE_YEAR, REPORT_LAYOUT.daewoonNoteCount);
const run = (t: FakeTransport, m: FakeModerator, topicIds: string[] = ['wealth']) =>
  generateReport({ chart, evidence, topicIds, referenceYear: SAMPLE_REFERENCE_YEAR, transport: t, moderator: m });
const okReview = () => ({ flags: [], calls: [{ attempt: 1, ok: true, usage: [] }] });

describe('generateReport + AI 검수', () => {
  it('정규식을 통과한 AI 문장만 검수하고, 템플릿 문장은 넘기지 않는다', async () => {
    const m = new FakeModerator();
    await run(new FakeTransport(validResponder(indices)), m);
    const texts = m.reviewed.flat().map((x) => x.text);
    const L = REPORT_LAYOUT;
    expect(texts.length).toBe(
      L.summaryAiSentences + L.traitsSentences + 2 * L.daewoonNoteSentences + 2 * L.yearlySentences + L.topicSentences,
    );
    for (const t of summaryTemplate(chart)) expect(texts).not.toContain(t.text);
  });

  it('정규식에서 걸린 시도는 검수하지 않는다', async () => {
    let n = 0;
    const t = new FakeTransport((req) =>
      req.label === 'base'
        ? { body: validBase(indices, ['dayMaster']) }
        : {
            body: n++ === 0
              ? { sentences: [{ text: '주식에 투자하세요.', evidenceIds: ['dayMaster'] }] }
              : validTopic(['dayMaster']),
          },
    );
    const m = new FakeModerator();
    const r = await run(t, m);
    const topicAttempts = r.attempts.filter((a) => a.label === 'topic:wealth');
    expect(topicAttempts[0]!.violations.length).toBeGreaterThan(0);
    expect(topicAttempts[0]!.moderation).toBeUndefined();
    expect(m.reviewed).toHaveLength(2); // 기본 리포트 1회 + 주제 2번째 시도 1회
  });

  it('검수에서 걸리면 범주와 위치만 알려 주고 다시 생성한다 (원문은 기록하지 않음)', async () => {
    let topicReviews = 0;
    const m = new FakeModerator((items) => {
      if (!items[0]!.path.startsWith('topics.')) return okReview();
      topicReviews++;
      return topicReviews === 1
        ? { flags: [{ path: items[1]!.path, categories: ['investment'] }], calls: [{ attempt: 1, ok: true, usage: [] }] }
        : okReview();
    });
    const t = new FakeTransport(validResponder(indices));
    const r = await run(t, m);
    const topic = r.attempts.filter((a) => a.label === 'topic:wealth');
    expect(topic).toHaveLength(2);
    expect(topic[0]!.violations).toEqual([
      { code: 'aiFlagged', path: 'topics.wealth[1]', detail: 'AI 검수: 투자 권유·재물 손실 단정' },
    ]);
    expect(topic[0]!.moderation?.flags).toEqual([{ path: 'topics.wealth[1]', categories: ['investment'] }]);
    const retry = t.requests.filter((q) => q.label === 'topic:wealth')[1]!;
    expect(retry.user).toContain('AI 검수: 투자 권유·재물 손실 단정');
    // 시도 기록에 문장 원문이 들어가지 않는다
    expect(JSON.stringify(r.attempts)).not.toContain('번째 문장이에요');
  });

  it('검수 호출이 끝내 실패하면 통과시키지 않고 생성 실패(moderationUnavailable)로 끝낸다', async () => {
    const m = new FakeModerator(() => 'fail');
    const t = new FakeTransport(validResponder(indices));
    const err = (await run(t, m).catch((e: unknown) => e)) as GenerationError;
    expect(err).toBeInstanceOf(GenerationError);
    expect(err.reason).toBe('moderationUnavailable');
    // 문장 문제가 아니므로 다시 생성하지 않는다
    expect(t.requests.filter((q) => q.label === err.label)).toHaveLength(1);
    const rec = err.attempts.find((a) => a.label === err.label)!;
    expect(rec.moderation?.calls.length).toBe(MODERATION_MAX_ATTEMPTS);
    expect(rec.moderation?.calls.every((c) => !c.ok)).toBe(true);
  });

  it('3회 모두 검수에 걸리면 검증 실패로 끝난다', async () => {
    const m = new FakeModerator((items) => ({
      flags: [{ path: items[0]!.path, categories: ['medical'] }],
      calls: [{ attempt: 1, ok: true, usage: [] }],
    }));
    const err = (await run(new FakeTransport(validResponder(indices)), m, []).catch((e: unknown) => e)) as GenerationError;
    expect(err.reason).toBe('validation');
    expect(err.attempts.filter((a) => a.label === 'base')).toHaveLength(3);
  });
});

describe('LlmModerator', () => {
  const items = [
    { path: 'traits[0]', text: 'A' },
    { path: 'traits[1]', text: 'B' },
  ];
  const usage = [{ model: 'claude-haiku-5-5', inputTokens: 100, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 }];
  const signal = new AbortController().signal;

  it('모든 index에 대한 판정을 받아 걸린 문장만 돌려준다', async () => {
    const t = new FakeTransport(() => ({
      body: { results: [{ index: 0, categories: [] }, { index: 1, categories: ['disaster'] }] },
      usage,
    }));
    const r = await new LlmModerator(t).review(items, signal);
    expect(r.flags).toEqual([{ path: 'traits[1]', categories: ['disaster'] }]);
    expect(r.calls).toEqual([{ attempt: 1, ok: true, usage }]);
    expect(t.requests[0]!.label).toBe('moderation');
  });

  it.each([
    ['index 누락', { results: [{ index: 0, categories: [] }] }],
    ['index 중복', { results: [{ index: 0, categories: [] }, { index: 0, categories: [] }] }],
    ['범위 밖 index', { results: [{ index: 0, categories: [] }, { index: 5, categories: [] }] }],
    ['모르는 범주', { results: [{ index: 0, categories: ['other'] }, { index: 1, categories: [] }] }],
  ])('%s → 재시도, 끝내 실패하면 ModerationUnavailable', async (_name, body) => {
    const t = new FakeTransport(() => ({ body, usage }));
    const err = await new LlmModerator(t).review(items, signal).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ModerationUnavailable);
    expect((err as ModerationUnavailable).calls.map((c) => c.failure)).toEqual(
      Array(MODERATION_MAX_ATTEMPTS).fill('invalidResponse'),
    );
    expect(t.requests).toHaveLength(MODERATION_MAX_ATTEMPTS);
  });

  it('API 오류·거절 뒤에 정상 응답이 오면 통과', async () => {
    let n = 0;
    const t = new FakeTransport(() => {
      n++;
      if (n === 1) throw new Error('500');
      if (n === 2) return { stopReason: 'refusal', text: null, usage };
      return { body: { results: [{ index: 0, categories: [] }, { index: 1, categories: [] }] }, usage };
    });
    const r = await new LlmModerator(t).review(items, signal);
    expect(r.calls.map((c) => [c.ok, c.failure])).toEqual([
      [false, 'apiError'],
      [false, 'refusal'],
      [true, undefined],
    ]);
    expect(r.flags).toEqual([]);
  });

  it('기록에 문장 원문이 들어가지 않는다', async () => {
    const t = new FakeTransport(() => ({
      body: { results: [{ index: 0, categories: ['medical'] }, { index: 1, categories: [] }] },
      usage,
    }));
    const r = await new LlmModerator(t).review(
      [
        { path: 'p', text: '비밀문장A' },
        { path: 'q', text: '비밀문장B' },
      ],
      signal,
    );
    expect(JSON.stringify(r)).not.toContain('비밀문장');
  });
});
