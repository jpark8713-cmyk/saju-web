// 풀이 생성 흐름 (가짜 LLM, 실제 호출 없음)
import { describe, expect, it } from 'vitest';
import { REPORT_LAYOUT } from '../../src/config/report';
import { findTopic } from '../../src/config/topics';
import { buildChart } from '../../src/engine/chart';
import { buildEvidence } from '../../src/engine/evidence';
import { targetDaewoonIndices, topicEvidence } from '../../src/llm/evidenceSelect';
import { GenerationError, GenerationInterrupted, generateReport } from '../../src/llm/generate';
import { SAMPLE_INPUTS, SAMPLE_REFERENCE_YEAR } from '../../src/llm/samples';
import { fallbackBase } from '../../src/llm/fallbackText';
import { summaryTemplate } from '../../src/report/summaryTemplate';
import { FakeModerator, FakeTransport, evidenceIdsIn, validBase, validResponder, validTopic, yearGroupsOf } from './fakes';

const chart = buildChart(SAMPLE_INPUTS[0]!, { referenceYear: SAMPLE_REFERENCE_YEAR });
const evidence = buildEvidence(chart);
const indices = targetDaewoonIndices(chart, SAMPLE_REFERENCE_YEAR, REPORT_LAYOUT.daewoonNoteCount);
const groups = yearGroupsOf(chart);
const args = (transport: FakeTransport, topicIds: string[], moderator: FakeModerator = new FakeModerator()) => ({
  chart, evidence, topicIds, referenceYear: SAMPLE_REFERENCE_YEAR, transport, moderator,
});

describe('generateReport', () => {
  it('기본 리포트 + 선택한 주제만 호출하고, 총평은 템플릿 문장으로 시작한다', async () => {
    const t = new FakeTransport(validResponder(indices));
    const r = await generateReport(args(t, ['wealth']));
    // D-052: 월별·10년 흐름 호출 2개도 함께 간다
    expect(t.requests.map((q) => q.label).sort()).toEqual(['base', 'decade', 'monthly', 'topic:wealth']);
    expect(Object.keys(r.body.topics)).toEqual(['wealth']);
    const template = summaryTemplate(chart);
    expect(r.body.summary.slice(0, 2)).toEqual(template);
    expect(r.body.summary).toHaveLength(REPORT_LAYOUT.summaryTemplateSentences + REPORT_LAYOUT.summaryAiSentences);
    expect(r.attempts.every((a) => a.attempt === 1 && a.violations.length === 0)).toBe(true);
  });

  it('주제를 고르지 않으면 주제 호출 없이 기본 리포트와 월별·10년 흐름만 호출한다', async () => {
    const t = new FakeTransport(validResponder(indices));
    const r = await generateReport(args(t, []));
    expect(t.requests.map((q) => q.label)).toEqual(['base', 'monthly', 'decade']);
    expect(r.body.topics).toEqual({});
  });

  it('없는 주제나 꺼진 주제는 거부한다', async () => {
    const t = new FakeTransport(validResponder(indices));
    await expect(generateReport(args(t, ['health']))).rejects.toThrow('사용할 수 없는 주제');
    expect(t.requests).toHaveLength(0);
  });

  it('주제 호출: 1차 거부 → 2차 통과, 재시도 메시지에 위반 내용이 들어간다', async () => {
    let topicCalls = 0;
    const t = new FakeTransport((req) => {
      if (req.label === 'base') return { body: validBase(indices, ['dayMaster'], groups) };
      topicCalls++;
      const ok = validTopic(['seun[0]']);
      return topicCalls === 1 ? { body: { sentences: [{ text: '근거 없는 문장이에요.', evidenceIds: [] }] } } : { body: ok };
    });
    const r = await generateReport(args(t, ['career']));
    const topicAttempts = r.attempts.filter((a) => a.label === 'topic:career');
    expect(topicAttempts.map((a) => a.violations.length > 0)).toEqual([true, false]);
    const retryReq = t.requests.filter((q) => q.label === 'topic:career')[1]!;
    expect(retryReq.user).toContain('이전 응답이 어긴 규칙');
    expect(retryReq.user).toContain('근거 id 없음');
  });

  it('D-050: 3회 모두 형식이 틀려도 주문은 끝난다(기본 칸 전체를 코드 사실 문장으로, 시도 기록 포함)', async () => {
    const t = new FakeTransport((req) =>
      req.label === 'base' ? { text: '{"summary": 1}' } : { body: validTopic(['seun[0]']) },
    );
    const r = await generateReport(args(t, []));
    const base = r.attempts.filter((a) => a.label === 'base');
    expect(base.map((a) => (a.stopReason === 'templatePatched' ? 'patched' : a.violations[0]?.code))).toEqual(['schema', 'schema', 'schema', 'patched']);
    expect(r.body.templated).toEqual(['base']);
    expect(r.body.traits).toEqual(fallbackBase(chart, indices, { child: false }).traits);
    expect(r.body.templatedSentences).toBe(base.at(-1)!.replacedSentences);
  });

  it('JSON이 아니거나 거절(refusal)·길이 초과면 재시도한다', async () => {
    const replies = [{ text: '이건 JSON이 아니에요' }, { stopReason: 'refusal', text: null }, { stopReason: 'max_tokens', text: '{' }];
    let n = 0;
    const t = new FakeTransport(() => (n < 3 ? replies[n++]! : { body: validBase(indices, ['dayMaster'], groups) }));
    const r = await generateReport(args(t, []));
    expect(r.attempts.filter((a) => a.label === 'base' && a.stopReason !== 'templatePatched').map((a) => a.violations[0]?.code)).toEqual(['schema', 'refusal', 'maxTokens']);
  });

  it('대운 해설은 지정한 대운 순서와 그 대운 근거 인용을 지킨다', async () => {
    const wrong = validBase(indices, ['dayMaster'], groups);
    const swapped = { ...wrong, daewoonNotes: [...wrong.daewoonNotes].reverse() };
    let n = 0;
    const t = new FakeTransport(() => ({ body: n++ === 0 ? swapped : validBase(indices, ['dayMaster'], groups) }));
    const r = await generateReport(args(t, []));
    const base = r.attempts.filter((a) => a.label === 'base');
    expect(base[0]!.violations.map((v) => v.code)).toContain('wrongDaewoon');
    expect(base).toHaveLength(2);
  });
});

describe('주제별 근거 선택', () => {
  it('주제 호출에는 그 주제 설정의 근거와 공통 근거만 들어간다', async () => {
    const t = new FakeTransport(validResponder(indices));
    await generateReport(args(t, ['wealth', 'career']));
    const wealthIds = evidenceIdsIn(t.requests.find((q) => q.label === 'topic:wealth')!.user);
    const expected = topicEvidence(findTopic('wealth')!, chart, evidence).map((e) => e.id);
    expect(wealthIds).toEqual(expected);
    expect(wealthIds).not.toContain('tenGodGroup.gwanseong');
    expect(wealthIds).toContain('tenGodGroup.jaeseong');
    const careerIds = evidenceIdsIn(t.requests.find((q) => q.label === 'topic:career')!.user);
    expect(careerIds).toContain('pillar.month.branch');
  });

  it('기본 리포트 호출에는 출생 정보 원문이 들어가지 않는다', async () => {
    const t = new FakeTransport(validResponder(indices));
    await generateReport(args(t, ['love']));
    for (const q of t.requests) {
      expect(q.user).not.toMatch(/1990|14:30|05-15|5월 15일/);
      expect(q.system).not.toMatch(/1990/);
    }
  });
});

describe('한 작업이 실패하면', () => {
  it('나머지 작업의 남은 시도를 취소하고, 모든 작업의 시도 기록을 에러에 담는다 (리뷰 재현)', async () => {
    // D-050부터 검증 실패로는 주문이 끝나지 않는다. API 오류로 멈추는 경우를 본다:
    // 기본 리포트는 두 번 형식이 틀린 뒤 세 번째 호출에서 API 오류가 나고, 주제 호출은 느리게(진행 중에 취소된다) 실패하는 응답을 준다
    let baseCalls = 0;
    const t = new FakeTransport(
      (req) => {
        if (req.label !== 'base') return { body: { sentences: [] } };
        if (++baseCalls === 3) throw new Error('500 server error');
        return { text: '{"summary": 1}' };
      },
      (label) => (label === 'base' ? 0 : 50),
    );
    const err = (await generateReport(args(t, ['wealth', 'career', 'love'])).catch((e: unknown) => e)) as GenerationInterrupted;
    expect(err).toBeInstanceOf(GenerationInterrupted);
    // 취소가 없다면 4작업 × 3회 = 12회 호출된다
    expect(t.requests.length).toBeLessThan(12);
    // 취소된 진행 중 호출은 응답이 없어 시도 기록이 없다. 나머지는 모두 기록된다
    expect(err.attempts.filter((a) => a.label === 'base')).toHaveLength(2);
  });
});

describe('대운 해설 대상', () => {
  const d = chart.daewoon;
  it('연중에 대운이 바뀌면 7월 1일이 속한 대운을 현재로 본다', () => {
    const switching = d[2]!; // 이 대운이 시작되는 해
    const expectedStart = switching.startMonth <= 7 ? 2 : 1;
    expect(targetDaewoonIndices(chart, switching.startYear, 2)).toEqual([expectedStart, expectedStart + 1]);
  });
  it('첫 대운 전이면 첫 두 개, 마지막 대운 이후면 마지막 두 개', () => {
    expect(targetDaewoonIndices(chart, d[0]!.startYear - 5, 2)).toEqual([0, 1]);
    expect(targetDaewoonIndices(chart, d[d.length - 1]!.startYear + 20, 2)).toEqual([d.length - 2, d.length - 1]);
  });
});

describe('검증이 아닌 이유로 멈추면', () => {
  it('원래 오류를 cause로, 그때까지의 시도 기록을 attempts로 담아 GenerationInterrupted를 던진다', async () => {
    const apiError = new Error('429 rate limited');
    let calls = 0;
    const t = new FakeTransport(
      (req) => {
        calls++;
        if (req.label === 'topic:wealth') throw apiError;
        return { body: validBase(indices, ['dayMaster'], groups) }; // 기본 리포트는 바로 성공
      },
      (label) => (label === 'topic:wealth' ? 30 : 0),
    );
    const err = await generateReport(args(t, ['wealth'])).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GenerationInterrupted);
    const gi = err as GenerationInterrupted;
    expect(gi.cause).toBe(apiError);
    // 먼저 끝난 기본 리포트의 결제된 시도가 기록에 남는다 (API 오류 호출은 응답이 없어 기록 없음)
    expect(gi.attempts.filter((a) => a.label === 'base').map((a) => [a.label, a.attempt])).toEqual([['base', 1]]);
    expect(calls).toBe(2);
  });
});

describe('D-045: 올해·내년 마지막 문장 연결, 칸을 가로지르는 반복 줄이기', () => {
  it('D-048: 올해 첫·마지막 문장이 그해 글자의 뜻·관계 없이 쓰이면 다시 만든다(마지막 시도에서는 봐준다)', async () => {
    let baseCalls = 0;
    const ok = validResponder(indices);
    const t = new FakeTransport((req, call) => {
      if (req.label !== 'base') return ok(req, call);
      baseCalls++;
      const r = ok(req, call) as { body: any };
      if (baseCalls > 1) return r;
      const plain = (xs: any[]) => xs.map((s: any) => ({ ...s, text: '불의 기운이 강한 한 해로 볼 수 있어요.' }));
      return { body: { ...r.body, yearly: { thisYear: plain(r.body.yearly.thisYear), nextYear: r.body.yearly.nextYear } } };
    });
    const r = await generateReport(args(t, []));
    const base = r.attempts.filter((a) => a.label === 'base');
    const codes = base[0]!.violations.map((v) => `${v.code}:${v.path}`);
    expect(codes).toContain('yearlyNotPersonal:yearly.thisYear[0]');
    expect(codes).toContain(`yearlyNotPersonal:yearly.thisYear[${REPORT_LAYOUT.yearlySentences - 1}]`);
    // D-052: 올해 칸이 2문장이라 첫 문장(0)과 마지막 문장(1)만 있다. 둘 다 본다
    expect(REPORT_LAYOUT.yearlySentences).toBe(2);
    expect(base).toHaveLength(2);
  });

  it('다른 칸에서 이미 두 번 쓴 풀이 말을 주제 칸이 또 쓰면 그 주제 칸만 한 번 다시 만든다', async () => {
    const ok = validResponder(indices);
    const t = new FakeTransport((req, call) => {
      const r = ok(req, call) as { body: any };
      if (req.label === 'base') {
        const s = r.body.summary.map((x: any, i: number) => (i < 2 ? { ...x, text: `약속을 ${i === 0 ? '지키는' : '아끼는'} 편이에요.` } : x));
        return { body: { ...r.body, summary: s } };
      }
      if (req.label === 'topic:career') return { body: { sentences: r.body.sentences.map((x: any, i: number) => (i === 0 ? { ...x, text: '약속을 소중히 여겨요.' } : x)) } };
      return r;
    });
    const res = await generateReport(args(t, ['career']));
    const labels = t.requests.map((q) => q.label);
    expect(labels).toContain('topic:career:repeat');
    const retry = t.requests.find((q) => q.label === 'topic:career:repeat')!;
    expect(retry.user).toContain('이미 두 번 쓴 말이라 이 칸에서는 쓰지 않습니다: 약속');
    expect(res.body.topics.career!.some((s) => s.text.includes('약속'))).toBe(false);
  });

  it('다시 만들기가 실패해도 주문은 실패하지 않고 원래 문장을 둔다', async () => {
    const ok = validResponder(indices);
    const t = new FakeTransport((req, call) => {
      const r = ok(req, call) as { body: any };
      if (req.label === 'base') return { body: { ...r.body, summary: r.body.summary.map((x: any, i: number) => (i < 2 ? { ...x, text: '약속이 중요해요.' } : x)) } };
      if (req.label === 'topic:career') return { body: { sentences: r.body.sentences.map((x: any, i: number) => (i === 0 ? { ...x, text: '약속을 소중히 여겨요.' } : x)) } };
      return { text: 'not json' };
    });
    const res = await generateReport(args(t, ['career']));
    expect(res.body.topics.career![0]!.text).toBe('약속을 소중히 여겨요.');
  });
});

describe('D-045 리뷰: 반복 검사는 주문을 실패시키지 않는다', () => {
  it('기본 호출이 매번 같은 풀이 말을 3번 써도 마지막 시도에서는 통과시킨다', async () => {
    const ok = validResponder(indices);
    const t = new FakeTransport((req, call) => {
      const r = ok(req, call) as { body: any };
      if (req.label !== 'base') return r;
      return { body: { ...r.body, traits: r.body.traits.map((x: any, i: number) => (i < 3 ? { ...x, text: `약속을 ${['지켜요', '아껴요', '챙겨요'][i]}.` } : x)) } };
    });
    const res = await generateReport(args(t, []));
    const base = res.attempts.filter((a) => a.label === 'base');
    expect(base).toHaveLength(3);
    expect(base.slice(0, 2).every((a) => a.violations.some((v) => v.code === 'repeatedWord'))).toBe(true);
    expect(base[2]!.violations).toEqual([]);
    expect(res.body.traits.filter((s) => s.text.includes('약속'))).toHaveLength(3);
  });
});

describe('D-045 리뷰 2: 반복만 걸린 후보는 남겨 둔다', () => {
  it('1~2차는 반복만 걸리고 3차가 하드 위반이면, 반복만 걸렸던 후보를 검수해 쓴다(주문 실패 아님)', async () => {
    const ok = validResponder(indices);
    let baseCalls = 0;
    const t = new FakeTransport((req, call) => {
      const r = ok(req, call) as { body: any };
      if (req.label !== 'base') return r;
      baseCalls++;
      if (baseCalls < 3) return { body: { ...r.body, traits: r.body.traits.map((x: any, i: number) => (i < 3 ? { ...x, text: `약속을 ${['지켜요', '아껴요', '챙겨요'][i]}.` } : x)) } };
      return { body: { ...r.body, traits: r.body.traits.map((x: any, i: number) => (i === 0 ? { ...x, evidenceIds: [] } : x)) } };
    });
    const res = await generateReport(args(t, []));
    expect(baseCalls).toBe(3);
    expect(res.body.traits.filter((s) => s.text.includes('약속'))).toHaveLength(3);
    expect(res.attempts.some((a) => a.label === 'base' && a.stopReason === 'softFallback')).toBe(true);
  });

  it('D-050: 반복만 걸린 후보가 AI 검수에 걸리면 걸린 문장만 사실 문장으로 바꾼다(주문은 끝난다)', async () => {
    const ok = validResponder(indices);
    let baseCalls = 0;
    const t = new FakeTransport((req, call) => {
      const r = ok(req, call) as { body: any };
      if (req.label !== 'base') return r;
      baseCalls++;
      if (baseCalls < 3) return { body: { ...r.body, traits: r.body.traits.map((x: any, i: number) => (i < 3 ? { ...x, text: `약속을 ${['지켜요', '아껴요', '챙겨요'][i]}.` } : x)) } };
      return { body: { ...r.body, traits: r.body.traits.map((x: any, i: number) => (i === 0 ? { ...x, evidenceIds: [] } : x)) } };
    });
    const flagAll = new FakeModerator((items) => ({
      flags: items.map((it) => ({ path: it.path, categories: ['anxiety' as const] })),
      calls: [{ attempt: 1, ok: true, usage: [] }],
    }));
    const r = await generateReport(args(t, [], flagAll));
    const tpl = fallbackBase(chart, indices, { child: false });
    // 모든 문장이 검수에 걸렸으므로 기본 칸 문장이 모두 사실 문장이다
    expect(r.body.traits).toEqual(tpl.traits);
    expect(r.body.yearly).toEqual(tpl.yearly);
    // 검수기가 모든 문장을 걸어 월별·10년 칸도 사실 문장으로 바뀐다(D-052: 같은 안전 검수)
    expect(r.body.templated).toEqual(['base', 'monthly', 'decade']);
  });
});

describe('D-045 마무리: 내년 칸의 "올해", 전송 오류 뒤 소프트 후보', () => {
  it('내년 칸에서 "올해"라고 쓰면 다시 만든다', async () => {
    const ok = validResponder(indices);
    let baseCalls = 0;
    const t = new FakeTransport((req, call) => {
      const r = ok(req, call) as { body: any };
      if (req.label !== 'base') return r;
      baseCalls++;
      if (baseCalls > 1) return r;
      const n = r.body.yearly.nextYear;
      return { body: { ...r.body, yearly: { ...r.body.yearly, nextYear: n.map((x: any, i: number) => (i === n.length - 1 ? { ...x, text: '올해는 새 방식을 시험해 보세요.' } : x)) } } };
    });
    const res = await generateReport(args(t, []));
    expect(res.attempts.find((a) => a.label === 'base')!.violations.map((v) => v.code)).toContain('wrongYearWord');
  });

  it('반복 검사에만 걸린 후보가 있으면 다음 시도의 API 오류로 주문을 끝내지 않는다', async () => {
    const ok = validResponder(indices);
    let baseCalls = 0;
    const t = new FakeTransport((req, call) => {
      const r = ok(req, call) as { body: any };
      if (req.label !== 'base') return r;
      baseCalls++;
      if (baseCalls === 1) return { body: { ...r.body, traits: r.body.traits.map((x: any, i: number) => (i < 3 ? { ...x, text: `약속을 ${['지켜요', '아껴요', '챙겨요'][i]}.` } : x)) } };
      throw new Error('API 오류');
    });
    const res = await generateReport(args(t, []));
    expect(res.body.traits.filter((s) => s.text.includes('약속'))).toHaveLength(3);
  });
});
