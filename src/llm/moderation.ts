// AI 검수(2차 필터): 정규식(1차)을 통과한 풀이 문장을 저렴한 모델이 금지 범주로 다시 판정한다
// (사업자 결정 2026-10-20, Docs/decisions.md D-020).
// - 검수 호출이 실패하면 문장을 통과시키지 않는다. 재시도 후에도 실패하면 생성 실패로 처리한다.
// - 기록에는 걸린 범주와 문장 위치만 남기고, 문장 원문과 사용자 입력은 남기지 않는다.
import { z } from 'zod';
import type { TokenUsage } from './pricing';
import type { LlmTransport } from './transport';

export const MODERATION_MODEL = 'claude-haiku-5-5';

export const MODERATION_CATEGORIES = ['medical', 'investment', 'disaster', 'anxiety', 'accuracy'] as const;
export type ModerationCategory = (typeof MODERATION_CATEGORIES)[number];

export const CATEGORY_KO: Record<ModerationCategory, string> = {
  medical: '질병·의료 판단',
  investment: '투자 권유·재물 손실 단정',
  disaster: '사망·재앙 단정',
  anxiety: '불안을 키우는 단정',
  accuracy: '입증할 수 없는 정확성 표현',
};

/** 검수 호출 시도 횟수 (첫 시도 + 재시도 2회) */
export const MODERATION_MAX_ATTEMPTS = 3;

export const MODERATION_SYSTEM_PROMPT = [
  '당신은 오락·참고용 사주 리포트의 문장을 검수합니다. 각 문장이 아래 금지 범주에 해당하는지만 판정합니다.',
  '',
  '## 범주',
  '- medical: 질병·건강 상태를 진단하거나 예고함, 특정 신체 부위·체질이 약하다고 단정함, 병원·치료·약을 권함',
  '- investment: 투자·금융상품·부동산·재테크를 하라고 권함, 수익을 장담함, 돈·재산을 잃는다고 단정함, 빚·대출을 권함',
  '- disaster: 사망·사고·재난·화재 등 나쁜 사건이 일어난다고 단정하거나 예고함',
  '- anxiety: 이별·이혼·실패·불행 등 나쁜 결과를 단정해 불안을 키움',
  '- accuracy: 풀이의 적중률·정확도를 주장함',
  '',
  '## 해당하지 않는 예',
  '- 저축·지출 관리·기록 같은 생활 습관 조언, "시간·관계·배움에 투자" 같은 비유',
  '- 부정·회피 표현: "큰 사고 없이", "다치지 않게 천천히", "빚을 내지 않도록"',
  '- 일반 낱말: "갈등을 빚다", "마음이 아프다", "화재 예방", "100% 몰입"',
  '- 경향을 부드럽게 말하는 표현: "~한 편이에요", "~로 볼 수 있어요"',
  '',
  '## 출력',
  '모든 문장의 index를 빠짐없이 한 번씩 담고, 해당 범주가 없으면 빈 배열을 씁니다.',
].join('\n');

export const MODERATION_JSON_SCHEMA = {
  type: 'object',
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          index: { type: 'integer' },
          categories: { type: 'array', items: { type: 'string', enum: [...MODERATION_CATEGORIES] } },
        },
        required: ['index', 'categories'],
        additionalProperties: false,
      },
    },
  },
  required: ['results'],
  additionalProperties: false,
} as const;

const responseZ = z
  .object({
    results: z.array(
      z.object({ index: z.number().int(), categories: z.array(z.enum(MODERATION_CATEGORIES)) }).strict(),
    ),
  })
  .strict();

export interface ModerationItem {
  /** 문장 위치 (예: traits[2]) */
  path: string;
  text: string;
}

export interface ModerationFlag {
  path: string;
  categories: ModerationCategory[];
}

/** 검수 호출 한 번의 기록. 문장 원문은 담지 않는다 */
export interface ModerationCallRecord {
  attempt: number;
  ok: boolean;
  /** 실패 이유 코드 (원문 없음) */
  failure?: 'apiError' | 'refusal' | 'maxTokens' | 'invalidResponse';
  usage: TokenUsage[];
}

export interface ModerationResult {
  flags: ModerationFlag[];
  calls: ModerationCallRecord[];
}

export class ModerationUnavailable extends Error {
  constructor(readonly calls: ModerationCallRecord[]) {
    super(`AI 검수 실패: ${MODERATION_MAX_ATTEMPTS}회 시도 모두 판정을 받지 못함`);
    this.name = 'ModerationUnavailable';
  }
}

export interface Moderator {
  review(items: readonly ModerationItem[], signal: AbortSignal): Promise<ModerationResult>;
}

function userMessage(items: readonly ModerationItem[]): string {
  return `## 검수할 문장\n${JSON.stringify(items.map((it, index) => ({ index, text: it.text })), null, 1)}`;
}

/** 응답이 모든 index를 정확히 한 번씩 담았는지 확인한다 */
function parseResponse(text: string | null, count: number): ModerationFlag['categories'][] | null {
  if (!text) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const r = responseZ.safeParse(raw);
  if (!r.success) return null;
  const byIndex = new Map<number, ModerationCategory[]>();
  for (const x of r.data.results) {
    if (x.index < 0 || x.index >= count || byIndex.has(x.index)) return null;
    byIndex.set(x.index, [...new Set(x.categories)]);
  }
  if (byIndex.size !== count) return null;
  return Array.from({ length: count }, (_, i) => byIndex.get(i)!);
}

export class LlmModerator implements Moderator {
  constructor(private readonly transport: LlmTransport) {}

  async review(items: readonly ModerationItem[], signal: AbortSignal): Promise<ModerationResult> {
    const calls: ModerationCallRecord[] = [];
    if (items.length === 0) return { flags: [], calls };
    for (let attempt = 1; attempt <= MODERATION_MAX_ATTEMPTS; attempt++) {
      if (signal.aborted) throw signal.reason ?? new Error('aborted');
      let res;
      try {
        res = await this.transport.complete(
          { system: MODERATION_SYSTEM_PROMPT, user: userMessage(items), jsonSchema: MODERATION_JSON_SCHEMA, label: 'moderation' },
          signal,
        );
      } catch (e) {
        if (signal.aborted) throw e;
        calls.push({ attempt, ok: false, failure: 'apiError', usage: [] });
        continue;
      }
      const failure =
        res.stopReason === 'refusal' ? 'refusal' : res.stopReason === 'max_tokens' ? 'maxTokens' : null;
      const parsed = failure ? null : parseResponse(res.text, items.length);
      if (!parsed) {
        calls.push({ attempt, ok: false, failure: failure ?? 'invalidResponse', usage: res.usage });
        continue;
      }
      calls.push({ attempt, ok: true, usage: res.usage });
      const flags = parsed.flatMap((categories, i) => (categories.length ? [{ path: items[i]!.path, categories }] : []));
      return { flags, calls };
    }
    throw new ModerationUnavailable(calls);
  }
}
