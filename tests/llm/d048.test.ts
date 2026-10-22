// D-048: 세운 근거의 뜻·관계, 올해·내년 첫·마지막 문장 검사, 합·충 각도, 묶음 이름 구멍, 그해·원국 섞기, 시간 상한 (가짜 LLM, 실제 호출 없음)
import { describe, expect, it } from 'vitest';
import { GENERATION, REPORT_LAYOUT } from '../../src/config/report';
import { buildChart } from '../../src/engine/chart';
import { buildEvidence } from '../../src/engine/evidence';
import { luckRelations } from '../../src/engine/relations';
import { angleLines, assignAngles, sectionKeys } from '../../src/llm/angles';
import { COMMON_FORBIDDEN } from '../../src/llm/forbidden';
import { targetDaewoonIndices } from '../../src/llm/evidenceSelect';
import { generateReport } from '../../src/llm/generate';
import { SAMPLE_INPUTS, SAMPLE_REFERENCE_YEAR } from '../../src/llm/samples';
import { prepareRules, validateSentence, validateVacuous, validateYearly } from '../../src/llm/validate';
import { buildReportView } from '../../src/report/view';
import { FakeModerator, FakeTransport, validResponder } from './fakes';

const chart = buildChart(SAMPLE_INPUTS[0]!, { referenceYear: SAMPLE_REFERENCE_YEAR });
const evidence = buildEvidence(chart);
const ev = new Map(evidence.map((e) => [e.id, e]));
const indices = targetDaewoonIndices(chart, SAMPLE_REFERENCE_YEAR, REPORT_LAYOUT.daewoonNoteCount);
const rules = prepareRules({ evidence, forbidden: COMMON_FORBIDDEN, maxChars: REPORT_LAYOUT.maxSentenceChars });
const codes = (text: string, ids: string[]) => validateSentence({ text, evidenceIds: ids }, 'p', rules).map((v) => v.code);

describe('그해 글자와 원국 글자의 관계', () => {
  it('2026년 병오(丙午): 태어난 달의 윗글자 신(辛)과 묶이고, 태어난 해의 아랫글자 오(午)와 같고, 태어난 시의 아랫글자 미(未)와 묶인다', () => {
    expect(luckRelations(chart.pillars, chart.seun[0]!.pillar)).toEqual([
      { kind: 'stemCombine', luckPart: 'stem', ref: 'month.stem', resultElement: 'water' },
      { kind: 'same', luckPart: 'branch', ref: 'year.branch' },
      { kind: 'branchSixCombine', luckPart: 'branch', ref: 'hour.branch', resultElement: 'fire' },
    ]);
  });
  it('부딪치는 관계: 2026년 병(丙)은 임(壬)과, 오(午)는 자(子)와 부딪친다', () => {
    const p = { ...chart.pillars, month: { stem: 8, branch: 0 } };
    expect(luckRelations(p, chart.seun[0]!.pillar)).toEqual(expect.arrayContaining([
      { kind: 'stemClash', luckPart: 'stem', ref: 'month.stem' },
      { kind: 'branchClash', luckPart: 'branch', ref: 'month.branch' },
    ]));
  });
  it('같은 간지면 같은 글자로 본다', () => {
    const rels = luckRelations(chart.pillars, chart.pillars.year);
    expect(rels.filter((r) => r.ref.startsWith('year.')).map((r) => r.kind)).toEqual(['same', 'same']);
  });
  it('세운 근거에 뜻과 관계를 적고, 관계를 맺는 원국 글자 표기도 허용한다', () => {
    const se = ev.get('seun[0]')!;
    expect(se.content).toContain('일간 기준 천간 병(丙)은(는) 편관(관성), 지지 오(午)은(는) 정관(관성)');
    expect(se.content).toContain('천간 병(丙) ↔ 월주 천간 신(辛): 천간합(수(水))');
    expect(se.content).toContain('지지 오(午) ↔ 년주 지지 오(午): 같은 글자');
    expect(se.terms).toEqual(expect.arrayContaining(['신', '辛', '미', '未']));
    expect(se.chartRefs).toEqual(['seun[0]', 'month.stem', 'year.branch', 'hour.branch']);
    // 그해 글자의 뜻 묶음과 관계를 맺는 원국 글자를 세운 근거만 인용해 쓸 수 있다
    expect(codes('2026년은 규칙·책임을 뜻하는 병(丙)이 태어난 달의 윗글자 신(辛)과 묶이는 해예요.', ['seun[0]'])).toEqual([]);
    expect(codes('2026년은 표현·재능을 뜻하는 글자가 오는 해예요.', ['seun[0]'])).toContain('termNotInCitedEvidence');
  });
});

describe('묶음 이름 구멍과 그해·원국 섞기 (하드 검사)', () => {
  it('"기운을 뜻하는 재물·활동 글자"처럼 묶음 이름을 가운데 끼우면 잡는다', () => {
    expect(codes('물의 기운을 뜻하는 재물·활동 글자가 2개 있어요.', ['tenGodGroup.jaeseong'])).toContain('groupLabel');
    expect(codes('재물·활동을 뜻하는 글자가 2개 있어요.', ['tenGodGroup.jaeseong'])).not.toContain('groupLabel');
  });
  it('"올해 불의 기운은 내 사주 8글자 중 3개"처럼 그해 기운을 사주 개수로 말하면 잡는다', () => {
    for (const text of ['올해 불의 기운은 내 사주 8글자 중 1개뿐이라 마음이 들뜰 수 있어요.', '2026년 불의 기운은 내 사주 8글자 중 1개로 적은 편이에요.']) {
      expect(codes(text, ['seun[0]', 'elements.fire']), text).toContain('yearNatalMix');
    }
  });
  it('리뷰 반영: "올해는 …", "사주에서 N개", "사주의 N개" 꼴도 잡는다', () => {
    for (const text of ['올해는 불의 기운이 내 사주 8글자 중 1개를 차지해요.', '올해 불의 기운이 내 사주에서 1개라 약해요.', '올해 불의 기운은 사주의 1개와 합쳐져 커져요.']) {
      expect(codes(text, ['seun[0]', 'elements.fire']), text).toContain('yearNatalMix');
    }
  });
  it('쉼표로 나누거나 사주를 주어로 두면 잡지 않는다', () => {
    for (const text of ['올해는 불의 해이고, 내 사주 8글자 중 불은 1개뿐이라 들뜰 수 있어요.', '내 사주 8글자 중 불의 기운은 1개뿐이라 올해는 들뜰 수 있어요.', '올해 불의 기운이 내 사주에 적던 기운이라 반가운 해예요.', '내년 물의 기운이 사주 8글자에 새 흐름을 가져와요.']) {
      expect(codes(text, ['seun[0]', 'elements.fire']), text).not.toContain('yearNatalMix');
    }
  });
});

describe('관계 이름만 바꾼 문장 (soft)', () => {
  it('"어우러지는 모습이 보여요."로 끝나면 잡고, 성향까지 쓰면 잡지 않는다', () => {
    expect(validateVacuous([{ path: 'p', text: '두 글자가 서로 어우러지는 모습이 보여요.' }]).map((v) => v.code)).toEqual(['vacuousRelation']);
    expect(validateVacuous([{ path: 'p', text: '두 글자가 서로 묶여 낯선 일에도 금방 마음을 붙이는 편이에요.' }])).toEqual([]);
  });
});

describe('올해·내년 첫·마지막 문장 (soft)', () => {
  const facts = { seunId: 'seun[0]', groupLabels: ['재물·활동'], hasRelation: true };
  const s = (text: string, ids = ['seun[0]']) => ({ text, evidenceIds: ids });
  it('첫·마지막 문장에 그해 글자의 뜻이나 관계가 없으면 잡는다(가운데 문장은 보지 않는다)', () => {
    const v = validateYearly([s('불의 기운이 강한 해예요.'), s('가운데 문장이에요.'), s('불이 많은 해예요.')], 'yearly.thisYear', facts);
    expect(v.map((x) => x.path)).toEqual(['yearly.thisYear[0]', 'yearly.thisYear[2]']);
  });
  it('뜻 묶음이나 관계 말이 있으면 통과, 세운 근거를 인용하지 않으면 잡는다', () => {
    expect(validateYearly([s('재물 · 활동의 뜻이 커지는 해예요.'), s('태어난 날의 윗글자와 부딪치며 바뀌는 해예요.')], 'y', facts)).toEqual([]);
    expect(validateYearly([s('재물·활동의 뜻이 커지는 해예요.', ['elements.fire'])], 'y', facts).map((x) => x.code)).toEqual(['yearlyNotPersonal']);
  });
  it('관계가 없는 해에는 관계 말로는 통과하지 않는다', () => {
    expect(validateYearly([s('서로 묶이는 해예요.')], 'y', { ...facts, hasRelation: false }).map((x) => x.code)).toEqual(['yearlyNotPersonal']);
  });
  it('관계를 말한 문장을 행동 제안으로 끝내면 잡는다', () => {
    const v = validateYearly([s('재물·활동의 해예요.'), s('태어난 날의 윗글자와 부딪치니 일정을 줄여 보세요.')], 'y', facts);
    expect(v.map((x) => x.code)).toEqual(['relationAsAdvice']);
  });
});

describe('각도 안내: 장면 문구 없이, 관계 표 포함', () => {
  const adult = { child: false, toddler: false };
  it('장면 문구를 넣지 않고 [관계 표]를 넣는다', () => {
    const angles = assignAngles(chart, adult, sectionKeys([], 2));
    const text = angleLines(angles, [{ key: 'thisYear', name: 'yearly.thisYear' }]);
    expect(text).toContain('[관계 표] 묶이는 관계=');
    expect(text).not.toContain('각도별 장면');
    expect(text).not.toContain('새 일감을 찾아 나서기');
    expect(text).toContain('각도 이름을 문장에 그대로 옮기지 않고');
  });
  it('사실 카드: 합·충 근거에는 그 관계의 뜻 전체를 보여 준다', () => {
    const relId = evidence.find((e) => e.kind === 'relation')!.id;
    const angles = assignAngles(chart, adult, sectionKeys([], 0));
    const s = [{ text: '두 글자가 묶여 마음을 쉽게 붙이는 편이에요.', evidenceIds: [relId] }];
    const view = buildReportView({ chart, evidence, body: { summary: [], traits: s, topics: {}, daewoonNotes: [], yearly: { thisYear: [], nextYear: [] }, angles }, topicIds: [], name: null, birthLabel: '' });
    const item = view.evidence.find((e) => e.ids.includes(relId))!;
    const slot = /Clash/u.test(relId) ? 'clash' : 'combine';
    expect(item.meanings).toEqual([`${slot === 'clash' ? '부딪치는' : '묶이는'} 관계의 뜻: ${angles.options[slot]!.join(' / ')}`]);
  });
});

describe('시간 상한 (60초)', () => {
  it(`${GENERATION.softDeadlineMs / 1000}초가 지나면 문장 다듬기(soft)로 다시 부르지 않고 그 후보를 쓴다`, async () => {
    let clock = 0;
    const ok = validResponder(indices);
    const t = new FakeTransport((req, call) => {
      clock += 70_000;
      const r = ok(req, call) as { body: any };
      // 앞 문장에 기대는 표현(soft)만 걸리는 응답
      if (req.label === 'base') return { body: { ...r.body, summary: r.body.summary.map((x: any) => ({ ...x, text: `그래서 ${x.text}` })) } };
      return r;
    });
    const r = await generateReport({ chart, evidence, topicIds: [], referenceYear: SAMPLE_REFERENCE_YEAR, transport: t, moderator: new FakeModerator(), now: () => clock });
    expect(t.requests.filter((q) => q.label === 'base')).toHaveLength(1);
    expect(r.attempts.filter((a) => a.label === 'base').map((a) => a.stopReason)).toEqual(['end_turn', 'softFallback']);
    expect(r.body.summary.at(-1)!.text.startsWith('그래서 ')).toBe(true);
  });

  it('리뷰 반영: 시간이 지난 뒤 soft 후보가 AI 검수에 걸리면 남은 시도로 다시 쓴다', async () => {
    let clock = 0;
    let baseCalls = 0;
    const ok = validResponder(indices);
    const t = new FakeTransport((req, call) => {
      clock += 70_000;
      const r = ok(req, call) as { body: any };
      if (req.label !== 'base') return r;
      baseCalls++;
      return baseCalls === 1 ? { body: { ...r.body, summary: r.body.summary.map((x: any) => ({ ...x, text: `그래서 ${x.text}` })) } } : r;
    });
    // "그래서"로 시작하는 문장을 검수에서 건다
    const m = new FakeModerator((items) => ({
      flags: items.filter((i) => i.text.startsWith('그래서')).map((i) => ({ path: i.path, categories: ['medical' as const] })),
      calls: [{ attempt: 1, ok: true, usage: [] }],
    }));
    const r = await generateReport({ chart, evidence, topicIds: [], referenceYear: SAMPLE_REFERENCE_YEAR, transport: t, moderator: m, now: () => clock });
    expect(baseCalls).toBe(2);
    expect(r.attempts.filter((a) => a.label === 'base').map((a) => a.stopReason)).toEqual(['end_turn', 'softFallback', 'end_turn']);
    expect(r.body.summary.some((x) => x.text.startsWith('그래서'))).toBe(false);
  });

  it('시간이 지나도 사실 오류(하드)는 다시 쓰고, 그 시도에서는 soft 검사를 하지 않는다', async () => {
    let clock = 0;
    let baseCalls = 0;
    const ok = validResponder(indices);
    const t = new FakeTransport((req, call) => {
      clock += 70_000;
      const r = ok(req, call) as { body: any };
      if (req.label !== 'base') return r;
      baseCalls++;
      const summary = r.body.summary.map((x: any) => (baseCalls === 1 ? { ...x, evidenceIds: [] } : { ...x, text: `그래서 ${x.text}` }));
      return { body: { ...r.body, summary } };
    });
    const r = await generateReport({ chart, evidence, topicIds: [], referenceYear: SAMPLE_REFERENCE_YEAR, transport: t, moderator: new FakeModerator(), now: () => clock });
    const base = r.attempts.filter((a) => a.label === 'base');
    expect(base.map((a) => a.violations.map((v) => v.code)[0] ?? 'ok')).toEqual(['noEvidence', 'ok']);
    expect(baseCalls).toBe(2);
  });

  it('시간이 지나면 칸을 가로지르는 반복 줄이기(주제 칸 다시 만들기)를 건너뛴다', async () => {
    let clock = 0;
    const ok = validResponder(indices);
    const t = new FakeTransport((req, call) => {
      clock += 70_000;
      const r = ok(req, call) as { body: any };
      if (req.label === 'base') {
        return { body: { ...r.body, summary: r.body.summary.map((x: any, i: number) => (i < 2 ? { ...x, text: `약속을 ${i === 0 ? '지키는' : '아끼는'} 편이에요.` } : x)) } };
      }
      if (req.label === 'topic:career') return { body: { sentences: r.body.sentences.map((x: any, i: number) => (i === 0 ? { ...x, text: '약속을 소중히 여겨요.' } : x)) } };
      return r;
    });
    await generateReport({ chart, evidence, topicIds: ['career'], referenceYear: SAMPLE_REFERENCE_YEAR, transport: t, moderator: new FakeModerator(), now: () => clock });
    expect(t.requests.map((q) => q.label)).not.toContain('topic:career:repeat');
  });
});
