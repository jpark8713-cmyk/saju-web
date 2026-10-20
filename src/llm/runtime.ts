// 앱이 쓸 LLM 구성을 고른다. 가짜 LLM은 개발 환경에서 ENABLE_FAKE_LLM=true일 때만(운영에서는 항상 실제 API).
import { isFakeLlmEnabled } from '../config/flags';
import { DevFakeTransport, DevPassModerator } from './devFake';
import { LlmModerator, MODERATION_MODEL, type Moderator } from './moderation';
import { AnthropicTransport, type LlmTransport } from './transport';

export interface LlmRuntime {
  transport: LlmTransport;
  moderator: Moderator;
}

export function llmRuntime(options: { forceFailure?: boolean } = {}): LlmRuntime {
  if (isFakeLlmEnabled()) {
    return { transport: new DevFakeTransport(options.forceFailure ? 'fail' : 'ok'), moderator: new DevPassModerator() };
  }
  return {
    transport: new AnthropicTransport(),
    moderator: new LlmModerator(new AnthropicTransport(MODERATION_MODEL, undefined, { fallback: false, effort: 'low', maxTokens: 4_000 })),
  };
}
