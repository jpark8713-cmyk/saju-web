// 풀이 생성: 기본 리포트 1회 + 선택한 주제마다 1회 호출(병렬). 선택하지 않은 주제는 호출하지 않는다.
// 응답이 형식·근거·금지 표현(정규식) 검증을 통과하지 못하면 위반 내용을 알려 주고 다시 생성한다(최대 2회 재시도).
// 정규식을 통과한 문장만 AI 검수(moderation.ts)로 넘긴다. 검수에서 걸리면 다시 생성하고,
// 검수 호출 자체가 실패하면 문장을 통과시키지 않고 생성 실패로 처리한다(Docs/decisions.md D-020).
import { GENERATION, REPORT_LAYOUT } from '../config/report';
import { findTopic, type ForbiddenRule, type TopicConfig } from '../config/topics';
import type { Evidence, Pillar, SajuChart } from '../engine/types';
import { audienceOf } from '../report/audience';
import { summaryTemplate } from '../report/summaryTemplate';
import { targetDaewoonIndices, topicEvidence } from './evidenceSelect';
import {
  CHILD_FORBIDDEN, CHILD_VOICE_FORBIDDEN, COMMON_FORBIDDEN, GROWN_NOTE_FORBIDDEN, PERIOD_SCENE_FORBIDDEN, PERIOD_TIME_FORBIDDEN, TODDLER_FORBIDDEN, TODDLER_MONEY_FORBIDDEN,
} from './forbidden';
import { CATEGORY_KO, ModerationUnavailable, type ModerationCallRecord, type ModerationFlag, type Moderator } from './moderation';
import { SYSTEM_PROMPT, baseUserMessage, childPeriodUserMessage, decadeUserMessage, monthlyUserMessage, topicUserMessage } from './prompt';
import {
  BASE_JSON_SCHEMA, CHILD_PERIOD_JSON_SCHEMA, PERIOD_JSON_SCHEMA, TOPIC_JSON_SCHEMA, parseBaseDraft, parseChildPeriodDraft, parsePeriodDraft, parseTopicDraft,
  type ParseResult,
} from './schema';
import type { TokenUsage } from './pricing';
import type { LlmTransport } from './transport';
import type { BaseDraft, ChildPeriodDraft, PeriodDraft, PeriodNote, ReportBody, ReportSentence, TopicDraft, Violation } from './types';
import {
  prepareRules, repeatedWordCounts, validateAngleCopy, validateAngleMix, validateConcreteCase, validateInventedCount, validateRepeatedStem,
  validateDoubleBase, validateOpenerRepeat, validatePeriodLead, validatePeriodNotes, validateRepetition, validateSection, validateStandalone, validateVacuous,
  validateYearly, type PeriodFacts, type PreparedRules, type YearFacts,
  repeatedPhrases, validateOpenerFrame, validatePeriodNameStart, validatePeriodRelationAdvice, validatePeriodAngleCopy, validatePhraseRepeat, validateWordCap, wordCapOverflow,
  periodWatchHits,
} from './validate';
import {
  fallbackBase, fallbackChildPeriods, fallbackMonths, fallbackTopic, fallbackYears, patchBase, patchChildPeriods, patchPeriods, patchTopic,
} from './fallbackText';
import { angleLines, assignAngles, sectionKeys } from './angles';
import { TEN_GOD_GROUPS, pillarLabel } from '../engine/constants';
import { buildPeriodEvidence, childVoiceEvidence } from '../engine/evidence';
import { luckRelations } from '../engine/relations';
import { tenGodOfBranch, tenGodOfStem } from '../engine/tenGods';

export interface AttemptRecord {
  label: string;
  attempt: number;
  servedModel: string;
  stopReason: string | null;
  usage: TokenUsage[];
  violations: Violation[];
  /** AI 검수 기록 (정규식 검증을 통과한 시도에만). 걸린 범주와 문장 위치만 담고 원문은 담지 않는다 */
  moderation?: { flags: ModerationFlag[]; calls: ModerationCallRecord[] };
  /** 코드 사실 문장으로 바꾼 문장 수 (D-049 시간 상한, D-050 검증 끝내 실패). 바꾼 기록에만 있다 */
  replacedSentences?: number;
}

export type GenerationFailureReason = 'validation' | 'moderationUnavailable';

export class GenerationError extends Error {
  /** attempts: 실패한 작업뿐 아니라 그때까지 모든 작업의 시도 기록 (비용 계산용) */
  constructor(
    readonly label: string,
    readonly attempts: AttemptRecord[],
    readonly reason: GenerationFailureReason = 'validation',
  ) {
    super(
      reason === 'validation'
        ? `풀이 생성 실패(${label}): ${GENERATION.maxAttempts}회 시도 모두 검증 실패`
        : `풀이 생성 실패(${label}): AI 검수를 받지 못함`,
    );
    this.name = 'GenerationError';
  }
}

interface SectionJob<T> {
  label: string;
  jsonSchema: Record<string, unknown>;
  buildUser: (violations: readonly Violation[]) => string;
  parse: (text: string) => ParseResult<T>;
  validate: (value: T) => Violation[];
  /**
   * 마지막 시도에서는 보지 않는 검사(D-045: 반복 풀이 말). 다시 쓰게 하되, 이것 때문에 주문이 실패하지는 않는다.
   * 마지막 시도에서 걸려도 기록만 남기고 통과시킨다.
   */
  softValidate?: (value: T, attempt: number) => Violation[];
  /** 시도 횟수 상한 (기본 GENERATION.maxAttempts) */
  maxAttempts?: number;
  /** AI 검수에 넘길 문장 (위치와 함께) */
  sentences: (value: T) => { path: string; text: string }[];
  /**
   * 시도를 모두 써도 통과하지 못하면 걸린 문장만 코드 사실 문장으로 바꾼다(D-050). value가 null이면 칸 전체를 사실 문장으로.
   * 없으면(반복 줄이기 다시 만들기) 예전처럼 GenerationError를 던진다
   */
  patch?: (value: T | null, paths: readonly string[]) => { value: T; replaced: number };
}

function stopViolation(stopReason: string | null): Violation[] {
  if (stopReason === 'refusal') return [{ code: 'refusal', path: '', detail: '모델이 응답을 거절함' }];
  if (stopReason === 'max_tokens') return [{ code: 'maxTokens', path: '', detail: '출력 길이 상한에 걸림' }];
  return [];
}

/**
 * 검증 실패가 아닌 이유(API 오류, 호출 측의 예산 제한 등)로 생성이 멈췄을 때.
 * 원래 오류는 cause에, 그때까지 결제된 모든 시도 기록은 attempts에 담는다.
 */
export class GenerationInterrupted extends Error {
  constructor(
    readonly attempts: AttemptRecord[],
    override readonly cause: unknown,
  ) {
    super(`풀이 생성 중단: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = 'GenerationInterrupted';
  }
}

/** 다른 작업이 실패해 이 작업을 멈췄을 때 */
class JobCancelled extends Error {}

/** 리포트 전체 시간 상한(D-049, GENERATION.hardDeadlineMs)에 닿아 이 작업을 멈췄을 때. 그 칸은 코드 사실 문장으로 채운다 */
class DeadlineReached extends Error {
  constructor(readonly label: string) {
    super(`시간 상한: ${label}`);
    this.name = 'DeadlineReached';
  }
}

interface JobContext {
  transport: LlmTransport;
  moderator: Moderator;
  signal: AbortSignal;
  /** 모든 작업의 시도 기록 (실패해도 비용 기록이 남게 공유한다) */
  log: AttemptRecord[];
  /** 이 시각(ms)이 지나면 softValidate로 다시 쓰지 않는다(D-048, GENERATION.softDeadlineMs) */
  deadline: number;
  now: () => number;
  /** 리포트 전체 시간 상한 신호(D-049). signal에도 합쳐져 있어 진행 중인 호출을 끊는다 */
  hardSignal: AbortSignal;
  /** 칸별 진행 상태 알림(D-052, 대기 화면) */
  onProgress?: (label: string, state: JobState) => void;
}

/** 칸 하나의 진행 상태(D-052): 대기 → 쓰는 중 → 확인 중(AI 검수) → 완료, 또는 사실 문장으로 채움 */
export type JobState = 'waiting' | 'writing' | 'checking' | 'done' | 'templated';

async function runJob<T>(ctx: JobContext, job: SectionJob<T>): Promise<{ value: T; attempts: AttemptRecord[] }> {
  const attempts: AttemptRecord[] = [];
  let previous: Violation[] = [];
  const max = job.maxAttempts ?? GENERATION.maxAttempts;
  /** 하드 규칙은 통과하고 softValidate에만 걸린 마지막 후보. 남은 시도가 모두 하드 위반이면 이것을 쓴다(D-045 리뷰) */
  let fallback: T | null = null;
  /**
   * 끝내 통과하지 못했을 때 쓸 후보(D-050): 검수에 걸린 후보(검수를 거친 문장 + 걸린 위치) 또는 하드 위반이 가장 적은 후보.
   * moderated: 걸린 문장 말고는 이미 검수를 통과했다
   */
  let salvage: { value: T; paths: string[]; moderated: boolean } | null = null;
  const keep = (value: T, violations: readonly Violation[], moderated: boolean) => {
    if (!salvage || moderated || (!salvage.moderated && violations.length <= salvage.paths.length)) {
      salvage = { value, paths: violations.map((v) => v.path), moderated };
    }
  };
  /** soft 후보를 검수해 본다. 통과하면 그 후보, 걸리면 null (후보는 한 번만 쓴다) */
  const tryFallback = async (): Promise<T | null> => {
    const f = fallback!;
    fallback = null;
    const last = attempts.at(-1)!;
    // 새 모델 호출이 아니라 앞 시도의 후보를 다시 쓰는 기록이다(비용 0, stopReason으로 구분)
    const flagged = await moderate(ctx, job, f, attempts, {
      label: job.label, attempt: last.attempt, servedModel: last.servedModel, stopReason: 'softFallback', usage: [],
    });
    if (flagged.length) {
      previous = flagged;
      keep(f, flagged, true);
    }
    return flagged.length ? null : f;
  };
  for (let attempt = 1; attempt <= max; attempt++) {
    if (ctx.hardSignal.aborted) throw new DeadlineReached(job.label);
    if (ctx.signal.aborted) throw new JobCancelled(job.label);
    // D-048: 시간 상한이 지났으면 문장 다듬기(soft)로 다시 쓰지 않는다. 그런 후보가 있으면 검수해 쓰고,
    // 없거나 검수에 걸리면 이번 시도를 마지막 시도처럼 본다(남은 시도로 고쳐 쓴다, 리뷰 반영)
    const late = ctx.now() >= ctx.deadline;
    if (late && fallback !== null) {
      const adopted = await tryFallback();
      if (adopted !== null) {
        ctx.onProgress?.(job.label, 'done');
        return { value: adopted, attempts };
      }
    }
    const isLast = attempt === max || late;
    ctx.onProgress?.(job.label, 'writing');
    let res;
    try {
      res = await ctx.transport.complete(
        { system: SYSTEM_PROMPT, user: job.buildUser(previous), jsonSchema: job.jsonSchema, label: job.label },
        ctx.signal,
      );
    } catch (e) {
      if (ctx.hardSignal.aborted) throw new DeadlineReached(job.label);
      // 반복 검사에만 걸린 후보가 있으면 API 오류로 주문을 끝내지 않고 그 후보를 쓴다(중단·취소는 그대로 던진다, D-045 리뷰)
      if (fallback !== null && !ctx.signal.aborted) break;
      throw e;
    }
    const base = { label: job.label, attempt, servedModel: res.servedModel, stopReason: res.stopReason, usage: res.usage };
    const stop = stopViolation(res.stopReason);
    const parsed = stop.length ? null : job.parse(res.text ?? '');
    const hard: Violation[] = stop.length
      ? stop
      : parsed && !parsed.ok
        ? [{ code: 'schema', path: '', detail: parsed.detail }]
        : job.validate((parsed as { ok: true; value: T }).value);
    const soft = !hard.length && !isLast ? (job.softValidate?.((parsed as { ok: true; value: T }).value, attempt) ?? []) : [];
    if (hard.length || soft.length) {
      if (!hard.length) fallback = (parsed as { ok: true; value: T }).value;
      else if (parsed?.ok) keep(parsed.value, hard, false);
      record(ctx, attempts, { ...base, violations: [...hard, ...soft] });
      previous = [...hard, ...soft];
      continue;
    }
    // 1차(정규식·구조) 통과 → 2차 AI 검수
    const value = (parsed as { ok: true; value: T }).value;
    const flagged = await moderate(ctx, job, value, attempts, base);
    if (!flagged.length) {
      ctx.onProgress?.(job.label, 'done');
      return { value, attempts };
    }
    keep(value, flagged, true);
    previous = flagged;
  }
  // 반복 줄이기(소프트)만 걸렸던 후보가 있으면 검수를 거쳐 그것을 쓴다. 반복 검사 때문에 주문이 실패하지 않게 한다
  if (fallback !== null) {
    const adopted = await tryFallback();
    if (adopted !== null) {
      ctx.onProgress?.(job.label, 'done');
      return { value: adopted, attempts };
    }
  }
  if (!job.patch) throw new GenerationError(job.label, attempts);
  return { value: await patchUp(ctx, job, salvage, attempts), attempts };
}

/**
 * 시도를 모두 써도 통과하지 못한 작업(D-050, 사업자 결정): 걸린 문장만 코드 사실 문장으로 바꿔 주문을 실패시키지 않는다.
 * - 검수에 걸린 후보: 걸린 문장만 바꾼다(나머지는 검수를 통과했다).
 * - 하드 위반 후보: 걸린 문장을 바꾸고 다시 검증한다(두 번까지, 그래도 남으면 칸 전체). 바꾼 뒤 남은 AI 문장은 검수를 받고, 걸리면 그 문장도 바꾼다.
 * - 읽을 수 있는 후보가 없으면 칸 전체를 사실 문장으로.
 * 사실 문장은 코드가 차트 값으로 쓴 것이라 검수를 받지 않는다. 검수를 받지 못하면(검수 호출 실패) 예전처럼 주문 실패다(D-020)
 */
async function patchUp<T>(
  ctx: JobContext,
  job: SectionJob<T>,
  salvage: { value: T; paths: string[]; moderated: boolean } | null,
  attempts: AttemptRecord[],
): Promise<T> {
  const patch = job.patch!;
  const last = attempts.at(-1);
  const done = (value: T, replaced: number) => {
    record(ctx, attempts, { label: job.label, attempt: last?.attempt ?? 0, servedModel: 'template', stopReason: 'templatePatched', usage: [], violations: [], replacedSentences: replaced });
    ctx.onProgress?.(job.label, replaced > 0 ? 'templated' : 'done');
    return value;
  };
  if (!salvage) {
    const whole = patch(null, []);
    return done(whole.value, whole.replaced);
  }
  let { value, replaced } = patch(salvage.value, salvage.paths);
  if (!salvage.moderated) {
    for (let round = 0; round < 2; round++) {
      const left = job.validate(value);
      if (!left.length) break;
      const next = patch(value, round === 0 ? left.map((v) => v.path) : ['']);
      value = next.value;
      replaced += next.replaced;
    }
    const flagged = await moderate(ctx, job, value, attempts, {
      label: job.label, attempt: last?.attempt ?? 0, servedModel: last?.servedModel ?? '', stopReason: 'templatePatched', usage: [],
    });
    if (flagged.length) {
      const next = patch(value, flagged.map((v) => v.path));
      value = next.value;
      replaced += next.replaced;
    }
  }
  return done(value, replaced);
}

/** 2차 AI 검수. 검수를 받지 못하면 GenerationError(moderationUnavailable), 걸린 문장은 위반으로 돌려준다 */
async function moderate<T>(
  ctx: JobContext,
  job: SectionJob<T>,
  value: T,
  attempts: AttemptRecord[],
  base: Omit<AttemptRecord, 'violations' | 'moderation'>,
): Promise<Violation[]> {
  let review;
  ctx.onProgress?.(job.label, 'checking');
  try {
    review = await ctx.moderator.review(job.sentences(value), ctx.signal);
  } catch (e) {
    // 시간 상한으로 검수 호출이 끊겼으면 검수 실패가 아니라 시간 상한이다(그 칸은 사실 문장으로 채운다)
    if (ctx.hardSignal.aborted) throw new DeadlineReached(job.label);
    if (e instanceof ModerationUnavailable) {
      record(ctx, attempts, { ...base, violations: [], moderation: { flags: [], calls: e.calls } });
      throw new GenerationError(job.label, attempts, 'moderationUnavailable');
    }
    throw e;
  }
  const flagged: Violation[] = review.flags.map((f) => ({
    code: 'aiFlagged',
    path: f.path,
    detail: `AI 검수: ${f.categories.map((c) => CATEGORY_KO[c]).join(', ')}`,
  }));
  record(ctx, attempts, { ...base, violations: flagged, moderation: { flags: review.flags, calls: review.calls } });
  return flagged;
}

function record(ctx: JobContext, attempts: AttemptRecord[], r: AttemptRecord): void {
  attempts.push(r);
  ctx.log.push(r);
}

/** 칸마다 한 번만 다시 쓰게 하는 검사(첫 시도에서만 본다): 한 문장에 개수 기준을 두 번 쓰기(D-051) */
function firstOnly(attempt: number, v: Violation[]): Violation[] {
  return attempt === 1 ? v : [];
}

/** 월별·10년 칸의 검수용 문장(위치: months[3][1]) */
function periodSentences(prefix: string, notes: readonly PeriodNote[]): { path: string; text: string }[] {
  return notes.flatMap((n, i) => n.sentences.map((s, j) => ({ path: `${prefix}[${i}][${j}]`, text: s.text })));
}

function childPeriodSentences(d: ChildPeriodDraft): { path: string; text: string }[] {
  return [...periodSentences('seasons', d.seasons), ...periodSentences('years', d.years)];
}

/** 그 칸 글자(간지)의 뜻 묶음(쉬운 이름)과 관계가 있는지 */
function factsOfPillar(chart: SajuChart, p: Pillar, ids: readonly string[], hasRelation: boolean): PeriodFacts {
  const day = chart.pillars.day.stem;
  const label = (tg: string) => TEN_GOD_GROUPS.find((g) => (g.members as readonly string[]).includes(tg))!.plain;
  return { ids, groupLabels: [...new Set([label(tenGodOfStem(day, p.stem)), label(tenGodOfBranch(day, p.branch))])], hasRelation };
}

function sentencesOf(path: string, xs: readonly ReportSentence[]): { path: string; text: string }[] {
  return xs.map((s, i) => ({ path: `${path}[${i}]`, text: s.text }));
}

function baseSentences(d: BaseDraft): { path: string; text: string }[] {
  return [
    ...sentencesOf('summary', d.summary),
    ...sentencesOf('traits', d.traits),
    ...d.daewoonNotes.flatMap((n, i) => sentencesOf(`daewoonNotes[${i}]`, n.sentences)),
    ...sentencesOf('yearly.thisYear', d.yearly.thisYear),
    ...sentencesOf('yearly.nextYear', d.yearly.nextYear),
  ];
}

function citesAtLeastOnce(sentences: readonly ReportSentence[], id: string, path: string): Violation[] {
  return sentences.some((s) => s.evidenceIds.includes(id))
    ? []
    : [{ code: 'wrongDaewoon', path, detail: `${id}를 인용한 문장이 없음` }];
}

/** 내년 칸에서 그해를 "올해"로 부르면 틀린 해를 가리킨다(D-045: 마지막 문장 규칙 뒤 4/5건에서 나왔다) */
function nextYearWording(sentences: readonly ReportSentence[]): Violation[] {
  return sentences.flatMap((s, i) =>
    /올해/u.test(s.text)
      ? [{ code: 'wrongYearWord' as const, path: `yearly.nextYear[${i}]`, detail: '내년 칸에서는 그해를 "올해"라고 쓰지 않고 "내년"으로 씁니다(연도를 숫자로 쓰면 seun[1] 근거도 인용합니다)' }]
      : [],
  );
}

// D-048: 올해·내년 마지막 문장에 elements.* 인용을 요구하던 검사(D-045 adviceLinked)는 뺐다.
// 그해 기운과 사주의 같은 기운 개수를 잇게 하자 "올해 불의 기운은 내 사주 8글자 중 3개"처럼 섞어 썼고, 같은 해의 문장이 사주마다 비슷했다.
// 대신 첫·마지막 문장을 그해 글자의 뜻·관계로 쓰게 한다(validateYearly, soft).

/** 세운 근거별 그해 글자의 뜻 묶음(쉬운 이름)과 이 사람 글자와의 관계가 있는지 */
function yearFactsOf(chart: SajuChart, i: number): YearFacts {
  const y = chart.seun[i]!;
  const day = chart.pillars.day.stem;
  const label = (tg: string) => TEN_GOD_GROUPS.find((g) => (g.members as readonly string[]).includes(tg))!.plain;
  return {
    seunId: `seun[${i}]`,
    groupLabels: [...new Set([label(tenGodOfStem(day, y.pillar.stem)), label(tenGodOfBranch(day, y.pillar.branch))])],
    hasRelation: luckRelations(chart.pillars, y.pillar).length > 0,
  };
}

interface BaseChecks {
  /** 대운 칸마다 다른 규칙(아이 리포트에서 13세 이후 대운은 그 나이대 문장이라 아이 금지어를 빼다). 없으면 rules */
  noteRules?: readonly PreparedRules[];
}

function validateBase(d: BaseDraft, rules: PreparedRules, daewoonIndices: readonly number[], checks: BaseChecks): Violation[] {
  const L = REPORT_LAYOUT;
  const notesCount: Violation[] =
    d.daewoonNotes.length === daewoonIndices.length
      ? []
      : [{ code: 'sentenceCount', path: 'daewoonNotes', detail: `${d.daewoonNotes.length}개 (필요 ${daewoonIndices.length}개)` }];
  const notes = d.daewoonNotes.flatMap((n, i) => {
    const expected = daewoonIndices[i];
    const order: Violation[] =
      n.daewoonIndex === expected
        ? []
        : [{ code: 'wrongDaewoon', path: `daewoonNotes[${i}]`, detail: `daewoonIndex ${n.daewoonIndex} (필요 ${expected})` }];
    return [
      ...order,
      ...validateSection(n.sentences, `daewoonNotes[${i}]`, L.daewoonNoteSentences, checks.noteRules?.[i] ?? rules),
      ...citesAtLeastOnce(n.sentences, `daewoon[${expected}]`, `daewoonNotes[${i}]`),
    ];
  });
  return [
    ...validateSection(d.summary, 'summary', L.summaryAiSentences, rules),
    ...validateSection(d.traits, 'traits', L.traitsSentences, rules),
    ...notesCount,
    ...notes,
    ...validateSection(d.yearly.thisYear, 'yearly.thisYear', L.yearlySentences, rules),
    ...citesAtLeastOnce(d.yearly.thisYear, 'seun[0]', 'yearly.thisYear'),
    ...validateSection(d.yearly.nextYear, 'yearly.nextYear', L.yearlySentences, rules),
    ...citesAtLeastOnce(d.yearly.nextYear, 'seun[1]', 'yearly.nextYear'),
    ...nextYearWording(d.yearly.nextYear),
  ];
}

export interface GenerateArgs {
  chart: SajuChart;
  evidence: readonly Evidence[];
  /** 소비자가 고른 주제 id (0개 이상) */
  topicIds: readonly string[];
  referenceYear: number;
  transport: LlmTransport;
  /** AI 검수기 (2차 필터) */
  moderator: Moderator;
  /** 나이 판정 기준 시각(주문 시각). 만 13세 미만이면 아이 리포트로 쓴다(D-044). 없으면 지금 */
  asOf?: Date;
  /** 시간 상한 계산용 시계(테스트에서 바꿔 끼운다). 없으면 Date.now */
  now?: () => number;
  /** 시간 상한(ms). 없으면 GENERATION.softDeadlineMs·hardDeadlineMs (테스트·시뮬레이션용) */
  limits?: { softMs?: number; hardMs?: number };
  /** 칸별 진행 상태 알림(D-052). label: base, topic:<id>, monthly, decade, periods:child */
  onProgress?: (label: string, state: JobState) => void;
}

export interface GenerateResult {
  body: ReportBody;
  attempts: AttemptRecord[];
  /** 월별·10년 흐름 근거(month[i]·year[i], D-052). 리포트와 함께 저장해 사실 카드에 쓴다 */
  periodEvidence: Evidence[];
}

function resolveTopics(ids: readonly string[]): TopicConfig[] {
  return [...new Set(ids)].map((id) => {
    const t = findTopic(id);
    if (!t || !t.enabled) throw new Error(`사용할 수 없는 주제입니다: ${id}`);
    return t;
  });
}

export async function generateReport(args: GenerateArgs): Promise<GenerateResult> {
  const topics = resolveTopics(args.topicIds);
  const daewoonIndices = targetDaewoonIndices(args.chart, args.referenceYear, REPORT_LAYOUT.daewoonNoteCount);
  const audience = audienceOf(args.chart, args.asOf ?? new Date(), daewoonIndices);
  const child = audience.child;
  const template = summaryTemplate(args.chart, { child });
  // 아이 리포트: 부모가 돌볼 때 참고하는 칸은 아이 금지어(+5세 이하는 약속·책임 풀이)까지, 13세 이후 대운 칸은 "아이" 호칭만(D-045)
  const careForbidden = child
    ? [...COMMON_FORBIDDEN, ...CHILD_FORBIDDEN, ...CHILD_VOICE_FORBIDDEN, ...(audience.toddler ? [...TODDLER_FORBIDDEN, TODDLER_MONEY_FORBIDDEN] : [])]
    : COMMON_FORBIDDEN;
  // D-051: 아이 리포트는 근거 문구도 아이 호칭으로(부르는 쪽이 이미 바꿔 넘겨도 같다)
  const reportEvidence = child ? args.evidence.map(childVoiceEvidence) : args.evidence;
  const ruleOf = (forbidden: readonly ForbiddenRule[]) => prepareRules({ evidence: reportEvidence, forbidden, maxChars: REPORT_LAYOUT.maxSentenceChars });
  const baseRules = ruleOf(careForbidden);
  // 13세 이후 대운 칸: 그 나이대 문장이라 아이 금지어는 빼고, "아이"·"나" 호칭 없이 쓴다(D-046)
  const grownRules = child ? ruleOf([...COMMON_FORBIDDEN, ...CHILD_VOICE_FORBIDDEN, ...GROWN_NOTE_FORBIDDEN]) : baseRules;
  const noteRules = audience.daewoon.map((a) => (child && a.grown ? grownRules : baseRules));
  const templateViolations = validateSection(template, 'summaryTemplate', REPORT_LAYOUT.summaryTemplateSentences, baseRules);
  if (templateViolations.length) {
    throw new Error(`총평 템플릿이 검증을 통과하지 못했습니다: ${JSON.stringify(templateViolations)}`);
  }
  const fixedTexts = template.map((s) => s.text);
  // 칸별 풀이 각도(D-047): 사주 해시로 시작, 칸마다 다음 각도
  // D-052: 월별·10년 흐름의 칸(month:i·year:i, 아이는 season:i·year:i)을 뒤에 이어 붙인다(앞 칸들의 각도는 그대로다)
  const L = REPORT_LAYOUT;
  const asOf = args.asOf ?? new Date();
  const period = buildPeriodEvidence(args.chart, asOf, args.referenceYear, { child, monthCount: L.monthCount, yearCount: L.yearCount });
  const periodKeys = [
    ...(child ? period.seasons.map((g) => `season:${g.index}`) : period.months.map((m) => `month:${m.index}`)),
    ...period.years.map((y) => `year:${y.index}`),
  ];
  const angles = assignAngles(args.chart, audience, [...sectionKeys(topics.map((t) => t.id), daewoonIndices.length), ...periodKeys]);
  const baseAngleBlock = angleLines(angles, [
    { key: 'summary', name: 'summary' },
    { key: 'traits', name: 'traits' },
    ...daewoonIndices.map((d, i) => ({ key: `daewoon:${i}`, name: `daewoonNotes(daewoonIndex ${d})` })),
    { key: 'thisYear', name: 'yearly.thisYear' },
    { key: 'nextYear', name: 'yearly.nextYear' },
  ]);

  const controller = new AbortController();
  // D-049: 리포트 전체 절대 시간 상한. 닿으면 진행 중인 호출을 끊고, 끝나지 않은 칸은 코드 사실 문장으로 채운다(주문은 실패시키지 않는다)
  const hardController = new AbortController();
  const hardTimer = setTimeout(() => hardController.abort(), args.limits?.hardMs ?? GENERATION.hardDeadlineMs);
  const now = args.now ?? Date.now;
  const ctx: JobContext = {
    transport: args.transport, moderator: args.moderator, signal: AbortSignal.any([controller.signal, hardController.signal]), log: [],
    deadline: now() + (args.limits?.softMs ?? GENERATION.softDeadlineMs), now, hardSignal: hardController.signal,
    onProgress: args.onProgress,
  };
  try {
    return await generateWithin();
  } finally {
    clearTimeout(hardTimer);
  }

  async function generateWithin(): Promise<GenerateResult> {
  /** 시간 상한에 닿은 작업은 사실 문장으로 바꾸고 기록을 남긴다(비용 0, stopReason으로 구분) */
  const orTemplate = <T extends Draft>(label: string, p: Promise<{ value: T; attempts: AttemptRecord[] }>, make: () => T) =>
    p.catch((e: unknown) => {
      if (!(e instanceof DeadlineReached)) throw e;
      ctx.onProgress?.(label, 'templated');
      const value = make();
      const last = ctx.log.filter((a) => a.label === label).at(-1);
      const r: AttemptRecord = {
        label, attempt: last?.attempt ?? 0, servedModel: 'template', stopReason: 'deadlineTemplate', usage: [], violations: [], replacedSentences: draftSize(value),
      };
      ctx.log.push(r);
      return { value, attempts: [r] };
    });
  const baseTemplate = () => fallbackBase(args.chart, daewoonIndices, audience);
  const yearFacts = [yearFactsOf(args.chart, 0), yearFactsOf(args.chart, 1)] as const;
  let failed = false;
  let firstFailure: unknown;
  /** 한 작업이 실패하면 나머지 유료 호출을 바로 취소한다 */
  const guard = <R>(p: Promise<R>): Promise<R> =>
    p.catch((e: unknown) => {
      if (!failed && !(e instanceof JobCancelled)) {
        failed = true;
        firstFailure = e;
        controller.abort();
      }
      throw e;
    });

  // 칸별 진행 표시(D-052): 모든 칸을 "대기"로 먼저 알린 뒤 작업을 시작한다(작업은 만들자마자 "쓰는 중"을 알린다)
  const jobLabels = ['base', ...topics.map((t) => `topic:${t.id}`), ...(child ? ['periods:child'] : ['monthly', 'decade'])];
  for (const label of jobLabels) ctx.onProgress?.(label, 'waiting');

  const baseJob = orTemplate('base', runJob<BaseDraft>(ctx, {
    label: 'base',
    jsonSchema: BASE_JSON_SCHEMA,
    buildUser: (violations) =>
      baseUserMessage({ evidence: reportEvidence, templateSummary: template, daewoonIndices, thisYear: args.referenceYear, violations, audience, angleBlock: baseAngleBlock }),
    parse: parseBaseDraft,
    validate: (d) => validateBase(d, baseRules, daewoonIndices, { noteRules }),
    // 반복 풀이 말·앞 문장 의존 표현은 마지막 시도에서는 봐준다(주문을 실패시키지 않는다, D-045·D-046)
    softValidate: (d, attempt) => [
      ...validateRepetition(baseSentences(d), fixedTexts),
      ...validateStandalone(baseSentences(d)),
      ...validateConcreteCase(baseSentences(d)),
      ...validateAngleMix(baseSentences(d)),
      ...validateYearly(d.yearly.thisYear, 'yearly.thisYear', yearFacts[0]),
      ...validateYearly(d.yearly.nextYear, 'yearly.nextYear', yearFacts[1]),
      ...firstOnly(attempt, validateDoubleBase(baseSentences(d))),
      ...validateRepeatedStem(baseSentences(d)),
      ...validateInventedCount(baseSentences(d)),
    ],
    sentences: baseSentences,
    patch: (d, paths) => {
      const tpl = baseTemplate();
      return d === null ? { value: tpl, replaced: draftSize(tpl) } : patchBase(d, tpl, paths);
    },
  }), baseTemplate);

  /** 주제 칸 하나를 만든다. avoidWords: 이 리포트의 다른 칸에서 이미 두 번 쓴 풀이 말(반복을 줄이려 다시 만들 때만, D-045) */
  const topicJob = (topic: TopicConfig, avoidWords: readonly string[] = []) => {
    const evidence = topicEvidence(topic, args.chart, reportEvidence);
    const rules = prepareRules({
      evidence,
      forbidden: [...careForbidden, ...topic.extraForbidden],
      maxChars: REPORT_LAYOUT.maxSentenceChars,
    });
    const label = avoidWords.length ? `topic:${topic.id}:repeat` : `topic:${topic.id}`;
    const job = runJob<TopicDraft>(ctx, {
      label,
      jsonSchema: TOPIC_JSON_SCHEMA,
      buildUser: (violations) => topicUserMessage({ topic, evidence, violations, audience, avoidWords, angleBlock: angleLines(angles, [{ key: `topic:${topic.id}`, name: 'sentences' }]) }),
      parse: parseTopicDraft,
      validate: (d) => validateSection(d.sentences, `topics.${topic.id}`, REPORT_LAYOUT.topicSentences, rules),
      // 반복 줄이기는 마지막 시도에서는 보지 않는다. 다시 만들기(avoidWords)는 한 번만 시도한다(D-045 리뷰)
      ...(avoidWords.length ? { maxAttempts: 1 } : {}),
      softValidate: (d, attempt) => [
        ...validateRepetition(sentencesOf(`topics.${topic.id}`, d.sentences)),
        ...validateStandalone(sentencesOf(`topics.${topic.id}`, d.sentences)),
        ...validateConcreteCase(sentencesOf(`topics.${topic.id}`, d.sentences)),
        ...validateAngleMix(sentencesOf(`topics.${topic.id}`, d.sentences)),
        ...firstOnly(attempt, validateDoubleBase(sentencesOf(`topics.${topic.id}`, d.sentences))),
        ...validateRepeatedStem(sentencesOf(`topics.${topic.id}`, d.sentences)),
        ...validateInventedCount(sentencesOf(`topics.${topic.id}`, d.sentences)),
      ],
      sentences: (d) => sentencesOf(`topics.${topic.id}`, d.sentences),
      // 반복 줄이기 다시 만들기는 바꾸지 않는다(실패하면 원래 문장을 둔다)
      ...(avoidWords.length ? {} : {
        patch: (d: TopicDraft | null, paths: readonly string[]) => {
          const tpl = fallbackTopic(args.chart, evidence, daewoonIndices, audience);
          return d === null ? { value: tpl, replaced: tpl.sentences.length } : patchTopic(d, tpl, paths, `topics.${topic.id}`);
        },
      }),
    });
    // 반복 줄이기 다시 만들기는 시간 상한에 닿으면 실패로 보고 원래 문장을 둔다(reduceRepetition이 잡는다)
    return (avoidWords.length ? job : orTemplate(label, job, () => fallbackTopic(args.chart, evidence, daewoonIndices, audience)))
      .then((r) => ({ id: topic.id, ...r }));
  };
  const topicJobs = topics.map((topic) => topicJob(topic));

  // ---- 월별·10년 흐름(D-052): 기본 칸·주제 칸과 동시에. 검사·안전 검수·사실 문장 대체·시간 상한은 같은 규칙이다 ----
  // 근거: 일간·묶음 개수·오행 개수(원국 사실) + 그달·그해 근거. 월·연 칸에는 근거에 없는 구체 장면 금지(하드)를 더한다
  const periodEvidence = [
    ...reportEvidence.filter((e) => e.kind === 'dayMaster' || e.kind === 'tenGodGroup' || e.kind === 'elementBalance'),
    ...period.evidence,
  ];
  // D-052 3단계 C안: 근거에 없는 시간 서술(처음 들어오는·비로소·새로 들어오는 등)도 하드로 막는다(앞뒤 달 사실을 모르고 써서 틀렸다)
  const periodRuleOf = (forbidden: readonly ForbiddenRule[]) =>
    prepareRules({ evidence: periodEvidence, forbidden: [...forbidden, PERIOD_SCENE_FORBIDDEN, PERIOD_TIME_FORBIDDEN], maxChars: L.maxSentenceChars });
  const periodRules = periodRuleOf(careForbidden);
  const grownPeriodRules = child ? periodRuleOf([...COMMON_FORBIDDEN, ...CHILD_VOICE_FORBIDDEN, ...GROWN_NOTE_FORBIDDEN]) : periodRules;
  // AI가 칸을 더 돌려주면(범위 밖 i) 그 칸의 사실은 비어 있다. 칸 수 위반은 validatePeriodNotes가 따로 남긴다
  const NO_FACTS: PeriodFacts = { ids: [], groupLabels: [], hasRelation: false };
  const monthFacts = (i: number): PeriodFacts => {
    const m = period.months[i];
    return m ? factsOfPillar(args.chart, m.pillar, [`month[${i}]`], m.relations.length > 0) : NO_FACTS;
  };
  const yearFactsAt = (i: number): PeriodFacts => {
    const y = period.years[i];
    return y ? factsOfPillar(args.chart, y.pillar, [`year[${i}]`], y.relations.length > 0) : NO_FACTS;
  };
  const seasonFacts = (i: number): PeriodFacts => {
    const season = period.seasons[i];
    if (!season) return NO_FACTS;
    const ms = season.monthIndices.map((k) => period.months[k]!);
    return {
      ids: ms.map((m) => `month[${m.index}]`),
      groupLabels: [...new Set(ms.flatMap((m) => factsOfPillar(args.chart, m.pillar, [], false).groupLabels))],
      hasRelation: ms.some((m) => m.relations.length > 0),
    };
  };
  // 칸 안 반복(D-052 3단계, 첫 시도에서만): 같은 글귀·"곁에서" 횟수·합·충 각도 이름(뜻 설명 포함) 옮겨 쓰기
  const periodSoft = (ss: { path: string; text: string }[], attempt: number) => [
    ...validateRepetition(ss),
    ...validateStandalone(ss),
    ...firstOnly(attempt, [...validateDoubleBase(ss), ...validatePhraseRepeat(ss), ...validateWordCap(ss), ...validatePeriodAngleCopy(ss)]),
    ...validateRepeatedStem(ss),
    ...validateInventedCount(ss),
  ];
  // 월·연 칸에는 관계 표를 넣지 않는다(D-052 3단계 C안: 각도 이름도 뜻 설명도 문장에 그대로 옮겼다). 관계는 화면의 사실 줄·칩이 보여 준다
  const periodAngles = (keys: readonly string[], names: readonly string[]) =>
    angleLines(angles, keys.map((key, i) => ({ key, name: names[i]! })), { omitRelation: true });
  // 10년 흐름의 올해·내년은 AI 문장 없이 코드 사실 줄(D-052 3단계). AI는 year[yearAiFrom]부터 쓴다
  const aiYears = period.years.filter((y) => y.index >= L.yearAiFrom);
  const aiYearIdx = aiYears.map((y) => y.index);
  const skippedYearIds = new Set(period.years.filter((y) => y.index < L.yearAiFrom).map((y) => `year[${y.index}]`));
  const monthEvidenceOnly = periodEvidence.filter((e) => e.kind !== 'year');
  const yearEvidenceOnly = periodEvidence.filter((e) => e.kind !== 'month' && !skippedYearIds.has(e.id));
  const childEvidence = periodEvidence.filter((e) => !skippedYearIds.has(e.id));
  const monthIdx = period.months.map((m) => m.index);
  const seasonIdx = period.seasons.map((g) => g.index);
  const yearRulesOf = (i: number) => (period.years[i] && period.years[i]!.ageAfterBirthday >= 13 ? grownPeriodRules : periodRules);
  // 어른 C안: 칸마다 AI 1문장. 사실(간지·뜻·주된 관계)은 화면의 코드 사실 줄이 맡으므로 첫 문장 뜻 검사는 없다.
  // 대신 달·해 이름으로 시작하지 않기와 문장끼리 첫머리 틀 검사(첫 시도에서만)
  // 관계를 말한 문장은 행동 제안으로 끝내지 않는다(soft, 기존 칸과 같은 규칙). 달·해 이름 시작은 그 칸 자기 간지만 본다
  const ownPillarsOf = (prefix: string, notes: readonly PeriodNote[], pillarOf: (index: number) => Pillar | undefined) =>
    new Map(notes.flatMap((n, k) => {
      const p = pillarOf(n.index);
      return p ? n.sentences.map((_, j) => [`${prefix}[${k}][${j}]`, pillarLabel(p)] as const) : [];
    }));
  const adultPeriodSoft = (ss: { path: string; text: string }[], attempt: number, own: ReadonlyMap<string, string>) => [
    ...firstOnly(attempt, [...validatePeriodNameStart(ss, own), ...validateOpenerFrame(ss)]),
    ...validatePeriodRelationAdvice(ss),
    ...periodSoft(ss, attempt),
  ];

  const periodJobs = child
    ? [orTemplate('periods:child', runJob<ChildPeriodDraft>(ctx, {
        label: 'periods:child',
        jsonSchema: CHILD_PERIOD_JSON_SCHEMA,
        buildUser: (violations) => childPeriodUserMessage({
          evidence: childEvidence, audience, seasons: period.seasons, years: aiYears, violations,
          angleBlock: periodAngles(
            [...period.seasons.map((g) => `season:${g.index}`), ...aiYears.map((y) => `year:${y.index}`)],
            [...period.seasons.map((g) => `seasons[${g.index}]`), ...aiYears.map((y) => `years[${y.index}]`)],
          ),
        }),
        parse: parseChildPeriodDraft,
        validate: (d) => [
          ...validatePeriodNotes(d.seasons, 'seasons', { indices: seasonIdx, sentences: L.seasonSentences }, () => periodRules, seasonFacts),
          ...validatePeriodNotes(d.years, 'years', { indices: aiYearIdx, sentences: L.childYearSentences }, yearRulesOf, yearFactsAt),
        ],
        softValidate: (d, attempt) => [
          ...validatePeriodLead(d.seasons, 'seasons', seasonFacts, seasonIdx),
          ...validatePeriodLead(d.years, 'years', yearFactsAt, aiYearIdx),
          ...firstOnly(attempt, [...validateOpenerRepeat(d.seasons, 'seasons'), ...validateOpenerFrame(periodSentences('years', d.years))]),
          ...periodSoft(childPeriodSentences(d), attempt),
        ],
        sentences: childPeriodSentences,
        patch: (d, paths) => {
          const tpl = fallbackChildPeriods(args.chart, period.months, period.seasons, aiYears);
          return d === null ? { value: tpl, replaced: draftSize(tpl) } : patchChildPeriods(d, tpl, paths);
        },
      }), () => fallbackChildPeriods(args.chart, period.months, period.seasons, aiYears)).then((r) => ({ kind: 'child' as const, ...r }))]
    : [
        orTemplate('monthly', runJob<PeriodDraft>(ctx, {
          label: 'monthly',
          jsonSchema: PERIOD_JSON_SCHEMA,
          buildUser: (violations) => monthlyUserMessage({
            evidence: monthEvidenceOnly, monthCount: L.monthCount, violations,
            angleBlock: periodAngles(period.months.map((m) => `month:${m.index}`), period.months.map((m) => `periods[${m.index}]`)),
          }),
          parse: parsePeriodDraft,
          validate: (d) => validatePeriodNotes(d.periods, 'months', { indices: monthIdx, sentences: L.monthSentences }, () => periodRules, monthFacts),
          softValidate: (d, attempt) => adultPeriodSoft(periodSentences('months', d.periods), attempt, ownPillarsOf('months', d.periods, (i) => period.months[i]?.pillar)),
          sentences: (d) => periodSentences('months', d.periods),
          patch: (d, paths) => {
            const tpl = fallbackMonths(args.chart, period.months);
            return d === null ? { value: tpl, replaced: draftSize(tpl) } : patchPeriods(d, tpl, paths, 'months');
          },
        }), () => fallbackMonths(args.chart, period.months)).then((r) => ({ kind: 'months' as const, ...r })),
        orTemplate('decade', runJob<PeriodDraft>(ctx, {
          label: 'decade',
          jsonSchema: PERIOD_JSON_SCHEMA,
          buildUser: (violations) => decadeUserMessage({
            evidence: yearEvidenceOnly, indices: aiYearIdx, violations,
            angleBlock: periodAngles(aiYears.map((y) => `year:${y.index}`), aiYears.map((y) => `periods[${y.index}]`)),
          }),
          parse: parsePeriodDraft,
          validate: (d) => validatePeriodNotes(d.periods, 'years', { indices: aiYearIdx, sentences: L.yearSentences }, () => periodRules, yearFactsAt),
          softValidate: (d, attempt) => adultPeriodSoft(periodSentences('years', d.periods), attempt, ownPillarsOf('years', d.periods, (i) => period.years[i]?.pillar)),
          sentences: (d) => periodSentences('years', d.periods),
          patch: (d, paths) => {
            const tpl = fallbackYears(args.chart, aiYears);
            return d === null ? { value: tpl, replaced: draftSize(tpl) } : patchPeriods(d, tpl, paths, 'years');
          },
        }), () => fallbackYears(args.chart, aiYears)).then((r) => ({ kind: 'years' as const, ...r })),
      ];

  const settledPeriods = Promise.allSettled(periodJobs.map((p) => guard(p as Promise<unknown>)));
  const settled = await Promise.allSettled([guard(baseJob), ...topicJobs.map(guard)]);
  const periodResults = await settledPeriods;
  if (failed) {
    if (firstFailure instanceof GenerationError) throw new GenerationError(firstFailure.label, ctx.log, firstFailure.reason);
    throw new GenerationInterrupted(ctx.log, firstFailure);
  }
  type PeriodResult = { kind: 'child'; value: ChildPeriodDraft } | { kind: 'months' | 'years'; value: PeriodDraft };
  const periodValues = periodResults.map((r) => (r as PromiseFulfilledResult<PeriodResult>).value);
  const periodOf = (kind: 'months' | 'years') => (periodValues.find((p) => p.kind === kind)?.value as PeriodDraft | undefined)?.periods;
  const childPeriods = periodValues.find((p) => p.kind === 'child')?.value as ChildPeriodDraft | undefined;
  // 운영자 알림 분모(D-052): AI에게 쓰라고 요청한 문장 수(대체 전). 10년 흐름은 올해·내년을 뺀 해만
  const requestedSentences =
    L.summaryAiSentences + L.traitsSentences + daewoonIndices.length * L.daewoonNoteSentences + 2 * L.yearlySentences + topics.length * L.topicSentences +
    (child ? L.seasonCount * L.seasonSentences + aiYears.length * L.childYearSentences : L.monthCount * L.monthSentences + aiYears.length * L.yearSentences);
  const [base, ...firstTopics] = settled.map((r) => (r as PromiseFulfilledResult<unknown>).value) as [
    Awaited<typeof baseJob>,
    ...Awaited<(typeof topicJobs)[number]>[],
  ];
  // D-048: 시간 상한이 지났으면 반복 줄이기(주제 칸 다시 만들기)는 건너뛴다
  const topicSentences = ctx.now() >= ctx.deadline || ctx.hardSignal.aborted
    ? firstTopics.map((t) => t.value.sentences)
    : await reduceRepetition(
        [...fixedTexts, ...baseSentences(base.value).map((s) => s.text)],
        topics,
        firstTopics.map((t) => t.value.sentences),
        (topic, avoid) => topicJob(topic, avoid).then((r) => r.value.sentences),
      );
  const periods: ReportBody['periods'] = {
    asOf: asOf.toISOString(),
    referenceYear: args.referenceYear,
    ...(child ? { seasons: childPeriods!.seasons } : { months: periodOf('months')! }),
    years: child ? childPeriods!.years : periodOf('years')!,
  };
  const periodTexts = child ? childPeriodSentences(childPeriods!) : [...periodSentences('months', periods.months!), ...periodSentences('years', periods.years)];
  return {
    body: {
      summary: [...template, ...base.value.summary],
      traits: base.value.traits,
      topics: Object.fromEntries(topics.map((t, i) => [t.id, topicSentences[i]!])),
      daewoonNotes: base.value.daewoonNotes,
      yearly: base.value.yearly,
      ...(child ? { audience: 'child' as const } : {}),
      angles,
      ...templatedOf(ctx.log),
      requestedSentences,
      periods,
      observed: observe(
        [...baseSentences(base.value), ...topics.flatMap((t, i) => sentencesOf(`topics.${t.id}`, topicSentences[i]!)), ...periodTexts],
        [...sentencesOf('yearly.thisYear', base.value.yearly.thisYear), ...sentencesOf('yearly.nextYear', base.value.yearly.nextYear), ...periodTexts],
        periodTexts,
      ),
    },
    attempts: ctx.log,
    periodEvidence: period.evidence,
  };
  }
}

/**
 * 다시 쓰게 하지 않고 기록만 남기는 검사(D-051, 사업자 결정): 각도 이름 옮겨 쓰기, 합·충 문장의 얇은 끝맺음("~모습이 보여요").
 * 다시 쓰게 하자 어른 리포트 비용·시간이 두 배가 됐다($0.12→$0.27, 34초→61초). 출시 후 실제 주문 문장으로 반복도를 보고 다시 정한다
 */
function observe(
  sentences: readonly { path: string; text: string }[],
  /** 월·연·올해·내년 문장(D-052 3단계: 칸 사이 반복은 다시 쓰게 하지 않고 기록만, 사업자 결정) */
  periodish: readonly { path: string; text: string }[],
  /** 월·연 칸 문장만(D-057: 과거 단정·만든 장면 표현 기록) */
  periodOnly: readonly { path: string; text: string }[],
): NonNullable<ReportBody['observed']> {
  return {
    angleCopy: validateAngleCopy(sentences).length,
    thinRelation: validateVacuous(sentences).length,
    periodPhraseRepeat: repeatedPhrases(periodish).length,
    besideOver: wordCapOverflow(sentences).reduce((n, c) => n + c.paths.length, 0),
    periodWatch: new Set(periodWatchHits(periodOnly).map((h) => h.path)).size,
  };
}

type Draft = BaseDraft | TopicDraft | PeriodDraft | ChildPeriodDraft;

/** 초안의 문장 수 */
function draftSize(d: Draft): number {
  const notes = (ns: readonly PeriodNote[]) => ns.reduce((n, x) => n + x.sentences.length, 0);
  if ('periods' in d) return notes(d.periods);
  if ('seasons' in d) return notes(d.seasons) + notes(d.years);
  if ('sentences' in d) return d.sentences.length;
  return d.summary.length + d.traits.length + d.daewoonNotes.reduce((n, x) => n + x.sentences.length, 0) + d.yearly.thisYear.length + d.yearly.nextYear.length;
}

/** 사실 문장으로 바꾼 작업과 문장 수(D-049·D-050). 반복 줄이기 다시 만들기(:repeat)는 바꾸지 않는다 */
function templatedOf(log: readonly AttemptRecord[]): Pick<ReportBody, 'templated' | 'templatedSentences'> {
  const recs = log.filter((a) => (a.stopReason === 'deadlineTemplate' || a.stopReason === 'templatePatched') && (a.replacedSentences ?? 0) > 0);
  if (!recs.length) return {};
  return { templated: [...new Set(recs.map((a) => a.label))], templatedSentences: recs.reduce((n, a) => n + a.replacedSentences!, 0) };
}

/**
 * 칸을 가로지르는 반복 줄이기(D-045): 기본 리포트와 주제 칸은 따로(동시에) 만들어 서로의 문장을 모른다.
 * 다 만든 뒤 한 리포트에서 같은 풀이 말이 3문장 이상이면, 그 말을 쓴 주제 칸만 한 번 다시 만든다(앞 칸부터 차례로).
 * 다시 만들기가 실패하면(검증·검수·API) 원래 문장을 그대로 둔다. 주문을 실패시키지 않는 보조 단계다.
 */
async function reduceRepetition(
  baseTexts: readonly string[],
  topics: readonly TopicConfig[],
  first: readonly ReportSentence[][],
  regenerate: (topic: TopicConfig, avoid: readonly string[]) => Promise<ReportSentence[]>,
): Promise<ReportSentence[][]> {
  const current = [...first];
  for (const [i, topic] of topics.entries()) {
    const others = [...baseTexts, ...current.flatMap((xs, j) => (j === i ? [] : xs.map((s) => s.text)))];
    const otherCounts = repeatedWordCounts(others);
    const mine = repeatedWordCounts(current[i]!.map((s) => s.text));
    // 다른 칸에서 이미 두 번 이상 쓴 말을 이 칸이 또 썼다
    const avoid = [...mine.keys()].filter((w) => (otherCounts.get(w) ?? 0) >= 2);
    if (!avoid.length) continue;
    const forbidden = [...otherCounts].filter(([, n]) => n >= 2).map(([w]) => w);
    try {
      const next = await regenerate(topic, forbidden);
      // 다시 만든 칸이 다른 칸에서 이미 두 번 쓴 말을 하나도 쓰지 않았을 때만 바꾼다(1회 시도라 반복 검사를 거치지 않는다)
      const still = repeatedWordCounts(next.map((s) => s.text));
      if (!forbidden.some((w) => still.has(w))) current[i] = next;
    } catch {
      // 원래 문장을 둔다
    }
  }
  return current;
}
