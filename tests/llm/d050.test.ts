// D-050: 주문 실패 방지(검증·검수를 끝내 통과하지 못한 문장만 코드 사실 문장으로), 자리 의미 풀이의 낱말 끼움, 아이 리포트 "나를 뺀"
// (가짜 LLM, 실제 호출 없음)
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GENERATION, REPORT_LAYOUT } from '../../src/config/report';
import { buildChart } from '../../src/engine/chart';
import { buildEvidence } from '../../src/engine/evidence';
import { targetDaewoonIndices } from '../../src/llm/evidenceSelect';
import { fallbackBase, fallbackTopic, patchBase } from '../../src/llm/fallbackText';
import { CHILD_FORBIDDEN, CHILD_VOICE_FORBIDDEN, COMMON_FORBIDDEN, findForbidden } from '../../src/llm/forbidden';
import { generateReport } from '../../src/llm/generate';
import { SAMPLE_AS_OF, SAMPLE_INPUTS, SAMPLE_REFERENCE_YEAR } from '../../src/llm/samples';
import { topicEvidence } from '../../src/llm/evidenceSelect';
import { findTopic } from '../../src/config/topics';
import type { LlmRequest } from '../../src/llm/transport';
import { startGeneration } from '../../src/orders/generation';
import { MemoryStore } from '../../src/store/memory';
import { paidOrder } from '../web/helpers';
import { FakeModerator, FakeTransport, validResponder } from './fakes';

afterEach(() => vi.restoreAllMocks());

const chart = buildChart(SAMPLE_INPUTS[0]!, { referenceYear: SAMPLE_REFERENCE_YEAR });
const evidence = buildEvidence(chart);
const indices = targetDaewoonIndices(chart, SAMPLE_REFERENCE_YEAR, REPORT_LAYOUT.daewoonNoteCount);
const args = (transport: FakeTransport, topicIds: string[] = [], moderator = new FakeModerator()) => ({
  chart, evidence, topicIds, referenceYear: SAMPLE_REFERENCE_YEAR, transport, moderator, asOf: SAMPLE_AS_OF,
});

describe('1) 자리 의미 풀이: 낱말 사이에 다른 말이 끼어도 잡는다', () => {
  const hit = (text: string) => findForbidden(text, COMMON_FORBIDDEN).some((f) => f.reason.includes('시기·자리 해석'));
  it('"일찍부터 감각이 몸에 밴"처럼 사이에 말이 끼어도 잡는다', () => {
    for (const t of ['돈이 드나드는 감각이 일찍부터 몸에 밴 편이에요.', '일찍부터 감각이 몸에 밴 편이에요.', '일찍부터 돈 쓰는 법이 몸에 배어 있어요.', '일찍부터 일이 몸에 익은 편이에요.', '배우자의 자리를 뜻하는 글자예요.']) {
      expect(hit(t), t).toBe(true);
    }
  });
  it('하루 일과로서의 "일찍부터"와 쉼표 너머의 말은 잡지 않는다', () => {
    for (const t of [
      '하루를 일찍부터 시작하면 마음이 가벼워져요.', '일찍부터 일어나 몸에 좋은 음식을 챙겨 보세요.', '일찍부터 준비해 두고, 몸에 밴 습관은 그대로 두세요.',
      // 리뷰 반영: 하루 일과 조언에 "길러·익숙해"가 뒤따르는 문장
      '아침을 일찍부터 챙겨 먹는 습관을 길러 보면 좋아요.', '일찍부터 시작하면 익숙해지는 일이 많아요.',
    ]) {
      expect(hit(t), t).toBe(false);
    }
  });
});

describe('2) 아이 리포트(만 12세 이하): "나를 뺀"은 "아이를 나타내는 글자를 뺀"으로', () => {
  it('하드 금지어로 잡고 고칠 말을 알려 준다(어른 규칙에는 없다)', () => {
    const f = findForbidden('나를 뺀 5글자 중 자립·경쟁을 뜻하는 글자가 2개 있어요.', [...CHILD_FORBIDDEN, ...CHILD_VOICE_FORBIDDEN]);
    expect(f.map((x) => x.reason)).toContain('아이 리포트: "나를 뺀" 대신 "아이를 나타내는 글자를 뺀"으로 씁니다');
    expect(findForbidden('아이를 나타내는 글자를 뺀 5글자 중 2개예요.', [...CHILD_FORBIDDEN, ...CHILD_VOICE_FORBIDDEN])).toEqual([]);
    expect(findForbidden('나를 뺀 7글자 중 2개예요.', COMMON_FORBIDDEN)).toEqual([]);
  });
  it('2살 아이 리포트에서 "나를 뺀"을 쓰면 다시 쓰고, 끝내 고치지 못하면 그 문장만 사실 문장(아이 호칭)으로 바꾼다', async () => {
    const c4 = buildChart(SAMPLE_INPUTS[4]!, { referenceYear: SAMPLE_REFERENCE_YEAR });
    const i4 = targetDaewoonIndices(c4, SAMPLE_REFERENCE_YEAR, REPORT_LAYOUT.daewoonNoteCount);
    const ok = validResponder(i4);
    const t = new FakeTransport((req, call) => {
      const r = ok(req, call) as { body: any };
      if (req.label !== 'base') return r;
      return { body: { ...r.body, traits: r.body.traits.map((x: any, i: number) => (i === 1 ? { ...x, text: '나를 뺀 5글자 중에 기대는 마음이 보여요.' } : x)) } };
    });
    const r = await generateReport({ chart: c4, evidence: buildEvidence(c4), topicIds: [], referenceYear: SAMPLE_REFERENCE_YEAR, transport: t, moderator: new FakeModerator(), asOf: SAMPLE_AS_OF });
    const base = r.attempts.filter((a) => a.label === 'base');
    expect(base.slice(0, 3).every((a) => a.violations.some((v) => v.detail.includes('"나를 뺀" 대신')))).toBe(true);
    expect(r.body.traits[1]).toEqual(fallbackBase(c4, i4, { child: true }).traits[1]);
    expect(r.body.traits[1]!.text).toContain('아이를 나타내는 글자를 뺀');
    expect(r.body.templatedSentences).toBe(1);
  });
});

describe('3) 검증 3회 실패 → 걸린 문장만 사실 문장으로 대체 → 주문 성공', () => {
  it('주제 칸 3번째 문장이 매번 근거 없이 오면 그 문장만 바꾸고 나머지 AI 문장은 그대로 쓴다', async () => {
    const ok = validResponder(indices);
    const t = new FakeTransport((req, call) => {
      const r = ok(req, call) as { body: any };
      if (req.label !== 'topic:wealth') return r;
      return { body: { sentences: r.body.sentences.map((x: any, i: number) => (i === 2 ? { ...x, evidenceIds: [] } : x)) } };
    });
    const r = await generateReport(args(t, ['wealth']));
    const tpl = fallbackTopic(chart, topicEvidence(findTopic('wealth')!, chart, evidence), indices, { child: false });
    const wealth = r.body.topics.wealth!;
    expect(wealth[2]).toEqual(tpl.sentences[2]);
    expect(wealth.filter((s, i) => i !== 2).every((s) => s.text.includes('근거를 바탕으로 쓴'))).toBe(true);
    const rec = r.attempts.filter((a) => a.label === 'topic:wealth');
    // 3회 시도 → 바꾼 칸 검수(templatePatched) → 바꾼 기록(templatePatched, 문장 수)
    expect(rec.map((a) => a.stopReason)).toEqual(['end_turn', 'end_turn', 'end_turn', 'templatePatched', 'templatePatched']);
    expect(rec.at(-1)!.replacedSentences).toBe(1);
    expect(r.body).toMatchObject({ templated: ['topic:wealth'], templatedSentences: 1 });
  });

  it('바꾼 뒤 남은 AI 문장도 검수를 받고, 걸리면 그 문장도 사실 문장으로 바꾼다', async () => {
    const ok = validResponder(indices);
    const t = new FakeTransport((req, call) => {
      const r = ok(req, call) as { body: any };
      if (req.label !== 'topic:wealth') return r;
      return { body: { sentences: r.body.sentences.map((x: any, i: number) => (i === 0 ? { ...x, evidenceIds: [] } : i === 1 ? { ...x, text: '검수에 걸릴 문장이에요.' } : x)) } };
    });
    // 3회 동안은 하드 위반이라 검수에 가지 않고, 바꾼 뒤의 검수에서 1번 문장이 걸린다
    const m = new FakeModerator((items) => ({
      flags: items.filter((i) => i.text === '검수에 걸릴 문장이에요.').map((i) => ({ path: i.path, categories: ['medical' as const] })),
      calls: [{ attempt: 1, ok: true, usage: [] }],
    }));
    const r = await generateReport(args(t, ['wealth'], m));
    const wealth = r.body.topics.wealth!;
    expect(wealth.some((s) => s.text === '검수에 걸릴 문장이에요.')).toBe(false);
    expect(r.body.templatedSentences).toBe(2);
  });

  it('읽을 수 있는 응답이 한 번도 없으면 그 칸 전체를 사실 문장으로', async () => {
    const ok = validResponder(indices);
    const t = new FakeTransport((req: LlmRequest, call) => (req.label === 'base' ? { text: '{"broken": true}' } : ok(req, call)));
    const r = await generateReport(args(t));
    expect(r.body.traits).toEqual(fallbackBase(chart, indices, { child: false }).traits);
    expect(r.body.templated).toEqual(['base']);
  });

  it('바꿀 위치를 알 수 없는 위반(대운 칸 수 틀림 등)은 그 칸 묶음을 통째로 바꾼다', () => {
    const tpl = fallbackBase(chart, indices, { child: false });
    const ai = { ...tpl, daewoonNotes: [tpl.daewoonNotes[0]!].map((n) => ({ ...n, sentences: n.sentences.map((s) => ({ ...s, text: 'AI 문장이에요.' })) })) };
    const r = patchBase(ai, tpl, ['daewoonNotes']);
    expect(r.value.daewoonNotes).toEqual(tpl.daewoonNotes);
    // AI는 대운 칸 1개(3문장)만 썼지만 사실 문장 2칸(6문장)으로 채웠다(리뷰 반영)
    expect(r.replaced).toBe(tpl.daewoonNotes.reduce((n, x) => n + x.sentences.length, 0));
    expect(patchBase(ai, tpl, ['알 수 없는 위치']).value).toBe(tpl);
  });

  it('주문 단계: 모든 호출이 검증에 실패해도 주문은 완성(done)되고, 바꾼 문장 수가 기준을 넘으면 운영자 알림 로그를 남긴다', async () => {
    const store = new MemoryStore();
    const o = await paidOrder(store, { topicIds: ['wealth'] });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const broken = () => ({ transport: new FakeTransport(() => ({ text: '{"broken": true}' })), moderator: new FakeModerator() });
    await (await startGeneration(store, o.orderId, o.accessToken, broken)).job;
    const saved = (await store.getOrder(o.orderId))!;
    expect(saved.status).toBe('done');
    const report = (await store.getReport(o.orderId))!;
    expect(report.body.templated).toEqual(['base', 'topic:wealth']);
    expect(report.body.templatedSentences!).toBeGreaterThan(report.body.requestedSentences! * GENERATION.templateAlertRatio);
    const alert = warn.mock.calls.map((c) => String(c[0])).find((m) => m.startsWith('[생성 알림]'));
    expect(alert).toContain(`사실 문장으로 바꾼 문장 ${report.body.templatedSentences}개`);
    expect(alert).not.toMatch(/1990|생년월일/u);
    expect(info).not.toHaveBeenCalled();
  });

  it('주문 단계: 바꾼 문장이 기준 이하면 알림이 아니라 기록 로그만 남긴다', async () => {
    const store = new MemoryStore();
    const o = await paidOrder(store, { topicIds: ['wealth'] });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    // 개발용 가짜 모델과 같은 정상 응답 + 주제 칸 첫 문장만 늘 근거 없음 → 1문장 대체
    const one = () => {
      const t = new FakeTransport((req) => {
        const body = req.label === 'base' ? undefined : { sentences: Array.from({ length: REPORT_LAYOUT.topicSentences }, (_, i) => ({ text: `주제 풀이 문장 ${i + 1}이에요.`, evidenceIds: i === 0 ? [] : ['seun[0]'] })) };
        if (body) return { body };
        // 주문의 사주는 샘플과 달라 대운 순서를 요청 문구에서 읽는다
        const order = (/daewoonIndex ([\d, ]+) 순서로/u.exec(req.user)?.[1] ?? '0, 1').split(',').map((x) => Number(x.trim()));
        return validResponder(order)(req, 0);
      });
      return { transport: t, moderator: new FakeModerator() };
    };
    await (await startGeneration(store, o.orderId, o.accessToken, one)).job;
    expect((await store.getOrder(o.orderId))!.status).toBe('done');
    expect(warn.mock.calls.some((c) => String(c[0]).startsWith('[생성 알림]'))).toBe(false);
    expect(info.mock.calls.map((c) => String(c[0])).find((m) => m.startsWith('[생성]'))).toContain('사실 문장으로 바꾼 문장 1개');
  });
});
