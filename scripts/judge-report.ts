// 측정 결과 문장 판정(D-042 측정 보고용): measure-cost가 만든 리포트의 문장마다
// ① 인용한 근거와 연결이 맞는지 ② 어느 사주에나 붙을 수 있는 일반적인 문장인지를 실제 Claude API로 판정한다.
// 사용: npx tsx --env-file-if-exists=.env scripts/judge-report.ts --tag <측정 폴더> [--model claude-sonnet-5-5] [--judge claude-sonnet-5-5] [--budget 0.9]
// 예산은 호출 전에만 확인하므로 호출 1번(약 0.05 USD)만큼 넘을 수 있다.
// 실제 요금이 나가므로 사람이 승인한 뒤에만 실행한다. AI 판정은 후보를 고르는 용도이고, 최종 숫자는 사람이 판정 사유를 확인한 뒤 보고한다.
// 결과는 samples-output/<tag>/judge.json에 저장한다(문장·근거 id·판정만, 출생 정보는 담지 않는다).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildChart } from '../src/engine/chart';
import { buildEvidence } from '../src/engine/evidence';
import { MODEL_PRICES, costUsd, type TokenUsage } from '../src/llm/pricing';
import { SAMPLE_AS_OF, SAMPLE_INPUTS, SAMPLE_REFERENCE_YEAR } from '../src/llm/samples';
import { audienceOf, isChildChart } from '../src/report/audience';
import { AnthropicTransport } from '../src/llm/transport';
import type { ReportBody, ReportSentence } from '../src/llm/types';

const OUT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../samples-output');

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

/** 단가표에 없는 모델(새 폴백 모델 등)이 응답하면 가장 비싼 단가로 보수적으로 계산하고 기록한다 */
const unknownModels = new Set<string>();
const cost = (u: TokenUsage) => {
  const c = costUsd(u);
  if (c !== null) return c;
  unknownModels.add(u.model);
  const p = Object.values(MODEL_PRICES).reduce((a, x) => ({
    input: Math.max(a.input, x.input), output: Math.max(a.output, x.output),
    cacheRead: Math.max(a.cacheRead, x.cacheRead), cacheWrite: Math.max(a.cacheWrite, x.cacheWrite),
  }));
  return (u.inputTokens * p.input + u.outputTokens * p.output + u.cacheReadTokens * p.cacheRead + u.cacheWriteTokens * p.cacheWrite) / 1_000_000;
};

type Support = 'ok' | 'extra' | 'mismatch';
interface Verdict {
  key: string;
  support: Support;
  generic: boolean;
  awkward: boolean;
  childUnfit: boolean;
  contradiction: boolean;
  reason: string;
}

const SYSTEM = [
  '당신은 사주 리포트 문장의 검수자입니다. 문장마다 그 문장이 인용한 근거(사실 목록)만 보고 두 가지를 판정합니다.',
  '',
  '1) support (근거 연결)',
  '- ok: 문장에 나온 이 사람에 대한 사실(글자, 개수, 기운, 위치, 나이·연도, 흐름의 방향 등)이 모두 인용한 근거에 있고, 해석이 그 사실에서 무리 없이 나온다.',
  '- extra: 사실은 근거와 맞지만, 근거에 없는 사실을 새로 덧붙였다. 예: 근거에 없는 오행을 그해 기운으로 말함, "태어난 해"를 "어린 시절 환경"이라는 구체적 사실로 바꿔 말함.',
  '- mismatch: 문장의 사실이 인용한 근거와 다르거나(개수·글자·기운·시기가 틀림), 문장이 기대는 사실이 인용한 근거에 전혀 없다(다른 근거를 인용했어야 함).',
  '- 쉬운 말 대응: 나무=목, 불=화, 흙=토, 쇠=금, 물=수 / 자립·경쟁=비겁, 표현·재능=식상, 재물·활동=재성, 규칙·책임=관성, 배움·보살핌=인성 / 태어난 해·달·날·시=년·월·일·시주, 윗글자=천간, 아랫글자=지지, 나를 나타내는 글자=일간, 큰 흐름=대운.',
  '- 생활 조언(산책, 기록, 계획 세우기 등)은 사실이 아니므로 그 자체로 mismatch가 아닙니다. 조언이 근거의 사실과 이어지는지만 봅니다.',
  '',
  '2) generic (일반적인 문장)',
  '- true: 이 사람의 근거를 몰라도 어느 사주 리포트에나 그대로 넣을 수 있는 문장. 이 사람만의 사실(글자, 개수, 기운, 위치, 시기)을 하나도 담지 않거나, 담더라도 형식적이고 내용은 누구에게나 같은 말.',
  '- false: 이 사람의 사실을 담고, 그 사실 때문에 내용이 달라지는 문장.',
  '',
  '3) awkward (어색한 표현)',
  '- true: 한국어로 어색하거나 기계적인 문장. 예: 뜻 표기를 꾸밈말처럼 씀("표현·재능이 담긴 말투"), "7글자에서 0개라"처럼 숫자를 억지로 씀, 같은 꼴의 긴 구절을 그대로 되풀이함, 앞뒤 논리가 이어지지 않음, 자리의 의미를 덧붙임("사회 활동을 보여 주는 태어난 달").',
  '',
  '5) contradiction (같은 칸 안의 모순)',
  '- true: 같은 칸(같은 key 앞부분, 예: yearly.nextYear)의 다른 문장과 서로 반대되는 말을 한다. 예: 한 문장은 "감당하기 어렵지 않다", 다음 문장은 "부담을 줄이라". reason에 부딪치는 문장 key를 씁니다.',
  '',
  '4) childUnfit (아이 리포트에 맞지 않음) — 입력 맨 앞에 "아이 리포트"라고 적힌 경우에만 판정하고, 아니면 false',
  '- true: 부모가 아이를 관찰하고 돌볼 때 참고할 문장이 아니다. 예: 학업·직업·연애·대인관계·돈 관리 조언, 아이에게 직접 시키는 어른식 조언.',
  '',
  'reason은 한국어 한 문장(60자 이내)으로, ok가 아니거나 generic·awkward·childUnfit·contradiction 중 하나라도 true일 때 이유를 씁니다. 그 밖에는 빈 문자열입니다.',
  '입력으로 받은 모든 key에 대해 하나씩, 받은 순서대로 판정합니다.',
].join('\n');

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['verdicts'],
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'support', 'generic', 'awkward', 'childUnfit', 'contradiction', 'reason'],
        properties: {
          key: { type: 'string' },
          support: { type: 'string', enum: ['ok', 'extra', 'mismatch'] },
          generic: { type: 'boolean' },
          awkward: { type: 'boolean' },
          childUnfit: { type: 'boolean' },
          contradiction: { type: 'boolean' },
          reason: { type: 'string' },
        },
      },
    },
  },
};

function sentencesOf(body: ReportBody): { key: string; s: ReportSentence }[] {
  const list = (path: string, xs: ReportSentence[]) => xs.map((s, i) => ({ key: `${path}[${i}]`, s }));
  return [
    ...list('summary', body.summary),
    ...list('traits', body.traits),
    ...Object.entries(body.topics).flatMap(([id, xs]) => list(`topics.${id}`, xs)),
    ...body.daewoonNotes.flatMap((n, i) => list(`daewoonNotes[${i}]`, n.sentences)),
    ...list('yearly.thisYear', body.yearly.thisYear),
    ...list('yearly.nextYear', body.yearly.nextYear),
  ];
}

/** 띄어쓰기·문장부호를 지운 비교용 문장 (다른 사주에 똑같은 문장이 나왔는지 본다) */
const squash = (t: string) => t.replace(/[\s.,·!?~"'()]/gu, '');

interface MeasuredSample {
  sample: number;
  ok: boolean;
  body?: ReportBody;
}

async function main(): Promise<void> {
  const tag = arg('tag', '');
  if (!/^[A-Za-z0-9_-]+$/.test(tag)) throw new Error('--tag(측정 폴더 이름)를 지정하세요');
  const dir = join(OUT_ROOT, tag);
  const genModel = arg('model', 'claude-sonnet-5-5');
  const budget = Number(arg('budget', '0.9'));
  // 숫자가 아니면(NaN) 예산 비교가 늘 거짓이 되어 상한이 풀린다
  if (!Number.isFinite(budget) || budget <= 0) throw new Error('--budget은 0보다 큰 숫자여야 합니다');
  OUT_NAME = arg('out', 'judge.json');
  if (!/^[A-Za-z0-9_.-]+\.json$/u.test(OUT_NAME)) throw new Error('--out은 영문·숫자 .json 파일 이름이어야 합니다');
  // --judge: 판정 모델(D-046: Haiku 판정 일치율 측정). Haiku에는 서버 측 폴백이 없어 끈다. --out: 결과 파일 이름(기본 judge.json)
  const judgeModel = arg('judge', 'claude-sonnet-5-5');
  // --effort: 판정 노력도(기본 medium). 운영 검수 후보 비교용(D-046)
  const effort = arg('effort', 'medium');
  if (!['low', 'medium', 'high'].includes(effort)) throw new Error('--effort는 low·medium·high 중 하나입니다');
  const transport = new AnthropicTransport(judgeModel, undefined, { effort: effort as 'low' | 'medium' | 'high', maxTokens: 16_000, fallback: !/haiku/u.test(judgeModel) });
  const measured = JSON.parse(readFileSync(join(dir, `${genModel}.json`), 'utf8')) as { results: MeasuredSample[] };

  const state: State = { spent: 0, reports: [], errors: [], stoppedByBudget: false };
  for (const r of measured.results) {
    if (!r.ok || !r.body) continue;
    if (state.spent >= budget) {
      state.stoppedByBudget = true;
      process.stdout.write(`예산 ${budget} USD 도달: 샘플 ${r.sample}번부터 판정하지 않았습니다\n`);
      break;
    }
    // 샘플 하나가 실패해도 이미 결제한 판정은 남기고 다음 샘플로 넘어간다. 매 샘플 뒤에 저장한다
    try {
      state.reports.push(await judgeSample(transport, r.sample, r.body, state));
      process.stdout.write(`샘플 ${r.sample}번 판정 완료 (누적 ${state.spent.toFixed(3)} USD)\n`);
    } catch (e) {
      state.errors.push({ sample: r.sample, error: e instanceof Error ? e.message : String(e) });
      process.stdout.write(`샘플 ${r.sample}번 판정 실패: ${state.errors.at(-1)!.error}\n`);
    }
    save(dir, state);
  }
  process.stdout.write(`${JSON.stringify(save(dir, state), null, 2)}\n`);
}

type JudgedReport = { sample: number; sentences: number; verdicts: (Verdict & { text: string; evidenceIds: string[] })[]; usd: number; ms: number };
let OUT_NAME = 'judge.json';
interface State {
  spent: number;
  reports: JudgedReport[];
  errors: { sample: number; error: string }[];
  stoppedByBudget: boolean;
}

async function judgeSample(transport: AnthropicTransport, sample: number, body: ReportBody, state: State): Promise<JudgedReport> {
  const chart = buildChart(SAMPLE_INPUTS[sample]!, { referenceYear: SAMPLE_REFERENCE_YEAR });
  const evidence = buildEvidence(chart, { child: isChildChart(chart, SAMPLE_AS_OF) });
  const byId = new Map(evidence.map((e) => [e.id, e]));
  const items = sentencesOf(body);
  // 생성 때와 같은 기준 시각으로 아이 리포트인지 정한다
  // 13세 이후가 들어 있는 대운 칸은 부모 조언이 아니라 그 나이대 문장으로 쓰므로 childUnfit 판정에서 뺀다(D-045)
  const aud = audienceOf(chart, SAMPLE_AS_OF, body.daewoonNotes.map((n) => n.daewoonIndex));
  const grownNotes = aud.daewoon.flatMap((d, i) => (d.grown ? [`daewoonNotes[${i}](아이가 만 ${d.fromAge}~${d.toAge}세가 되는 시기)`] : []));
  const head = aud.child
    ? `아이 리포트(만 ${aud.age}세): 부모가 읽는 리포트입니다.${grownNotes.length ? ` 다만 ${grownNotes.join(', ')}는 그 나이대에 맞춰 쓰는 칸이라 childUnfit은 그 나이에 맞는지로 판정합니다.` : ''}\n\n`
    : '';
  const user =
    head +
    items
      .map(({ key, s }) => {
        const cited = s.evidenceIds.map((id) => `  - ${id}: ${byId.get(id)?.content ?? '(없는 근거)'}`).join('\n');
        return `[${key}] ${s.text}\n 인용한 근거:\n${cited}`;
      })
      .join('\n\n');
  const started = performance.now();
  const res = await transport.complete({ system: SYSTEM, user, jsonSchema: SCHEMA, label: 'judge' });
  const ms = Math.round(performance.now() - started);
  // 응답이 쓸모없어도 결제는 됐으니 비용부터 더한다
  const usd = res.usage.reduce((a, u) => a + cost(u), 0);
  state.spent += usd;
  if (res.stopReason === 'max_tokens') throw new Error(`출력 길이 상한에 걸림 (${usd.toFixed(4)} USD)`);
  if (!res.text) throw new Error(`판정 응답이 비었습니다 (${res.stopReason})`);
  const parsed = JSON.parse(res.text) as { verdicts: Verdict[] };
  const got = new Map(parsed.verdicts.map((v) => [v.key, v]));
  const missing = items.filter(({ key }) => !got.has(key)).map(({ key }) => key);
  if (missing.length) throw new Error(`판정이 빠진 문장 ${missing.join(', ')}`);
  return {
    sample,
    sentences: items.length,
    verdicts: items.map(({ key, s }) => ({ ...got.get(key)!, text: s.text, evidenceIds: s.evidenceIds })),
    usd: Number(usd.toFixed(4)),
    ms,
  };
}

/** 지금까지의 판정을 judge.json에 쓰고 요약을 돌려준다 */
function save(dir: string, state: State) {
  const reports = state.reports;
  // 다른 사주 2건 이상에 띄어쓰기·문장부호만 빼고 똑같이 나온 문장
  const seen = new Map<string, { text: string; samples: Set<number> }>();
  for (const rep of reports) {
    for (const v of rep.verdicts) {
      const k = squash(v.text);
      const entry = seen.get(k) ?? { text: v.text, samples: new Set<number>() };
      entry.samples.add(rep.sample);
      seen.set(k, entry);
    }
  }
  const repeated = [...seen.values()]
    .filter((e) => e.samples.size >= 2)
    .map((e) => ({ text: e.text, samples: [...e.samples] }))
    .sort((a, b) => b.samples.length - a.samples.length);

  const all = reports.flatMap((rep) => rep.verdicts.map((v) => ({ sample: rep.sample, ...v })));
  const summary = {
    judgedReports: reports.length,
    sentences: all.length,
    support: { ok: all.filter((v) => v.support === 'ok').length, extra: all.filter((v) => v.support === 'extra').length, mismatch: all.filter((v) => v.support === 'mismatch').length },
    generic: all.filter((v) => v.generic).length,
    awkward: all.filter((v) => v.awkward).length,
    childUnfit: all.filter((v) => v.childUnfit).length,
    contradiction: all.filter((v) => v.contradiction).length,
    /** 리포트 1건 판정에 걸린 시간(ms) */
    avgMs: reports.length ? Math.round(reports.reduce((s, r) => s + r.ms, 0) / reports.length) : 0,
    maxMs: reports.reduce((m, r) => Math.max(m, r.ms), 0),
    repeatedAcrossSamples: repeated.length,
    failedSamples: state.errors.map((e) => e.sample),
    stoppedByBudget: state.stoppedByBudget,
    unknownPriceModels: [...unknownModels],
    usd: Number(state.spent.toFixed(4)),
  };
  writeFileSync(
    join(dir, OUT_NAME),
    `${JSON.stringify({ summary, errors: state.errors, flagged: all.filter((v) => v.support !== 'ok' || v.generic || v.awkward || v.childUnfit || v.contradiction), repeated, reports }, null, 2)}\n`,
    'utf8',
  );
  return summary;
}

main().catch((e: unknown) => {
  process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
