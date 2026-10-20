// 비용 측정 + 샘플 생성: 샘플 출생 정보로 실제 Claude API를 호출해 기본 리포트·주제별 토큰과 비용을 잰다.
// 사용: npm run measure:cost -- [--models claude-opus-5-5,claude-sonnet-5-5] [--offset 0] [--samples 10] [--budget 10] [--tag run2]
// 실제 요금이 나가므로 사람이 승인한 뒤에만 실행한다. 누적 비용이 --budget(USD)을 넘으면 멈춘다.
// 결과(문장·시도 기록·사용량)는 samples-output/에 저장한다. 출생 정보 원문은 저장·출력하지 않는다.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPORT_LAYOUT } from '../src/config/report';
import { TOPICS, enabledTopics } from '../src/config/topics';
import { buildChart } from '../src/engine/chart';
import { buildEvidence } from '../src/engine/evidence';
import { topicEvidence } from '../src/llm/evidenceSelect';
import { COMMON_FORBIDDEN } from '../src/llm/forbidden';
import { GenerationError, GenerationInterrupted, generateReport, type AttemptRecord } from '../src/llm/generate';
import { MODEL_PRICES, costUsd, type TokenUsage } from '../src/llm/pricing';
import { SAMPLE_INPUTS, SAMPLE_REFERENCE_YEAR } from '../src/llm/samples';
import { LlmModerator, MODERATION_MODEL } from '../src/llm/moderation';
import { evidenceReuse, sumReuse } from '../src/llm/reuseMetric';
import { AnthropicTransport, type LlmRequest, type LlmResponse, type LlmTransport } from '../src/llm/transport';
import type { ReportBody, ReportSentence } from '../src/llm/types';
import { prepareRules, validateSentence } from '../src/llm/validate';

const OUT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../samples-output');

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

class BudgetExceeded extends Error {}

/** 단가표에 없는 모델이 응답하면(새 폴백 모델 등) 가장 비싼 단가로 보수적으로 계산하고 표시한다 */
const unknownModels = new Set<string>();
function safeCost(u: TokenUsage): number {
  const known = costUsd(u);
  if (known !== null) return known;
  unknownModels.add(u.model);
  const worst = Object.values(MODEL_PRICES).reduce((a, p) => ({
    input: Math.max(a.input, p.input), output: Math.max(a.output, p.output),
    cacheRead: Math.max(a.cacheRead, p.cacheRead), cacheWrite: Math.max(a.cacheWrite, p.cacheWrite),
  }));
  return (u.inputTokens * worst.input + u.outputTokens * worst.output + u.cacheReadTokens * worst.cacheRead + u.cacheWriteTokens * worst.cacheWrite) / 1_000_000;
}

/**
 * 호출마다 비용을 더하고 예산을 넘으면 다음 호출을 막는다.
 * 한 리포트의 호출(기본 + 주제 3개)은 동시에 시작하므로, 예산은 그만큼(약 1리포트분) 넘을 수 있다.
 */
/** 호출 한 번의 소요 시간 (재시도·검수 호출도 각각 한 번) */
interface CallTiming {
  label: string;
  ms: number;
  ok: boolean;
}

class BudgetedTransport implements LlmTransport {
  static spent = 0;
  static timings: CallTiming[] = [];
  constructor(private readonly inner: LlmTransport, private readonly budgetUsd: number) {}
  get model(): string {
    return this.inner.model;
  }
  async complete(req: LlmRequest, signal?: AbortSignal): Promise<LlmResponse> {
    if (BudgetedTransport.spent >= this.budgetUsd) throw new BudgetExceeded(`예산 ${this.budgetUsd} USD 도달`);
    const started = performance.now();
    try {
      const res = await this.inner.complete(req, signal);
      BudgetedTransport.timings.push({ label: req.label, ms: Math.round(performance.now() - started), ok: true });
      BudgetedTransport.spent += res.usage.reduce((a, u) => a + safeCost(u), 0);
      return res;
    } catch (e) {
      BudgetedTransport.timings.push({ label: req.label, ms: Math.round(performance.now() - started), ok: false });
      throw e;
    }
  }
}

/** 생성 호출 + 그 시도에 딸린 AI 검수 호출의 비용 */
function attemptCost(a: AttemptRecord): number {
  const moderationUsage = (a.moderation?.calls ?? []).flatMap((c) => c.usage);
  return [...a.usage, ...moderationUsage].reduce((s, u) => s + safeCost(u), 0);
}

function allSentences(body: ReportBody): { path: string; s: ReportSentence }[] {
  const list = (path: string, xs: ReportSentence[]) => xs.map((s, i) => ({ path: `${path}[${i}]`, s }));
  return [
    ...list('summary', body.summary),
    ...list('traits', body.traits),
    ...Object.entries(body.topics).flatMap(([id, xs]) => list(`topics.${id}`, xs)),
    ...body.daewoonNotes.flatMap((n, i) => list(`daewoonNotes[${i}]`, n.sentences)),
    ...list('yearly.thisYear', body.yearly.thisYear),
    ...list('yearly.nextYear', body.yearly.nextYear),
  ];
}

interface SampleResult {
  sample: number;
  ok: boolean;
  error?: string;
  attempts: (Omit<AttemptRecord, 'usage'> & { usage: AttemptRecord['usage']; costUsd: number })[];
  body?: ReportBody;
  /** 최종 문장 재검사: 근거 외 간지 언급, 근거 id 문제 */
  recheck?: { sentences: number; offEvidenceTerms: number; badEvidenceIds: number };
  /** 리포트 1건 생성에 걸린 전체 시간(기본·주제 호출이 병렬로 돈다) */
  reportMs?: number;
  /** 이 샘플의 호출별 소요 시간 */
  timings?: CallTiming[];
}

async function runModel(
  model: string,
  offset: number,
  samples: number,
  budget: number,
): Promise<{ results: SampleResult[]; stoppedByBudget: boolean }> {
  const transport = new BudgetedTransport(new AnthropicTransport(model), budget);
  // AI 검수는 Haiku(서버 측 폴백 없음, 노력도 low). 같은 예산에 함께 잡힌다
  const moderator = new LlmModerator(
    new BudgetedTransport(new AnthropicTransport(MODERATION_MODEL, undefined, { fallback: false, effort: 'low', maxTokens: 4_000 }), budget),
  );
  const topicIds = enabledTopics().map((t) => t.id);
  const results: SampleResult[] = [];
  for (let i = offset; i < offset + samples; i++) {
    const chart = buildChart(SAMPLE_INPUTS[i]!, { referenceYear: SAMPLE_REFERENCE_YEAR });
    const evidence = buildEvidence(chart);
    const timingStart = BudgetedTransport.timings.length;
    const started = performance.now();
    try {
      const r = await generateReport({ chart, evidence, topicIds, referenceYear: SAMPLE_REFERENCE_YEAR, transport, moderator });
      // 결제된 시도 기록을 먼저 남기고, 재검사가 실패해도 기록은 잃지 않는다
      const result: SampleResult = {
        sample: i,
        ok: true,
        attempts: r.attempts.map((a) => ({ ...a, costUsd: attemptCost(a) })),
        body: r.body,
        reportMs: Math.round(performance.now() - started),
        timings: BudgetedTransport.timings.slice(timingStart),
      };
      results.push(result);
      try {
        const rules = prepareRules({ evidence, forbidden: COMMON_FORBIDDEN, maxChars: REPORT_LAYOUT.maxSentenceChars });
        const all = allSentences(r.body);
        // 주제 문장은 그 주제에 넘긴 근거 기준으로도 이미 검증됐다. 여기서는 전체 근거 기준으로 한 번 더 본다
        const v = all.flatMap(({ path, s }) => validateSentence(s, path, rules));
        result.recheck = {
          sentences: all.length,
          offEvidenceTerms: v.filter((x) => x.code === 'termNotInEvidence').length,
          badEvidenceIds: v.filter((x) => x.code === 'noEvidence' || x.code === 'unknownEvidence').length,
        };
      } catch (e) {
        result.error = `재검사 실패: ${e instanceof Error ? e.message : String(e)}`;
      }
    } catch (e) {
      // 실패한 샘플도 이미 결제된 시도 기록을 남긴다
      const attempts = e instanceof GenerationError || e instanceof GenerationInterrupted ? e.attempts : [];
      results.push({
        sample: i,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
        attempts: attempts.map((a) => ({ ...a, costUsd: attemptCost(a) })),
      });
      if (e instanceof GenerationInterrupted && e.cause instanceof BudgetExceeded) {
        process.stdout.write(`${e.cause.message}: 여기까지의 결과를 저장하고 멈춥니다\n`);
        return { results, stoppedByBudget: true };
      }
    }
    process.stdout.write(`${model} 샘플 ${i}번 완료 (${i - offset + 1}/${samples}, 누적 ${BudgetedTransport.spent.toFixed(3)} USD)\n`);
  }
  return { results, stoppedByBudget: false };
}

function summarize(model: string, results: SampleResult[]) {
  const all = results.flatMap((r) => r.attempts);
  const byLabel = (label: string) => all.filter((a) => a.label === label);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  /** 한 샘플 안에서 같은 호출의 시도 비용을 합한 뒤 평균 (재시도 비용 포함) */
  const perCall = (label: string) =>
    avg(results.map((r) => r.attempts.filter((a) => a.label === label).reduce((s, a) => s + a.costUsd, 0)).filter((c) => c > 0));
  const tokens = (label: string) => ({
    input: avg(byLabel(label).map((a) => a.usage.reduce((s, u) => s + u.inputTokens + u.cacheReadTokens + u.cacheWriteTokens, 0))),
    output: avg(byLabel(label).map((a) => a.usage.reduce((s, u) => s + u.outputTokens, 0))),
  });
  const labels = ['base', ...TOPICS.filter((t) => t.enabled).map((t) => `topic:${t.id}`)];
  const firstTry = labels.map((l) => {
    const firsts = byLabel(l).filter((a) => a.attempt === 1);
    return { label: l, firstPass: firsts.filter((a) => a.violations.length === 0).length, total: firsts.length };
  });
  return {
    model,
    samples: results.length,
    succeeded: results.filter((r) => r.ok).length,
    perCallUsd: Object.fromEntries(labels.map((l) => [l, Number(perCall(l).toFixed(4))])),
    avgTokensPerAttempt: Object.fromEntries(labels.map((l) => [l, tokens(l)])),
    firstAttemptPass: firstTry,
    retries: all.filter((a) => a.attempt > 1).length,
    fallbackServed: all.filter((a) => a.servedModel !== model).length,
    moderation: {
      calls: all.reduce((n, a) => n + (a.moderation?.calls.length ?? 0), 0),
      failedCalls: all.reduce((n, a) => n + (a.moderation?.calls.filter((c) => !c.ok).length ?? 0), 0),
      flaggedSentences: all.reduce((n, a) => n + (a.moderation?.flags.length ?? 0), 0),
      /** 걸린 범주별 횟수 (문장 원문은 기록하지 않는다) */
      categories: all
        .flatMap((a) => a.moderation?.flags.flatMap((f) => f.categories) ?? [])
        .reduce<Record<string, number>>((m, c) => ({ ...m, [c]: (m[c] ?? 0) + 1 }), {}),
      usd: Number(
        all.reduce((s, a) => s + (a.moderation?.calls ?? []).flatMap((c) => c.usage).reduce((x, u) => x + safeCost(u), 0), 0).toFixed(4),
      ),
    },
    violationCodes: all.flatMap((a) => a.violations.map((v) => v.code)).reduce<Record<string, number>>((m, c) => ({ ...m, [c]: (m[c] ?? 0) + 1 }), {}),
    /** 대운 시작 표기 위반(D-022): 호출(샘플×라벨) 단위로 센다 */
    daewoonStartFormat: (() => {
      const calls = results.flatMap((r) => [...new Set(r.attempts.map((a) => a.label))].map((label) => r.attempts.filter((a) => a.label === label)));
      const has = (a: AttemptRecord) => a.violations.some((v) => v.code === 'daewoonStartFormat');
      return {
        calls: calls.length,
        callsWithFirstAttemptViolation: calls.filter((c) => c.some((a) => a.attempt === 1 && has(a))).length,
        callsWithAnyViolation: calls.filter((c) => c.some(has)).length,
      };
    })(),
    /** 근거 반복(D-023 C): 최종 리포트 기준 */
    evidenceReuse: sumReuse(results.flatMap((r) => (r.body ? [evidenceReuse(r.body)] : []))),
    recheck: {
      sentences: results.reduce((s, r) => s + (r.recheck?.sentences ?? 0), 0),
      offEvidenceTerms: results.reduce((s, r) => s + (r.recheck?.offEvidenceTerms ?? 0), 0),
      badEvidenceIds: results.reduce((s, r) => s + (r.recheck?.badEvidenceIds ?? 0), 0),
    },
    totalUsd: Number(all.reduce((s, a) => s + a.costUsd, 0).toFixed(4)),
    /** 소요 시간(ms): 성공한 리포트의 전체 시간, 호출 종류별 한 번의 시간 */
    timing: (() => {
      const stat = (xs: number[]) => ({ n: xs.length, avgMs: xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0, maxMs: xs.length ? Math.max(...xs) : 0 });
      const calls = results.flatMap((r) => r.timings ?? []).filter((t) => t.ok);
      const labels = [...new Set(calls.map((t) => t.label))].sort();
      return {
        report: stat(results.filter((r) => r.ok && r.reportMs !== undefined).map((r) => r.reportMs!)),
        perCall: Object.fromEntries(labels.map((l) => [l, stat(calls.filter((t) => t.label === l).map((t) => t.ms))])),
      };
    })(),
  };
}

async function main(): Promise<void> {
  const models = arg('models', 'claude-opus-5-5,claude-sonnet-5-5').split(',');
  // --offset: 시작할 샘플 번호(0부터), --tag: 결과 하위 폴더 이름(이전 실행 결과를 덮어쓰지 않게)
  const offset = Number(arg('offset', '0'));
  const samples = Math.min(Number(arg('samples', '10')), SAMPLE_INPUTS.length - offset);
  if (!Number.isInteger(offset) || offset < 0 || !(samples >= 1)) throw new Error('--offset/--samples 값이 샘플 범위를 벗어났습니다');
  const tag = arg('tag', '');
  if (tag && !/^[A-Za-z0-9_-]+$/.test(tag)) throw new Error('--tag는 영문·숫자·-·_만 쓸 수 있습니다');
  const OUT_DIR = tag ? join(OUT_ROOT, tag) : OUT_ROOT;
  const budget = Number(arg('budget', '10'));
  mkdirSync(OUT_DIR, { recursive: true });
  const summaries = [];
  for (const model of models) {
    const { results, stoppedByBudget } = await runModel(model, offset, samples, budget);
    const summary = { ...summarize(model, results), stoppedByBudget, unknownPriceModels: [...unknownModels] };
    summaries.push(summary);
    writeFileSync(join(OUT_DIR, `${model}.json`), `${JSON.stringify({ summary, results }, null, 2)}\n`, 'utf8');
    if (stoppedByBudget) break;
  }
  writeFileSync(join(OUT_DIR, 'summary.json'), `${JSON.stringify(summaries, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(summaries, null, 2)}\n`);
  // 주제당 근거 수(입력 크기 참고)
  const c = buildChart(SAMPLE_INPUTS[0]!, { referenceYear: SAMPLE_REFERENCE_YEAR });
  const ev = buildEvidence(c);
  process.stdout.write(`근거 수: 전체 ${ev.length}, ${TOPICS.map((t) => `${t.id} ${topicEvidence(t, c, ev).length}`).join(', ')}\n`);
}

main().catch((e: unknown) => {
  process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
