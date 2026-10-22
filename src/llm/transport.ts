// LLM 호출 경계. 생성 로직은 이 인터페이스만 알고, 테스트는 가짜 구현을 넣는다(실제 호출 없음).
import Anthropic from '@anthropic-ai/sdk';
import { DEFAULT_LLM_MODEL, GENERATION } from '../config/report';
import type { TokenUsage } from './pricing';

export interface LlmRequest {
  system: string;
  user: string;
  jsonSchema: Record<string, unknown>;
  /** 비용 측정·로그용 이름 (예: base, topic:wealth). 개인 정보는 넣지 않는다 */
  label: string;
}

export interface LlmResponse {
  /** 텍스트 블록을 이어 붙인 JSON 문자열. 없으면 null */
  text: string | null;
  stopReason: string | null;
  /** 실제로 응답한 모델 (폴백이 돌면 요청 모델과 다를 수 있다) */
  servedModel: string;
  /** 모델별 사용량 (폴백이 돌면 여러 개) */
  usage: TokenUsage[];
}

export interface LlmTransport {
  readonly model: string;
  /** signal이 중단되면 진행 중인 요청을 취소한다 */
  complete(req: LlmRequest, signal?: AbortSignal): Promise<LlmResponse>;
}

/** 거절 폴백: API가 거절 유형에 맞는 모델로 같은 요청을 다시 실행한다(사업자 결정 2026-10-20) */
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name}이(가) 설정되지 않았습니다`);
  return v;
}

function toUsage(msg: Anthropic.Beta.BetaMessage): TokenUsage[] {
  const iterations = msg.usage.iterations;
  const fromIterations = (iterations ?? []).flatMap((it): TokenUsage[] =>
    it.type === 'message' || it.type === 'fallback_message'
      ? [{
          model: it.model ?? msg.model,
          inputTokens: it.input_tokens,
          outputTokens: it.output_tokens,
          cacheReadTokens: it.cache_read_input_tokens,
          cacheWriteTokens: it.cache_creation_input_tokens,
        }]
      : [],
  );
  if (fromIterations.length) return fromIterations;
  return [{
    model: msg.model,
    inputTokens: msg.usage.input_tokens,
    outputTokens: msg.usage.output_tokens,
    cacheReadTokens: msg.usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: msg.usage.cache_creation_input_tokens ?? 0,
  }];
}

/** 테스트에서 SDK 클라이언트를 바꿔 끼울 수 있게 쓰는 부분만 좁힌 타입 */
export type MessagesClient = Pick<Anthropic, 'beta'>;

export interface TransportOptions {
  /** 거절 폴백(fallbacks: "default"). Haiku에는 서버 측 폴백이 없어 끈다 */
  fallback?: boolean;
  effort?: 'low' | 'medium' | 'high';
  maxTokens?: number;
  /** 요청 한 번의 시간 제한(ms). SDK 기본(10분) 대신 쓴다(D-046) */
  timeoutMs?: number;
}

export class AnthropicTransport implements LlmTransport {
  private readonly client: MessagesClient;
  private readonly options: Required<TransportOptions>;

  /** model을 주지 않으면 LLM_MODEL 환경변수, 그것도 없으면 기본 모델(DEFAULT_LLM_MODEL)을 쓴다 */
  constructor(
    readonly model: string = process.env.LLM_MODEL || DEFAULT_LLM_MODEL,
    client?: MessagesClient,
    options: TransportOptions = {},
  ) {
    this.client = client ?? new Anthropic({ apiKey: requireEnv('LLM_API_KEY') });
    this.options = {
      fallback: options.fallback ?? true,
      effort: options.effort ?? GENERATION.effort,
      maxTokens: options.maxTokens ?? GENERATION.maxTokens,
      timeoutMs: options.timeoutMs ?? 90_000,
    };
  }

  async complete(req: LlmRequest, signal?: AbortSignal): Promise<LlmResponse> {
    const fallback = this.options.fallback ? { betas: [FALLBACK_BETA], fallbacks: 'default' as const } : {};
    const msg = await this.client.beta.messages.create({
      model: this.model,
      max_tokens: this.options.maxTokens,
      ...fallback,
      output_config: { effort: this.options.effort, format: { type: 'json_schema', schema: req.jsonSchema } },
      system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: req.user }],
      // 시간 제한은 요청 한 번마다 걸리고 SDK가 다시 시도한다. 재시도를 1번으로 줄여 최악 대기를 약 3분으로 둔다(D-046 리뷰)
    }, { signal, timeout: this.options.timeoutMs, maxRetries: 1 });
    const text = msg.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    return { text: text || null, stopReason: msg.stop_reason, servedModel: msg.model, usage: toUsage(msg) };
  }
}
