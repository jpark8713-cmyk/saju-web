// D-052 (2)단계: 월별·10년 흐름 생성(가짜 LLM, 실제 호출 없음) — 구조, 검사, 사실 문장 대체, 진행 상태, 시간 상한, 운영자 알림 비율, 화면 데이터
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GENERATION, REPORT_LAYOUT } from '../../src/config/report';
import { buildChart } from '../../src/engine/chart';
import { buildEvidence, buildPeriodEvidence } from '../../src/engine/evidence';
import { targetDaewoonIndices } from '../../src/llm/evidenceSelect';
import { fallbackMonths, fallbackYears } from '../../src/llm/fallbackText';
import { COMMON_FORBIDDEN, PERIOD_SCENE_FORBIDDEN, findForbidden } from '../../src/llm/forbidden';
import { generateReport, type JobState } from '../../src/llm/generate';
import { SAMPLE_AS_OF, SAMPLE_INPUTS, SAMPLE_REFERENCE_YEAR } from '../../src/llm/samples';
import { prepareRules, validateSentence, validateYearly } from '../../src/llm/validate';
import { startGeneration } from '../../src/orders/generation';
import { buildReportView } from '../../src/report/view';
import { MemoryStore } from '../../src/store/memory';
import { paidOrder } from '../web/helpers';
import { FakeModerator, FakeTransport, validResponder, yearGroupsOf } from './fakes';

afterEach(() => vi.restoreAllMocks());

const L = REPORT_LAYOUT;
const setup = (sample: number) => {
  const chart = buildChart(SAMPLE_INPUTS[sample]!, { referenceYear: SAMPLE_REFERENCE_YEAR });
  const evidence = buildEvidence(chart);
  const indices = targetDaewoonIndices(chart, SAMPLE_REFERENCE_YEAR, L.daewoonNoteCount);
  return { chart, evidence, indices };
};
const adult = setup(7);
const child = setup(4);
const gen = (s: ReturnType<typeof setup>, transport: FakeTransport, extra: Record<string, unknown> = {}, moderator = new FakeModerator()) =>
  generateReport({ chart: s.chart, evidence: s.evidence, topicIds: ['wealth'], referenceYear: SAMPLE_REFERENCE_YEAR, transport, moderator, asOf: SAMPLE_AS_OF, ...extra });

describe('생성 구조', () => {
  it('어른(C안): 월별 12칸 × 1문장, 10년 8칸(올해·내년 빼고) × 1문장, 호출 2개 추가, 월·연 문장도 안전 검수를 받는다', async () => {
    const t = new FakeTransport(validResponder(adult.indices));
    const m = new FakeModerator();
    const r = await gen(adult, t, {}, m);
    expect(t.requests.map((q) => q.label).sort()).toEqual(['base', 'decade', 'monthly', 'topic:wealth']);
    expect(r.body.periods!.months!.map((n) => n.sentences.length)).toEqual(Array(L.monthCount).fill(L.monthSentences));
    expect(r.body.periods!.years.map((n) => n.sentences.length)).toEqual(Array(L.yearCount - L.yearAiFrom).fill(L.yearSentences));
    // D-052 3단계: 10년 흐름 AI 문장은 year[2]부터(올해·내년은 코드 사실 줄)
    expect(r.body.periods!.years.map((n) => n.index)).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
    expect(r.body.periods!.seasons).toBeUndefined();
    expect(r.body.periods!.asOf).toBe(SAMPLE_AS_OF.toISOString());
    expect(r.periodEvidence.map((e) => e.id)).toEqual([...Array.from({ length: 12 }, (_, i) => `month[${i}]`), ...Array.from({ length: 10 }, (_, i) => `year[${i}]`)]);
    expect(m.reviewed.flat().filter((x) => x.path.startsWith('months[') || x.path.startsWith('years['))).toHaveLength(12 + 8);
    // 요청 문장 수(대체 전): 총평 2 + 성향 5 + 대운 2×3 + 올해·내년 2×2 + 주제 5 + 월별 12 + 10년 8
    expect(r.body.requestedSentences).toBe(2 + 5 + 6 + 4 + 5 + 12 + 8);
    expect(r.body.templatedSentences).toBeUndefined();
  });
  it('아이(만 2세): 계절 4묶음 × 2문장 + 10년 × 1문장, 호출 1개(월별·10년 호출 없음)', async () => {
    const t = new FakeTransport(validResponder(child.indices));
    const r = await gen(child, t);
    expect(t.requests.map((q) => q.label).sort()).toEqual(['base', 'periods:child', 'topic:wealth']);
    expect(r.body.periods!.seasons!.map((n) => n.sentences.length)).toEqual([2, 2, 2, 2]);
    expect(r.body.periods!.years.map((n) => n.sentences.length)).toEqual(Array(8).fill(1));
    expect(r.body.periods!.months).toBeUndefined();
    const msg = t.requests.find((q) => q.label === 'periods:child')!.user;
    expect(msg).toContain('## 읽는 사람: 아이를 키우는 부모');
    expect(msg).toMatch(/묶음 0\([가-힣]+\): month\[0\], month\[1\], month\[2\]/u);
  });
  it('올해·내년 칸은 2문장이고 첫·마지막 문장 검사가 그대로 돈다', () => {
    expect(L.yearlySentences).toBe(2);
    const [g0] = yearGroupsOf(adult.chart);
    const facts = { seunId: 'seun[0]', groupLabels: [g0], hasRelation: false };
    const s = (text: string) => ({ text, evidenceIds: ['seun[0]'] });
    expect(validateYearly([s('불의 기운이 강한 해예요.'), s('차분히 지내 보세요.')], 'yearly.thisYear', facts).map((v) => v.path)).toEqual(['yearly.thisYear[0]', 'yearly.thisYear[1]']);
    expect(validateYearly([s(`${g0}의 뜻이 커지는 해예요.`), s(`${g0}에 맞춰 한 가지를 정해 보세요.`)], 'yearly.thisYear', facts)).toEqual([]);
  });
});

describe('월·연 칸의 근거에 없는 구체 장면(하드, 뜻 묶음)', () => {
  const hit = (text: string) => findForbidden(text, [PERIOD_SCENE_FORBIDDEN]).length > 0;
  it('모임·회식·여행·면접·계약 계열 장면은 막는다', () => {
    for (const t of [
      '이번 달 모임이 늘어나는 때예요.', '회식 자리에서 말을 아껴 보세요.', '여행 계획을 세워 보면 좋아요.', '휴가를 짧게 다녀오세요.', '면접을 앞두고 준비해 보세요.',
      '입사 서류를 챙겨 보세요.', '계약서를 꼼꼼히 읽어 보세요.', '대출을 미리 알아보세요.', '이사를 하기 좋은 해예요.', '결혼식 일정을 잡아 보세요.', '동창회에 나가 보세요.',
    ]) expect(hit(t), t).toBe(true);
  });
  it('앞으로 권하는 생활 조언과 장면 아닌 낱말은 통과한다', () => {
    for (const t of [
      '큰 지출 전 항목별 예산을 적어 보세요.', '하루 계획을 아침에 정해 보세요.', '힘을 행사하기보다 기다려 보세요.', '가까운 사람에게 먼저 안부를 물어 보세요.', '이사회 같은 큰 결정은 이 문장에 없어요.',
    ]) expect(hit(t), t).toBe(false);
  });
  it('월·연 칸에만 적용한다(기본 칸 규칙에는 없다)', () => {
    expect(findForbidden('여행 계획을 세워 보면 좋아요.', COMMON_FORBIDDEN)).toEqual([]);
  });
  it('끝내 고치지 못한 월 문장은 그 문장만 사실 문장으로 바꾸고 주문은 끝난다', async () => {
    const ok = validResponder(adult.indices);
    const t = new FakeTransport((req, call) => {
      const r = ok(req, call) as { body: any };
      if (req.label !== 'monthly') return r;
      r.body.periods[3].sentences[0].text = '이번 달 모임에 나가 보세요.';
      return r;
    }, () => 0, 'raw');
    const r = await gen(adult, t);
    const facts = buildPeriodEvidence(adult.chart, SAMPLE_AS_OF, SAMPLE_REFERENCE_YEAR);
    expect(r.body.periods!.months![3]!.sentences[0]).toEqual(fallbackMonths(adult.chart, facts.months).periods[3]!.sentences[0]);
    expect(r.body.periods!.months![4]!.sentences[0]!.text).toContain('번째 칸은');
    expect(r.body).toMatchObject({ templated: ['monthly'], templatedSentences: 1 });
    expect(r.attempts.filter((a) => a.label === 'monthly' && a.violations.some((v) => v.detail.includes('구체 장면')))).toHaveLength(3);
  });
});

describe('월·연 칸 검사', () => {
  const ev = [...adult.evidence, ...buildPeriodEvidence(adult.chart, SAMPLE_AS_OF, SAMPLE_REFERENCE_YEAR).evidence];
  const rules = prepareRules({ evidence: ev, forbidden: COMMON_FORBIDDEN, maxChars: L.maxSentenceChars });
  const codes = (text: string, ids: string[]) => validateSentence({ text, evidenceIds: ids }, 'p', rules).map((v) => v.code);
  it('숫자: 그달 근거의 "2026년 11월"·만 나이·대운 시작 표기는 허용, 다른 달은 막는다', () => {
    expect(codes('2026년 11월은 같은 글자가 들어오는 달이에요.', ['month[1]'])).toEqual([]);
    expect(codes('2027년 3월은 같은 글자가 들어오는 달이에요.', ['month[1]'])).toContain('numberNotInEvidence');
    const y = buildPeriodEvidence(adult.chart, SAMPLE_AS_OF, SAMPLE_REFERENCE_YEAR).years[3]!;
    expect(codes(`${y.year}년에는 만 ${y.ageAfterBirthday}세가 돼요.`, ['year[3]'])).toEqual([]);
  });
  it('어른 C안: 달 이름으로 시작하면 첫 시도에서 한 번만 다시 쓰게 하고, 그래도 같으면 통과시킨다', async () => {
    const ok = validResponder(adult.indices);
    let calls = 0;
    const t = new FakeTransport((req, n) => {
      const r = ok(req, n) as { body: any };
      if (req.label !== 'monthly') return r;
      calls++;
      // 매번 모든 달의 문장을 달 이름으로 시작(뜻 묶음은 넣는다)
      r.body.periods.forEach((p: any) => { p.sentences[0].text = p.sentences[0].text.replace(/^\d+번째 칸은/u, '이 달은'); });
      return r;
    }, () => 0, 'raw');
    const r = await gen(adult, t);
    expect(calls).toBe(2);
    expect(r.attempts.filter((a) => a.label === 'monthly')[0]!.violations.map((v) => v.code)).toContain('openerFrame');
    expect(r.body.templated).toBeUndefined();
  });
});

describe('진행 상태·시간 상한·운영자 알림', () => {
  it('칸마다 대기 → 쓰는 중 → 확인 중 → 완료를 알린다', async () => {
    const seen: [string, JobState][] = [];
    await gen(adult, new FakeTransport(validResponder(adult.indices)), { onProgress: (l: string, s: JobState) => seen.push([l, s]) });
    for (const label of ['base', 'topic:wealth', 'monthly', 'decade']) {
      expect(seen.filter(([l]) => l === label).map(([, s]) => s), label).toEqual(['waiting', 'writing', 'checking', 'done']);
    }
  });
  it('150초 상한: 월별 호출이 늦으면 월별 칸만 사실 문장으로 채우고(진행 상태 "사실 문장으로 채움"), 주문은 끝난다', async () => {
    const seen: [string, JobState][] = [];
    const t = new FakeTransport(validResponder(adult.indices), (label) => (label === 'monthly' ? 400 : 0));
    const r = await gen(adult, t, { limits: { hardMs: 100 }, onProgress: (l: string, s: JobState) => seen.push([l, s]) });
    const facts = buildPeriodEvidence(adult.chart, SAMPLE_AS_OF, SAMPLE_REFERENCE_YEAR);
    expect(r.body.templated).toEqual(['monthly']);
    expect(r.body.periods!.months).toEqual(fallbackMonths(adult.chart, facts.months).periods);
    expect(r.body.periods!.years[0]!.sentences[0]!.text).toContain('번째 칸은');
    expect(seen.filter(([l]) => l === 'monthly').at(-1)).toEqual(['monthly', 'templated']);
  });
  // 리뷰 지적(HIGH): 칸을 더 돌려주면 범위 밖 칸의 사실을 읽다가 주문이 실패했다
  for (const [name, s, label, key, count] of [
    ['월별 13칸', adult, 'monthly', 'periods', L.monthCount],
    ['10년 9칸', adult, 'decade', 'periods', L.yearCount - L.yearAiFrom],
    ['아이 계절 5묶음', child, 'periods:child', 'seasons', L.seasonCount],
    ['아이 10년 9칸', child, 'periods:child', 'years', L.yearCount - L.yearAiFrom],
  ] as const) {
    it(`칸 수 초과(${name})는 그 칸 전체를 사실 문장으로 바꾸고 주문은 끝난다`, async () => {
      const ok = validResponder(s.indices);
      const t = new FakeTransport((req, n) => {
        const r = ok(req, n) as { body: any };
        if (req.label !== label) return r;
        const notes = r.body[key];
        notes.push({ ...notes.at(-1), index: notes.length });
        return r;
      }, () => 0, 'raw');
      const r = await gen(s, t);
      expect(r.body.templated).toEqual([label]);
      const out = key === 'seasons' ? r.body.periods!.seasons! : label === 'monthly' ? r.body.periods!.months! : r.body.periods!.years;
      expect(out).toHaveLength(count);
      expect(r.attempts.filter((a) => a.label === label).some((a) => a.violations.some((v) => v.code === 'sentenceCount'))).toBe(true);
    });
  }
  it('10년 칸을 끝내 읽을 수 없으면 10년 칸 전체를 사실 문장으로', async () => {
    const ok = validResponder(adult.indices);
    const t = new FakeTransport((req, n) => (req.label === 'decade' ? { text: '{"broken": true}' } : ok(req, n)), () => 0, 'raw');
    const r = await gen(adult, t);
    const facts = buildPeriodEvidence(adult.chart, SAMPLE_AS_OF, SAMPLE_REFERENCE_YEAR);
    expect(r.body.periods!.years).toEqual(fallbackYears(adult.chart, facts.years.slice(L.yearAiFrom)).periods);
  });
  for (const [broken, warn] of [[4, false], [5, true]] as const) {
    it(`주문 단계: 요청 42문장 중 ${broken}문장이 사실 문장으로 바뀌면 ${warn ? '운영자 알림(10% 초과)' : '기록 로그만'}`, async () => {
      const store = new MemoryStore();
      const o = await paidOrder(store, { topicIds: ['wealth'] });
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
      const runtime = () => ({
        transport: new FakeTransport((req, n) => {
          const order = (/daewoonIndex ([\d, ]+) 순서로/u.exec(req.user)?.[1] ?? '0, 1').split(',').map((x) => Number(x.trim()));
          const r = validResponder(order)(req, n) as { body: any };
          if (req.label === 'monthly') for (let i = 0; i < broken; i++) r.body.periods[i].sentences[0].evidenceIds = [];
          return r;
        }, () => 0, 'raw'),
        moderator: new FakeModerator(),
      });
      await (await startGeneration(store, o.orderId, o.accessToken, runtime)).job;
      const report = (await store.getReport(o.orderId))!;
      expect((await store.getOrder(o.orderId))!.status).toBe('done');
      expect(report.body).toMatchObject({ requestedSentences: 42, templatedSentences: broken });
      expect(report.evidence.some((e) => e.id === 'month[0]')).toBe(true);
      const alert = warnSpy.mock.calls.some((c) => String(c[0]).startsWith('[생성 알림]'));
      expect(alert).toBe(warn);
      if (!warn) expect(info.mock.calls.map((c) => String(c[0])).find((m) => m.startsWith('[생성]'))).toContain(`${broken}개 / 요청 42개`);
    });
  }
  it('주문 단계: 진행 상태를 주문에 남기고, 완성되면 상태 조회의 진행 표시는 빈 목록', async () => {
    const store = new MemoryStore();
    const o = await paidOrder(store, { topicIds: ['wealth'] });
    // 주문의 사주는 샘플과 달라 대운 순서를 요청 문구에서 읽는다
    const runtime = () => ({
      transport: new FakeTransport((req, n) => validResponder((/daewoonIndex ([\d, ]+) 순서로/u.exec(req.user)?.[1] ?? '0, 1').split(',').map((x) => Number(x.trim())))(req, n)),
      moderator: new FakeModerator(),
    });
    await (await startGeneration(store, o.orderId, o.accessToken, runtime)).job;
    const saved = (await store.getOrder(o.orderId))!;
    expect(saved.generation.progress!.map((p) => [p.label, p.name, p.state])).toEqual([
      ['base', '기본 풀이', 'done'], ['topic:wealth', '재물', 'done'], ['monthly', '월별 흐름', 'done'], ['decade', '10년 흐름', 'done'],
    ]);
  });
});

describe('화면 데이터', () => {
  it('어른: 월별(계절 묶음 4개·관계 칩)·10년(만 나이·대운 전환 표시) 섹션, 올해·내년 칸 아래 링크 줄, 그달·그해 사실 묶음', async () => {
    const r = await gen(adult, new FakeTransport(validResponder(adult.indices)));
    const evidence = [...adult.evidence, ...r.periodEvidence];
    const view = buildReportView({ chart: adult.chart, evidence, body: r.body, topicIds: ['wealth'], name: null, birthLabel: '' });
    expect(view.sections.map((s) => s.id)).toEqual(['summary', 'traits', 'topics', 'daewoon', 'yearly', 'months', 'years']);
    const months = view.sections.find((s) => s.id === 'months')!;
    expect(months.groups).toHaveLength(12);
    expect(months.groups[1]!.subtitle).toBe('2026년 11월 · 입동 11/7~12/6 · 기해(己亥)');
    expect(new Set(months.groups.map((g) => g.cluster)).size).toBe(4);
    expect(months.groups[1]!.chips!.map((c) => c.text)).toContain('기(己) ↔ 태어난 날 윗글자 · 같은 글자');
    const years = view.sections.find((s) => s.id === 'years')!;
    expect(years.groups[3]!.flow).toEqual({ label: expect.stringMatching(/^기미\(己未\)→경신\(庚申\)\(\d+월 전환\)$/u), turning: true });
    expect(years.groups[3]!.subtitle).toMatch(/^2029년 · 기유\(己酉\) · 만 \d+세\(생일 뒤\)$/u);
    expect(view.sections.find((s) => s.id === 'yearly')!.note!.links.map((l) => l.href)).toEqual(['#section-months', '#section-years']);
    const period = view.evidence.filter((e) => e.group === 'period');
    expect(period.length).toBeGreaterThan(0);
    expect(period.find((e) => e.id === 'month[1]')!.content).toMatch(/^2026년 11월\(입동 11\/7~12\/6\)은 기해\(己亥\)의 달이에요\./u);
    // 모든 문장이 근거 번호를 가진다
    expect(view.sections.every((s) => s.groups.every((g) => g.sentences.every((x) => x.refs.length > 0)))).toBe(true);
  });
  it('아이: 계절별 흐름 섹션과 링크 줄 문구', async () => {
    const r = await gen(child, new FakeTransport(validResponder(child.indices)));
    const view = buildReportView({ chart: child.chart, evidence: [...child.evidence, ...r.periodEvidence], body: r.body, topicIds: ['wealth'], name: null, birthLabel: '' });
    expect(view.sections.map((s) => s.id).slice(-2)).toEqual(['seasons', 'years']);
    expect(view.sections.find((s) => s.id === 'seasons')!.groups).toHaveLength(4);
    expect(view.sections.find((s) => s.id === 'yearly')!.note!.text).toContain('계절마다의 흐름은 아래 계절별 흐름');
    // D-057: "첫 큰 흐름 전"은 첫 줄에만, 첫 대운으로 바뀌는 해는 전환 표시를 그대로
    const flows = view.sections.find((s) => s.id === 'years')!.groups.map((g) => g.flow?.label ?? null);
    expect(flows[0]).toBe('첫 큰 흐름 전');
    expect(flows.filter((f) => f === '첫 큰 흐름 전')).toHaveLength(1);
    expect(flows.find((f) => f?.startsWith('첫 큰 흐름 전→'))).toMatch(/^첫 큰 흐름 전→갑자\(甲子\)\(11월 전환\)$/u);
    // D-057: 대운 제목은 세는 나이에 만 나이를 함께 쓴다(아이 2024-02-04생, 첫 대운 2033년 11월)
    expect(view.sections.find((s) => s.id === 'daewoon')!.groups[0]!.subtitle).toMatch(/^\d+번째 대운 · 10세\(만 9세, 2033년 11월\)부터$/u);
  });
  it('월별·10년 흐름이 없는 예전 리포트는 그대로 보인다', async () => {
    const r = await gen(adult, new FakeTransport(validResponder(adult.indices)));
    const { periods: _p, ...old } = r.body;
    const view = buildReportView({ chart: adult.chart, evidence: adult.evidence, body: old, topicIds: ['wealth'], name: null, birthLabel: '' });
    expect(view.sections.map((s) => s.id)).toEqual(['summary', 'traits', 'topics', 'daewoon', 'yearly']);
    expect(view.sections.find((s) => s.id === 'yearly')!.note).toBeUndefined();
  });
});

describe('운영자 알림 기준', () => {
  it('비율 10%', () => expect(GENERATION.templateAlertRatio).toBe(0.1));
});
