// 앱이 쓸 LLM 구성을 고른다. 가짜 LLM은 개발 환경에서 ENABLE_FAKE_LLM=true일 때만(운영에서는 항상 실제 API).
// 생성 실패 재현(목 결제창의 화면 B 선택)은 실제 풀이 모드에서도 API를 부르지 않고 실패한다. 개발·테스트 환경에서만이다.
import { isDevRuntime, isFakeLlmEnabled, type Env } from '../config/flags';
import { DevFakeTransport, DevPassModerator } from './devFake';
import { LlmModerator, MODERATION_MODEL, type Moderator } from './moderation';
import { AnthropicTransport, type LlmTransport } from './transport';

export interface LlmRuntime {
  transport: LlmTransport;
  moderator: Moderator;
}

export function llmRuntime(options: { forceFailure?: boolean } = {}, env: Env = process.env): LlmRuntime {
  if (options.forceFailure && isDevRuntime(env)) {
    return { transport: new DevFakeTransport('fail'), moderator: new DevPassModerator() };
  }
  if (isFakeLlmEnabled(env)) {
    return { transport: new DevFakeTransport('ok'), moderator: new DevPassModerator() };
  }
  return {
    transport: new AnthropicTransport(),
    moderator: new LlmModerator(new AnthropicTransport(MODERATION_MODEL, undefined, { fallback: false, effort: 'low', maxTokens: 4_000, timeoutMs: 30_000 })),
  };
}
