// 쉬운 말 전환(D-042) 확인용: 사주 1건으로 실제 Claude API를 한 번 불러 바뀐 프롬프트의 문장을 만든다.
// 사용: npx tsx --env-file-if-exists=.env scripts/compare-plain.ts --out <파일> [--budget 0.5]
// 실제 요금이 나가므로 사람이 승인한 뒤에만 실행한다. 출생 정보는 아래 고정 입력(신고된 사례)만 쓰고, 결과 파일에는 문장·근거 id·비용만 담는다.
import { writeFileSync } from 'node:fs';
import { buildChart } from '../src/engine/chart';
import { buildEvidence } from '../src/engine/evidence';
import { GenerationError, GenerationInterrupted, generateReport, type AttemptRecord } from '../src/llm/generate';
import { findJargon } from '../src/llm/jargon';
import { LlmModerator, MODERATION_MODEL } from '../src/llm/moderation';
import { costUsd, type TokenUsage } from '../src/llm/pricing';
import { AnthropicTransport, type LlmRequest, type LlmResponse, type LlmTransport } from '../src/llm/transport';
import { validateBirthFormOnServer } from '../src/web/birthServer';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

/** 단가표에 없는 모델이면 비용을 알 수 없으니 멈춘다 */
const cost = (u: TokenUsage) => {
  const c = costUsd(u);
  if (c === null) throw new Error(`단가를 모르는 모델: ${u.model}`);
  return c;
};

class Budgeted implements LlmTransport {
  static spent = 0;
  constructor(private readonly inner: LlmTransport, private readonly budget: number) {}
  get model(): string {
    return this.inner.model;
  }
  async complete(req: LlmRequest, signal?: AbortSignal): Promise<LlmResponse> {
    if (Budgeted.spent >= this.budget) throw new Error(`예산 ${this.budget} USD 도달`);
    const res = await this.inner.complete(req, signal);
    Budgeted.spent += res.usage.reduce((a, u) => a + cost(u), 0);
    return res;
  }
}

const attemptUsd = (a: AttemptRecord) => [...a.usage, ...(a.moderation?.calls ?? []).flatMap((c) => c.usage)].reduce((s, u) => s + cost(u), 0);

async function main(): Promise<void> {
  const out = arg('out', '');
  if (!out) throw new Error('--out 파일을 지정하세요');
  const budget = Number(arg('budget', '0.5'));
  // 계산 오류 사례(가상 데이터): 음력 1967-07-01 08시(분 모름), 경남 남해군, 남 / 주제: 재물(변경 전 리포트와 같다)
  const r = validateBirthFormOnServer({
    name: '', calendar: 'lunar', isLeapMonth: false, year: 1967, month: 7, day: 1, timeUnknown: false, hour: 8,
    minuteUnknown: true, gender: 'male', regionId: 'gyeongnam:남해군', consent: true,
  });
  if (!r.ok) throw new Error('입력 오류');
  const chart = buildChart(r.value.input, { referenceYear: 2026 });
  const evidence = buildEvidence(chart);
  const transport = new Budgeted(new AnthropicTransport(), budget);
  const moderator = new LlmModerator(new Budgeted(new AnthropicTransport(MODERATION_MODEL, undefined, { fallback: false, effort: 'low', maxTokens: 4_000 }), budget));
  try {
    const res = await generateReport({ chart, evidence, topicIds: ['wealth'], referenceYear: 2026, transport, moderator });
    const b = res.body;
    const all = [...b.summary, ...b.traits, ...Object.values(b.topics).flat(), ...b.daewoonNotes.flatMap((n) => n.sentences), ...b.yearly.thisYear, ...b.yearly.nextYear];
    const report = {
      model: transport.model,
      body: b,
      attempts: res.attempts.map((a) => ({ label: a.label, attempt: a.attempt, servedModel: a.servedModel, violations: a.violations, usd: Number(attemptUsd(a).toFixed(4)) })),
      totalUsd: Number(res.attempts.reduce((s, a) => s + attemptUsd(a), 0).toFixed(4)),
      jargonSentences: all.filter((s) => findJargon(s.text).length > 0).length,
    };
    writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    process.stdout.write(`완료: 시도 ${res.attempts.length}회, ${report.totalUsd} USD\n`);
  } catch (e) {
    const attempts = e instanceof GenerationError || e instanceof GenerationInterrupted ? e.attempts : [];
    writeFileSync(out, `${JSON.stringify({ error: e instanceof Error ? e.message : String(e), attempts: attempts.map((a) => ({ label: a.label, attempt: a.attempt, violations: a.violations, usd: Number(attemptUsd(a).toFixed(4)) })) }, null, 2)}\n`, 'utf8');
    throw e;
  }
}

main().catch((e: unknown) => {
  process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
