// 테스트용 가짜 LLM. 실제 API를 부르지 않는다.
import { REPORT_LAYOUT } from '../../src/config/report';
import { ModerationUnavailable, type ModerationItem, type ModerationResult, type Moderator } from '../../src/llm/moderation';
import type { LlmRequest, LlmResponse, LlmTransport } from '../../src/llm/transport';
import type { BaseDraft, ReportSentence, TopicDraft } from '../../src/llm/types';

export type Responder = (req: LlmRequest, call: number) => Partial<LlmResponse> & { body?: unknown };

export class FakeTransport implements LlmTransport {
  readonly model = 'claude-opus-5-5';
  readonly requests: LlmRequest[] = [];

  constructor(
    private readonly respond: Responder,
    /** 라벨별 응답 지연(ms). 지연 중 signal이 중단되면 SDK처럼 거부한다 */
    private readonly delayMs: (label: string) => number = () => 0,
  ) {}

  async complete(req: LlmRequest, signal?: AbortSignal): Promise<LlmResponse> {
    this.requests.push(req);
    const ms = this.delayMs(req.label);
    if (ms > 0) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener('abort', () => (clearTimeout(timer), reject(new Error('aborted'))), { once: true });
      });
    }
    const r = this.respond(req, this.requests.length);
    return {
      text: r.text !== undefined ? r.text : JSON.stringify(r.body),
      stopReason: r.stopReason ?? 'end_turn',
      servedModel: r.servedModel ?? this.model,
      usage: r.usage ?? [{ model: this.model, inputTokens: 1000, outputTokens: 500, cacheReadTokens: 0, cacheWriteTokens: 0 }],
    };
  }
}

/** 사용자 메시지의 근거 목록에서 id를 읽는다 */
export function evidenceIdsIn(user: string): string[] {
  const json = user.slice(user.indexOf('['), user.indexOf('\n## 작성할 칸') - 1);
  return (JSON.parse(json) as { id: string }[]).map((e) => e.id);
}

function sentences(n: number, ids: string[]): ReportSentence[] {
  return Array.from({ length: n }, (_, i) => ({
    text: `근거를 바탕으로 쓴 ${i + 1}번째 문장이에요.`,
    evidenceIds: [ids[i % ids.length]!],
  }));
}

export function validBase(daewoonIndices: number[], ids: string[]): BaseDraft {
  const L = REPORT_LAYOUT;
  return {
    summary: sentences(L.summaryAiSentences, ids),
    traits: sentences(L.traitsSentences, ids),
    daewoonNotes: daewoonIndices.map((d) => ({
      daewoonIndex: d,
      sentences: sentences(L.daewoonNoteSentences, [`daewoon[${d}]`]),
    })),
    yearly: {
      thisYear: sentences(L.yearlySentences, ['seun[0]']),
      nextYear: sentences(L.yearlySentences, ['seun[1]']),
    },
  };
}

export function validTopic(ids: string[]): TopicDraft {
  return { sentences: sentences(REPORT_LAYOUT.topicSentences, ids) };
}

/** 요청 종류에 맞는 정상 응답을 돌려주는 가짜 모델 */
export function validResponder(daewoonIndices: number[]): Responder {
  return (req) => {
    const ids = evidenceIdsIn(req.user).filter((id) => id === 'dayMaster' || id.startsWith('elements.') || id.startsWith('tenGodGroup.'));
    return { body: req.label === 'base' ? validBase(daewoonIndices, ids) : validTopic(ids) };
  };
}

/** 가짜 AI 검수기: 응답 함수가 정한 대로 판정하고, 받은 문장을 모두 기록한다 */
export class FakeModerator implements Moderator {
  readonly reviewed: ModerationItem[][] = [];
  constructor(
    private readonly decide: (items: readonly ModerationItem[], call: number) => ModerationResult | 'fail' = () => ({
      flags: [],
      calls: [{ attempt: 1, ok: true, usage: [{ model: 'claude-haiku-5-5', inputTokens: 300, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0 }] }],
    }),
  ) {}

  async review(items: readonly ModerationItem[]): Promise<ModerationResult> {
    this.reviewed.push([...items]);
    const r = this.decide(items, this.reviewed.length);
    if (r === 'fail') {
      throw new ModerationUnavailable([1, 2, 3].map((attempt) => ({ attempt, ok: false, failure: 'apiError' as const, usage: [] })));
    }
    return r;
  }
}
