// 개발 전용 가짜 LLM·가짜 검수기(D-025). 운영에서는 runtime.ts가 이것을 고르지 않는다(flags.ts).
// 프롬프트의 근거 목록을 읽어 검증을 통과하는 정해진 문장을 만든다. 문장에는 간지·숫자를 쓰지 않는다.
import { REPORT_LAYOUT } from '../config/report';
import type { ModerationItem, ModerationResult, Moderator } from './moderation';
import type { LlmRequest, LlmResponse, LlmTransport } from './transport';

function evidenceIds(user: string): string[] {
  const start = user.indexOf('[');
  const end = user.indexOf('\n\n## 작성할 칸');
  if (start < 0 || end < 0) return [];
  return (JSON.parse(user.slice(start, end)) as { id: string }[]).map((e) => e.id);
}

function sentences(n: number, ids: readonly string[], prefix: string) {
  return Array.from({ length: n }, (_, i) => ({
    text: `${prefix} 풀이 문장 ${['하나', '둘', '셋', '넷', '다섯'][i] ?? '더'}이에요(개발용 가짜 문장).`,
    evidenceIds: [ids[i % ids.length]!],
  }));
}

function baseDraft(user: string) {
  const ids = evidenceIds(user);
  const general = ids.filter((id) => /^(tenGodGroup|tenGod|pillar|relation)\./.test(id) || id.startsWith('elements.'));
  const L = REPORT_LAYOUT;
  const indices = (/daewoonIndex ([\d, ]+) 순서로/.exec(user)?.[1] ?? '0, 1').split(',').map((x) => Number(x.trim()));
  return {
    summary: sentences(L.summaryAiSentences, general, '총평'),
    traits: sentences(L.traitsSentences, general, '성향'),
    daewoonNotes: indices.map((d) => ({ daewoonIndex: d, sentences: sentences(L.daewoonNoteSentences, [`daewoon[${d}]`], '대운') })),
    yearly: {
      thisYear: sentences(L.yearlySentences, ['seun[0]'], '올해'),
      nextYear: sentences(L.yearlySentences, ['seun[1]'], '내년'),
    },
  };
}

function topicDraft(user: string) {
  const ids = evidenceIds(user).filter((id) => id.startsWith('tenGodGroup.') || id.startsWith('tenGod.'));
  return { sentences: sentences(REPORT_LAYOUT.topicSentences, ids.length ? ids : ['seun[0]'], '주제') };
}

export class DevFakeTransport implements LlmTransport {
  readonly model = 'dev-fake';
  /** fail이면 항상 형식이 틀린 응답을 돌려줘 생성 실패(화면 B)를 재현한다 */
  constructor(private readonly mode: 'ok' | 'fail' = 'ok') {}

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const usage = [{ model: this.model, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }];
    if (this.mode === 'fail') return { text: '{"broken": true}', stopReason: 'end_turn', servedModel: this.model, usage };
    const body = req.label === 'base' ? baseDraft(req.user) : topicDraft(req.user);
    return { text: JSON.stringify(body), stopReason: 'end_turn', servedModel: this.model, usage };
  }
}

export class DevPassModerator implements Moderator {
  async review(_items: readonly ModerationItem[]): Promise<ModerationResult> {
    return { flags: [], calls: [{ attempt: 1, ok: true, usage: [] }] };
  }
}
