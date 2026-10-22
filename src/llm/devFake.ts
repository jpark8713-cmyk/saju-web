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

const GROUP_PLAIN: Record<string, string> = { 비겁: '자립·경쟁', 식상: '표현·재능', 재성: '재물·활동', 관성: '규칙·책임', 인성: '배움·보살핌' };

/** 올해·내년 첫·마지막 문장은 세운 근거에 적힌 그해 글자의 뜻 묶음을 쓴다(D-048) */
function yearly(user: string, i: number, prefix: string) {
  const start = user.indexOf('[');
  const end = user.indexOf('\n\n## 작성할 칸');
  const rows = start < 0 || end < 0 ? [] : (JSON.parse(user.slice(start, end)) as { id: string; content: string }[]);
  const ko = /\((비겁|식상|재성|관성|인성)\)/u.exec(rows.find((e) => e.id === `seun[${i}]`)?.content ?? '')?.[1];
  const xs = sentences(REPORT_LAYOUT.yearlySentences, [`seun[${i}]`], prefix);
  return xs.map((s, k) => (ko && (k === 0 || k === xs.length - 1) ? { ...s, text: `${prefix} 글자의 뜻은 ${GROUP_PLAIN[ko]}이에요(개발용 가짜 문장).` } : s));
}

function baseDraft(user: string) {
  const ids = evidenceIds(user);
  const general = ids.filter((id) => /^(tenGodGroup|tenGod|pillar|relation)\./.test(id) || id.startsWith('elements.'));
  const L = REPORT_LAYOUT;
  const indices = (/daewoonIndex ([\d, ]+) 순서로/.exec(user)?.[1] ?? '0, 1').split(',').map((x) => Number(x.trim()));
  return {
    summary: sentences(L.summaryAiSentences, general, '총평'),
    traits: sentences(L.traitsSentences, general, '성향'),
    daewoonNotes: indices.map((d) => ({ daewoonIndex: d, sentences: sentences(L.daewoonNoteSentences, [`daewoon[${d}]`], '큰 흐름') })),
    yearly: { thisYear: yearly(user, 0, '올해'), nextYear: yearly(user, 1, '내년') },
  };
}

function topicDraft(user: string) {
  const ids = evidenceIds(user).filter((id) => id.startsWith('tenGodGroup.') || id.startsWith('tenGod.'));
  return { sentences: sentences(REPORT_LAYOUT.topicSentences, ids.length ? ids : ['seun[0]'], '주제') };
}

export class DevFakeTransport implements LlmTransport {
  readonly model = 'dev-fake';
  /**
   * fail이면 API 오류를 내 생성 실패(화면 B)를 재현한다.
   * D-050부터 검증을 끝내 통과하지 못한 칸은 사실 문장으로 바꿔 주문이 끝나므로, 형식이 틀린 응답으로는 실패가 재현되지 않는다
   */
  constructor(private readonly mode: 'ok' | 'fail' = 'ok') {}

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const usage = [{ model: this.model, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }];
    if (this.mode === 'fail') throw new Error('개발용 생성 실패(화면 B 재현)');
    const body = req.label === 'base' ? baseDraft(req.user) : topicDraft(req.user);
    return { text: JSON.stringify(body), stopReason: 'end_turn', servedModel: this.model, usage };
  }
}

export class DevPassModerator implements Moderator {
  async review(_items: readonly ModerationItem[]): Promise<ModerationResult> {
    return { flags: [], calls: [{ attempt: 1, ok: true, usage: [] }] };
  }
}
