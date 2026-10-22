// AnthropicTransport: 요청 형식과 사용량 해석 (SDK 클라이언트를 가짜로 바꿔 끼운다, 실제 호출 없음)
import { describe, expect, it } from 'vitest';
import { costUsd } from '../../src/llm/pricing';
import { AnthropicTransport, type MessagesClient } from '../../src/llm/transport';

function fakeClient(response: unknown) {
  const calls: unknown[] = [];
  const client = {
    beta: { messages: { create: async (params: unknown) => (calls.push(params), response) } },
  } as unknown as MessagesClient;
  return { client, calls };
}

const req = { system: 'SYS', user: 'USER', jsonSchema: { type: 'object' }, label: 'base' };

describe('AnthropicTransport', () => {
  it('거절 폴백·구조화 출력·노력도·시스템 캐시를 넣어 요청한다', async () => {
    const { client, calls } = fakeClient({
      model: 'claude-opus-5-5',
      stop_reason: 'end_turn',
      content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: '{"a":1}' }],
      usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: null, cache_creation_input_tokens: null },
    });
    const t = new AnthropicTransport('claude-opus-5-5', client);
    const res = await t.complete(req);
    expect(calls[0]).toMatchObject({
      model: 'claude-opus-5-5',
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: { type: 'object' } } },
      system: [{ type: 'text', text: 'SYS', cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: 'USER' }],
    });
    expect(res).toEqual({
      text: '{"a":1}',
      stopReason: 'end_turn',
      servedModel: 'claude-opus-5-5',
      usage: [{ model: 'claude-opus-5-5', inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 }],
    });
  });

  it('폴백이 돌면 모델별 사용량(iterations)을 따로 돌려준다', async () => {
    const { client } = fakeClient({
      model: 'claude-opus-5',
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: '{}' }],
      usage: {
        input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0,
        iterations: [
          { type: 'message', model: 'claude-opus-5-5', input_tokens: 100, output_tokens: 3, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cache_creation: null },
          { type: 'fallback_message', model: 'claude-opus-5', input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cache_creation: null },
        ],
      },
    });
    const res = await new AnthropicTransport('claude-opus-5-5', client).complete(req);
    expect(res.servedModel).toBe('claude-opus-5');
    expect(res.usage.map((u) => [u.model, u.outputTokens])).toEqual([['claude-opus-5-5', 3], ['claude-opus-5', 50]]);
  });

  it('API 키가 없으면 바로 실패하고, 모델은 LLM_MODEL > 기본값(Sonnet 5.5) 순으로 정한다', () => {
    const saved = { m: process.env.LLM_MODEL, k: process.env.LLM_API_KEY };
    delete process.env.LLM_MODEL;
    delete process.env.LLM_API_KEY;
    try {
      expect(() => new AnthropicTransport()).toThrow('LLM_API_KEY');
      const { client } = fakeClient({});
      expect(new AnthropicTransport(undefined, client).model).toBe('claude-sonnet-5-5');
      process.env.LLM_MODEL = 'claude-opus-5-5';
      expect(new AnthropicTransport(undefined, client).model).toBe('claude-opus-5-5');
    } finally {
      if (saved.m !== undefined) process.env.LLM_MODEL = saved.m;
      if (saved.k !== undefined) process.env.LLM_API_KEY = saved.k;
    }
  });
});

describe('costUsd', () => {
  it('단가표대로 계산하고, 모르는 모델은 null', () => {
    const u = { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 1_000_000, cacheWriteTokens: 1_000_000 };
    expect(costUsd({ model: 'claude-opus-5-5', ...u })).toBeCloseTo(4 + 20 + 0.2 + 5);
    expect(costUsd({ model: 'claude-sonnet-5-5', ...u })).toBeCloseTo(2 + 10 + 0.2 + 2.5);
    expect(costUsd({ model: 'unknown-model', ...u })).toBeNull();
  });
});

describe('요청 시간 제한·재시도 (D-046)', () => {
  const response = { model: 'claude-sonnet-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: '{}' }], usage: { input_tokens: 1, output_tokens: 1 } };
  const withOpts = () => {
    const opts: unknown[] = [];
    const client = { beta: { messages: { create: async (_p: unknown, o: unknown) => (opts.push(o), response) } } } as unknown as MessagesClient;
    return { client, opts };
  };
  it('생성 호출은 90초, 재시도 1번', async () => {
    const { client, opts } = withOpts();
    await new AnthropicTransport('claude-sonnet-5-5', client).complete(req);
    expect(opts[0]).toMatchObject({ timeout: 90_000, maxRetries: 1 });
  });
  it('검수 호출처럼 시간 제한을 주면 그 값을 쓴다', async () => {
    const { client, opts } = withOpts();
    await new AnthropicTransport('claude-haiku-5-5', client, { fallback: false, timeoutMs: 30_000 }).complete(req);
    expect(opts[0]).toMatchObject({ timeout: 30_000, maxRetries: 1 });
  });
});
