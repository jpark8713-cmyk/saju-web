// 테스트용 가짜 LLM. 실제 API를 부르지 않는다.
import { REPORT_LAYOUT } from '../../src/config/report';
import { ModerationUnavailable, type ModerationItem, type ModerationResult, type Moderator } from '../../src/llm/moderation';
import type { LlmRequest, LlmResponse, LlmTransport } from '../../src/llm/transport';
import type { BaseDraft, ChildPeriodDraft, PeriodDraft, PeriodNote, ReportSentence, TopicDraft } from '../../src/llm/types';
import { TEN_GOD_GROUPS } from '../../src/engine/constants';
import { tenGodOfStem } from '../../src/engine/tenGods';
import type { SajuChart } from '../../src/engine/types';

export type Responder = (req: LlmRequest, call: number) => Partial<LlmResponse> & { body?: unknown };

/** 월별·10년·아이 요약 호출 라벨(D-052) */
export const PERIOD_LABELS: ReadonlySet<string> = new Set(['monthly', 'decade', 'periods:child']);

export class FakeTransport implements LlmTransport {
  readonly model = 'claude-opus-5-5';
  readonly requests: LlmRequest[] = [];

  constructor(
    private readonly respond: Responder,
    /** 라벨별 응답 지연(ms). 지연 중 signal이 중단되면 SDK처럼 거부한다 */
    private readonly delayMs: (label: string) => number = () => 0,
    /**
     * 월별·10년·아이 요약 호출(D-052)을 누가 답하는지. 'auto'(기본)는 respond를 부르지 않고 늘 정상 응답을 준다
     * (월·연 칸과 관계없는 테스트가 기본 칸 응답만 정해도 되게). 'raw'는 respond가 답한다
     */
    private readonly periods: 'auto' | 'raw' = 'auto',
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
    const r = this.periods === 'auto' && PERIOD_LABELS.has(req.label) ? validResponder([])(req, this.requests.length) : this.respond(req, this.requests.length);
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

const GROUP_PLAIN: Record<string, string> = { 비겁: '자립·경쟁', 식상: '표현·재능', 재성: '재물·활동', 관성: '규칙·책임', 인성: '배움·보살핌' };

/** 사용자 메시지의 세운 근거에서 그해 윗글자의 뜻 묶음(쉬운 이름)을 읽는다(D-048) */
export function seunGroupIn(user: string, i: number): string | null {
  const json = user.slice(user.indexOf('['), user.indexOf('\n## 작성할 칸') - 1);
  const row = (JSON.parse(json) as { id: string; content: string }[]).find((e) => e.id === `seun[${i}]`);
  const ko = row ? /\((비겁|식상|재성|관성|인성)\)/u.exec(row.content)?.[1] : undefined;
  return ko ? GROUP_PLAIN[ko]! : null;
}

/** 차트에서 올해·내년 윗글자의 뜻 묶음(쉬운 이름)을 구한다(seunGroupIn과 같은 값) */
export function yearGroupsOf(chart: SajuChart): [string, string] {
  const label = (stem: number) => TEN_GOD_GROUPS.find((g) => (g.members as readonly string[]).includes(tenGodOfStem(chart.pillars.day.stem, stem)))!.plain;
  return [label(chart.seun[0]!.pillar.stem), label(chart.seun[1]!.pillar.stem)];
}

/** 올해·내년 첫·마지막 문장은 그해 글자의 뜻 묶음을 쓴다(D-048) */
function yearly(n: number, seun: string, group: string | null): ReportSentence[] {
  return sentences(n, [seun]).map((s, i) =>
    group && (i === 0 || i === n - 1) ? { ...s, text: `그해 글자가 ${group}의 뜻이라 바탕으로 쓴 ${i + 1}번째 문장이에요.` } : s,
  );
}

export function validBase(daewoonIndices: number[], ids: string[], groups: readonly (string | null)[] = [null, null]): BaseDraft {
  const L = REPORT_LAYOUT;
  return {
    summary: sentences(L.summaryAiSentences, ids),
    traits: sentences(L.traitsSentences, ids),
    daewoonNotes: daewoonIndices.map((d) => ({
      daewoonIndex: d,
      sentences: sentences(L.daewoonNoteSentences, [`daewoon[${d}]`]),
    })),
    yearly: {
      thisYear: yearly(L.yearlySentences, 'seun[0]', groups[0] ?? null),
      nextYear: yearly(L.yearlySentences, 'seun[1]', groups[1] ?? null),
    },
  };
}

export function validTopic(ids: string[]): TopicDraft {
  return { sentences: sentences(REPORT_LAYOUT.topicSentences, ids) };
}

/** 사용자 메시지의 근거 한 줄에서 윗글자의 뜻 묶음(쉬운 이름)을 읽는다 */
function groupIn(user: string, id: string): string {
  const json = user.slice(user.indexOf('['), user.indexOf('\n## 작성할 칸') - 1);
  const row = (JSON.parse(json) as { id: string; content: string }[]).find((e) => e.id === id);
  const ko = row ? /\((비겁|식상|재성|관성|인성)\)/u.exec(row.content)?.[1] : undefined;
  return GROUP_PLAIN[ko ?? '비겁']!;
}

/** 칸마다 그 칸 근거를 인용하고 첫 문장에 그 칸의 뜻 묶음을 쓰는 정상 응답(D-052). 첫머리는 칸마다 다르다 */
function periodNotes(user: string, idOf: (i: number) => string, count: number, per: number): PeriodNote[] {
  return Array.from({ length: count }, (_, i) => ({
    index: i,
    sentences: Array.from({ length: per }, (_, j) => ({
      text: j === 0 ? `${i + 1}번째 칸은 그 글자가 ${groupIn(user, idOf(i))}의 뜻이라 바탕으로 쓴 문장이에요.` : `${i + 1}번째 칸의 ${j + 1}번째 문장이에요.`,
      evidenceIds: [idOf(i)],
    })),
  }));
}

/** 월별(month) 또는 10년(year) 흐름 정상 응답 */
export function validPeriods(user: string, kind: 'month' | 'year'): PeriodDraft {
  const L = REPORT_LAYOUT;
  return kind === 'month'
    ? { periods: periodNotes(user, (i) => `month[${i}]`, L.monthCount, L.monthSentences) }
    : { periods: periodNotes(user, (i) => `year[${i}]`, L.yearCount, L.yearSentences) };
}

/** 아이 부모 관점 요약 정상 응답: 묶음마다 그 묶음 첫 달 근거 */
export function validChildPeriods(user: string): ChildPeriodDraft {
  const L = REPORT_LAYOUT;
  const firsts = [...user.matchAll(/묶음 (\d+)\([^)]*\): month\[(\d+)\]/gu)].map((m) => Number(m[2]));
  return {
    seasons: periodNotes(user, (i) => `month[${firsts[i] ?? i * 3}]`, L.seasonCount, L.seasonSentences),
    years: periodNotes(user, (i) => `year[${i}]`, L.yearCount, L.childYearSentences),
  };
}

/** 요청 종류에 맞는 정상 응답을 돌려주는 가짜 모델 */
export function validResponder(daewoonIndices: number[]): Responder {
  return (req) => {
    if (req.label === 'monthly') return { body: validPeriods(req.user, 'month') };
    if (req.label === 'decade') return { body: validPeriods(req.user, 'year') };
    if (req.label === 'periods:child') return { body: validChildPeriods(req.user) };
    const ids = evidenceIdsIn(req.user).filter((id) => id === 'dayMaster' || id.startsWith('elements.') || id.startsWith('tenGodGroup.'));
    return { body: req.label === 'base' ? validBase(daewoonIndices, ids, [seunGroupIn(req.user, 0), seunGroupIn(req.user, 1)]) : validTopic(ids) };
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
