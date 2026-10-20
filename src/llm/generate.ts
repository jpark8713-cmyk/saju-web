// 풀이 생성: 기본 리포트 1회 + 선택한 주제마다 1회 호출(병렬). 선택하지 않은 주제는 호출하지 않는다.
// 응답이 형식·근거·금지 표현(정규식) 검증을 통과하지 못하면 위반 내용을 알려 주고 다시 생성한다(최대 2회 재시도).
// 정규식을 통과한 문장만 AI 검수(moderation.ts)로 넘긴다. 검수에서 걸리면 다시 생성하고,
// 검수 호출 자체가 실패하면 문장을 통과시키지 않고 생성 실패로 처리한다(Docs/decisions.md D-020).
import { GENERATION, REPORT_LAYOUT } from '../config/report';
import { findTopic, type TopicConfig } from '../config/topics';
import type { Evidence, SajuChart } from '../engine/types';
import { summaryTemplate } from '../report/summaryTemplate';
import { targetDaewoonIndices, topicEvidence } from './evidenceSelect';
import { COMMON_FORBIDDEN } from './forbidden';
import { CATEGORY_KO, ModerationUnavailable, type ModerationCallRecord, type ModerationFlag, type Moderator } from './moderation';
import { SYSTEM_PROMPT, baseUserMessage, topicUserMessage } from './prompt';
import { BASE_JSON_SCHEMA, TOPIC_JSON_SCHEMA, parseBaseDraft, parseTopicDraft, type ParseResult } from './schema';
import type { TokenUsage } from './pricing';
import type { LlmTransport } from './transport';
import type { BaseDraft, ReportBody, ReportSentence, TopicDraft, Violation } from './types';
import { prepareRules, validateSection, type PreparedRules } from './validate';

export interface AttemptRecord {
  label: string;
  attempt: number;
  servedModel: string;
  stopReason: string | null;
  usage: TokenUsage[];
  violations: Violation[];
  /** AI 검수 기록 (정규식 검증을 통과한 시도에만). 걸린 범주와 문장 위치만 담고 원문은 담지 않는다 */
  moderation?: { flags: ModerationFlag[]; calls: ModerationCallRecord[] };
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
  /** AI 검수에 넘길 문장 (위치와 함께) */
  sentences: (value: T) => { path: string; text: string }[];
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

interface JobContext {
  transport: LlmTransport;
  moderator: Moderator;
  signal: AbortSignal;
  /** 모든 작업의 시도 기록 (실패해도 비용 기록이 남게 공유한다) */
  log: AttemptRecord[];
}

async function runJob<T>(ctx: JobContext, job: SectionJob<T>): Promise<{ value: T; attempts: AttemptRecord[] }> {
  const attempts: AttemptRecord[] = [];
  let previous: Violation[] = [];
  for (let attempt = 1; attempt <= GENERATION.maxAttempts; attempt++) {
    if (ctx.signal.aborted) throw new JobCancelled(job.label);
    const res = await ctx.transport.complete(
      { system: SYSTEM_PROMPT, user: job.buildUser(previous), jsonSchema: job.jsonSchema, label: job.label },
      ctx.signal,
    );
    const base = { label: job.label, attempt, servedModel: res.servedModel, stopReason: res.stopReason, usage: res.usage };
    const stop = stopViolation(res.stopReason);
    const parsed = stop.length ? null : job.parse(res.text ?? '');
    const violations: Violation[] = stop.length
      ? stop
      : parsed && !parsed.ok
        ? [{ code: 'schema', path: '', detail: parsed.detail }]
        : job.validate((parsed as { ok: true; value: T }).value);
    if (violations.length) {
      record(ctx, attempts, { ...base, violations });
      previous = violations;
      continue;
    }
    // 1차(정규식·구조) 통과 → 2차 AI 검수
    const value = (parsed as { ok: true; value: T }).value;
    let review;
    try {
      review = await ctx.moderator.review(job.sentences(value), ctx.signal);
    } catch (e) {
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
    if (!flagged.length) return { value, attempts };
    previous = flagged;
  }
  throw new GenerationError(job.label, attempts);
}

function record(ctx: JobContext, attempts: AttemptRecord[], r: AttemptRecord): void {
  attempts.push(r);
  ctx.log.push(r);
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

function validateBase(d: BaseDraft, rules: PreparedRules, daewoonIndices: readonly number[]): Violation[] {
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
      ...validateSection(n.sentences, `daewoonNotes[${i}]`, L.daewoonNoteSentences, rules),
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
}

export interface GenerateResult {
  body: ReportBody;
  attempts: AttemptRecord[];
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
  const template = summaryTemplate(args.chart);
  const baseRules = prepareRules({ evidence: args.evidence, forbidden: COMMON_FORBIDDEN, maxChars: REPORT_LAYOUT.maxSentenceChars });
  const templateViolations = validateSection(template, 'summaryTemplate', REPORT_LAYOUT.summaryTemplateSentences, baseRules);
  if (templateViolations.length) {
    throw new Error(`총평 템플릿이 검증을 통과하지 못했습니다: ${JSON.stringify(templateViolations)}`);
  }
  const daewoonIndices = targetDaewoonIndices(args.chart, args.referenceYear, REPORT_LAYOUT.daewoonNoteCount);

  const controller = new AbortController();
  const ctx: JobContext = { transport: args.transport, moderator: args.moderator, signal: controller.signal, log: [] };
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

  const baseJob = runJob<BaseDraft>(ctx, {
    label: 'base',
    jsonSchema: BASE_JSON_SCHEMA,
    buildUser: (violations) =>
      baseUserMessage({ evidence: args.evidence, templateSummary: template, daewoonIndices, thisYear: args.referenceYear, violations }),
    parse: parseBaseDraft,
    validate: (d) => validateBase(d, baseRules, daewoonIndices),
    sentences: baseSentences,
  });

  const topicJobs = topics.map((topic) => {
    const evidence = topicEvidence(topic, args.chart, args.evidence);
    const rules = prepareRules({
      evidence,
      forbidden: [...COMMON_FORBIDDEN, ...topic.extraForbidden],
      maxChars: REPORT_LAYOUT.maxSentenceChars,
    });
    return runJob<TopicDraft>(ctx, {
      label: `topic:${topic.id}`,
      jsonSchema: TOPIC_JSON_SCHEMA,
      buildUser: (violations) => topicUserMessage({ topic, evidence, violations }),
      parse: parseTopicDraft,
      validate: (d) => validateSection(d.sentences, `topics.${topic.id}`, REPORT_LAYOUT.topicSentences, rules),
      sentences: (d) => sentencesOf(`topics.${topic.id}`, d.sentences),
    }).then((r) => ({ id: topic.id, ...r }));
  });

  const settled = await Promise.allSettled([guard(baseJob), ...topicJobs.map(guard)]);
  if (failed) {
    if (firstFailure instanceof GenerationError) throw new GenerationError(firstFailure.label, ctx.log, firstFailure.reason);
    throw new GenerationInterrupted(ctx.log, firstFailure);
  }
  const [base, ...topicResults] = settled.map((r) => (r as PromiseFulfilledResult<unknown>).value) as [
    Awaited<typeof baseJob>,
    ...Awaited<(typeof topicJobs)[number]>[],
  ];
  return {
    body: {
      summary: [...template, ...base.value.summary],
      traits: base.value.traits,
      topics: Object.fromEntries(topicResults.map((t) => [t.id, t.value.sentences])),
      daewoonNotes: base.value.daewoonNotes,
      yearly: base.value.yearly,
    },
    attempts: ctx.log,
  };
}
