// D-049: 7차 조건부 승인 수정 — 개수 기준, 목록 보강(월간·일찍부터·구체 사례 뜻 묶음·근거에 없는 개수), 각도 옮겨 쓰기,
// 합·충 얇은 끝맺음, 같은 말 되풀이, 아이 나이와 어긋난 감정 해석, 올해·내년 뜻 묶음 쏠림, 150초 절대 상한 (가짜 LLM, 실제 호출 없음)
import { describe, expect, it } from 'vitest';
import { REPORT_LAYOUT } from '../../src/config/report';
import { findTopic } from '../../src/config/topics';
import { buildChart } from '../../src/engine/chart';
import { buildEvidence } from '../../src/engine/evidence';
import { targetDaewoonIndices, topicEvidence } from '../../src/llm/evidenceSelect';
import { fallbackBase, fallbackTopic } from '../../src/llm/fallbackText';
import { CHILD_FORBIDDEN, CHILD_VOICE_FORBIDDEN, COMMON_FORBIDDEN, TODDLER_FORBIDDEN, TODDLER_MONEY_FORBIDDEN } from '../../src/llm/forbidden';
import { generateReport } from '../../src/llm/generate';
import { topicUserMessage } from '../../src/llm/prompt';
import { SAMPLE_AS_OF, SAMPLE_INPUTS, SAMPLE_REFERENCE_YEAR } from '../../src/llm/samples';
import {
  prepareRules, validateAngleCopy, validateConcreteCase, validateInventedCount, validateRepeatedStem, validateSection, validateSentence,
  validateVacuous, validateYearly,
} from '../../src/llm/validate';
import { audienceOf } from '../../src/report/audience';
import { FakeModerator, FakeTransport, validResponder } from './fakes';

const setup = (sample: number) => {
  const chart = buildChart(SAMPLE_INPUTS[sample]!, { referenceYear: SAMPLE_REFERENCE_YEAR });
  const evidence = buildEvidence(chart);
  const indices = targetDaewoonIndices(chart, SAMPLE_REFERENCE_YEAR, REPORT_LAYOUT.daewoonNoteCount);
  const audience = audienceOf(chart, SAMPLE_AS_OF, indices);
  const forbidden = audience.child
    ? [...COMMON_FORBIDDEN, ...CHILD_FORBIDDEN, ...CHILD_VOICE_FORBIDDEN, ...(audience.toddler ? [...TODDLER_FORBIDDEN, TODDLER_MONEY_FORBIDDEN] : [])]
    : COMMON_FORBIDDEN;
  /** 생성과 같은 규칙: 주제 칸은 주제 근거 + 아이 금지어 + 주제 금지어 */
  const topicCodes = (topicId: string, text: string, ids: string[]) => {
    const topic = findTopic(topicId)!;
    const rules = prepareRules({ evidence: topicEvidence(topic, chart, evidence), forbidden: [...forbidden, ...topic.extraForbidden], maxChars: REPORT_LAYOUT.maxSentenceChars });
    return validateSentence({ text, evidenceIds: ids }, `topics.${topicId}`, rules);
  };
  return { chart, evidence, indices, audience, forbidden, topicCodes };
};

describe('8) 7차 실제 문제 문장 3개가 걸린다', () => {
  it('10번 직업·적성: "규칙·책임을 뜻하는 글자가 내 사주 8글자 중 2개" → 개수 기준(하드)', () => {
    const { topicCodes } = setup(10);
    const v = topicCodes('career', '규칙·책임을 뜻하는 글자가 내 사주 8글자 중 2개 있어서, 체계가 갖춰진 조직 안에서도 흙처럼 버티는 힘을 보일 수 있어요.', ['tenGodGroup.gwanseong']);
    expect(v.map((x) => x.code)).toContain('countBase');
    // 기준을 바로잡으면 통과한다
    expect(topicCodes('career', '규칙·책임을 뜻하는 글자가 나를 뺀 7글자 중 2개 있어서, 정해진 틀 안에서 힘을 내는 편이에요.', ['tenGodGroup.gwanseong'])).toEqual([]);
  });
  it('10번 재물: "돈이 드나드는 감각이 일찍부터 몸에 밴" → 근거에 없는 시기 해석(하드)', () => {
    const { topicCodes } = setup(10);
    const v = topicCodes('wealth', '태어난 해의 아랫글자 오(午)가 재물·활동을 뜻하는 글자라, 돈이 드나드는 감각이 일찍부터 몸에 밴 편이라고 볼 수 있어요.', ['tenGod.year.branch']);
    expect(v.map((x) => x.detail).join()).toContain('시기·자리 해석');
  });
  it('4번(2살) 재물: 10세 대운을 "마음이 격해질 때"로 푼 문장 → 아이 나이와 어긋난 감정 해석(하드)', () => {
    const { topicCodes, audience } = setup(4);
    expect(audience.toddler).toBe(true);
    const v = topicCodes('wealth', '10세(2033년 11월)부터 이어지는 갑자(甲子)의 큰 흐름은 나무와 물의 기운이라, 물건 앞에서 마음이 격해질 때 잠시 가라앉힐 틈을 곁에서 만들어 주면 잘 맞아요.', ['daewoon[0]', 'daewoon.direction']);
    expect(v.map((x) => x.detail).join()).toContain('나이와 어긋나는 감정 해석');
  });
  it('아이 주제 칸 안내에 대운별 아이 나이를 적는다', () => {
    const { chart, evidence, audience } = setup(4);
    const topic = findTopic('wealth')!;
    const msg = topicUserMessage({ topic, evidence: topicEvidence(topic, chart, evidence), audience });
    expect(msg).toMatch(/daewoon\[\d+\] 만 \d+~\d+세/u);
    expect(msg).toContain('근거에 없는 감정·성격 변화로 풀지 않습니다');
  });
});

describe('1) 개수 기준', () => {
  const { chart, evidence } = setup(10);
  const rules = prepareRules({ evidence, forbidden: COMMON_FORBIDDEN, maxChars: REPORT_LAYOUT.maxSentenceChars });
  const codes = (text: string, ids: string[]) => validateSentence({ text, evidenceIds: ids }, 'p', rules).map((v) => v.code);
  it('오행 개수 근거를 함께 인용했거나 묶음 근거가 없으면 보지 않는다', () => {
    const fire = chart.elements.counts.fire;
    expect(codes(`불의 기운은 내 사주 8글자 중 ${fire}개예요.`, ['elements.fire'])).not.toContain('countBase');
    expect(codes('규칙·책임을 뜻하는 글자가 나를 뺀 7글자 중 2개예요.', ['tenGodGroup.gwanseong'])).not.toContain('countBase');
  });
});

describe('2) 목록 보강', () => {
  const { evidence } = setup(10);
  const rules = prepareRules({ evidence, forbidden: COMMON_FORBIDDEN, maxChars: REPORT_LAYOUT.maxSentenceChars });
  const codes = (text: string, ids: string[]) => validateSentence({ text, evidenceIds: ids }, 'p', rules).map((v) => v.code);
  it('기둥 윗글자 이름 "월간"은 전문 용어, 잡지 "월간"·"아침 일찍부터"는 아니다', () => {
    expect(codes('2026년의 병(丙)은 월간의 병(丙)과 같은 글자라 겹치는 해예요.', ['seun[0]'])).toContain('jargon');
    expect(codes('월간 계획표를 만들어 보세요.', ['seun[0]'])).not.toContain('jargon');
    expect(codes('아침 일찍부터 움직이면 하루가 가벼워져요.', ['seun[0]'])).not.toContain('forbidden');
  });
  it('구체 사례는 뜻 묶음으로 잡는다(오래된 인연·익숙한 환경)', () => {
    const v = (text: string) => validateConcreteCase([{ path: 'p', text }]).length;
    for (const t of ['오래된 인연을 다시 찾아보세요.', '오래 알던 친구에게 연락해 보세요.', '옛 인연이 떠오르는 해예요.', '익숙한 환경에서 힘을 내요.', '익숙한 동네를 걸어 보세요.']) expect(v(t), t).toBe(1);
    for (const t of ['인연을 소중히 여기는 편이에요.', '익숙한 방식에 기대는 편이에요.', '오래 이어 가는 힘이 있어요.']) expect(v(t), t).toBe(0);
  });
  it('근거에 없는 개수("세 가지")는 잡고, 한 가지·두 글자는 잡지 않는다', () => {
    const v = (text: string) => validateInventedCount([{ path: 'p', text }]).length;
    expect(v('지출 항목을 세 가지로 나눠 정해 두면 좋아요.')).toBe(1);
    expect(v('한 주에 두 번 쉬어 보세요.')).toBe(1);
    for (const t of ['한 가지를 골라 이어 가 보세요.', '두 글자가 서로 묶이는 관계예요.', '한 번에 하나씩 해 보세요.', '두 가지 기운이 함께 와요.']) expect(v(t), t).toBe(0);
  });
});

describe('3) 각도 옮겨 쓰기·얇은 합·충 끝맺음·같은 말 되풀이 (soft)', () => {
  it('7차에 겹친 각도 이름 낱말을 잡는다', () => {
    const texts = ['맡은 일에 이름을 걸고 끝까지 해내는 편이에요.', '내 몫을 지키려는 마음이 분명해요.', '마음속에 팽팽한 긴장이 도는 모습이 나타날 수 있어요.', '여러 일이 한데 모여 커지는 모습이 보여요.'];
    for (const t of texts) expect(validateAngleCopy([{ path: 'p', text: t }]), t).toHaveLength(1);
    expect(validateAngleCopy([{ path: 'p', text: '정해진 일을 끝까지 해내는 편이에요.' }])).toEqual([]);
  });
  it('합·충 문장이 각도 이름 + "~모습이 보여요/나타나요"로 끝나면 잡는다', () => {
    const v = (text: string) => validateVacuous([{ path: 'p', text }]).map((x) => x.code);
    expect(v('정미(丁未)의 미(未)는 태어난 시의 오(午)와 서로 묶이는 관계라, 한데 모여 커지는 흐름이 보여요.')).toEqual(['vacuousRelation']);
    expect(v('미(未)와 축(丑)이 서로 부딪치는 관계라, 팽팽한 긴장이 도는 모습이 보여요.')).toEqual(['vacuousRelation']);
    expect(v('두 글자가 서로 묶여 낯선 일에도 금방 마음을 붙이는 편이에요.')).toEqual([]);
  });
  it('"부딪쳐서 부딪치며"처럼 같은 말을 되풀이하면 잡는다', () => {
    expect(validateRepeatedStem([{ path: 'p', text: '두 글자가 부딪쳐서 부딪치며 바뀌는 해예요.' }])).toHaveLength(1);
    expect(validateRepeatedStem([{ path: 'p', text: '태어난 해의 윗글자와 태어난 날의 윗글자가 묶여요.' }])).toEqual([]);
  });
});

describe('리뷰 반영: 오탐 줄이기와 옮겨 쓰기 재시도 상한', () => {
  const { evidence, forbidden } = setup(4);
  const adultRules = prepareRules({ evidence, forbidden: COMMON_FORBIDDEN, maxChars: REPORT_LAYOUT.maxSentenceChars });
  const childRules = prepareRules({ evidence, forbidden, maxChars: REPORT_LAYOUT.maxSentenceChars });
  const codes = (rules: typeof adultRules, text: string, ids: string[]) => validateSentence({ text, evidenceIds: ids }, 'p', rules).map((v) => v.code);
  it('하드 규칙의 오탐: 일찍부터 일어나기, 격해지지 않게, 쉬는 시간, 사주 글자 수 일반 언급', () => {
    expect(codes(adultRules, '하루를 일찍부터 시작하면 마음이 가벼워져요.', ['seun[0]'])).toEqual([]);
    expect(codes(childRules, '마음이 격해지지 않게 곁에서 천천히 기다려 주세요.', ['seun[0]'])).toEqual([]);
    expect(codes(adultRules, '쉬는 시간은 자(子) 같은 밤 시간에 두면 좋아요.', ['pillar.year.branch'])).not.toContain('jargon');
    const g = evidence.find((e) => e.kind === 'tenGodGroup')!;
    const total = /원국 (\d+)글자/u.exec(g.content)![1];
    expect(codes(adultRules, `사주 ${total}글자가 고르게 놓인 편이에요.`, [g.id])).not.toContain('countBase');
    expect(validateInventedCount([{ path: 'p', text: '세 번째 시도에서 길이 보여요.' }])).toEqual([]);
  });
  it('D-051: 각도 이름 옮겨 쓰기는 다시 쓰게 하지 않고 기록만 남긴다', async () => {
    const { chart, indices } = setup(0);
    const ev0 = buildEvidence(chart);
    const ok = validResponder(indices);
    let topicCalls = 0;
    const t = new FakeTransport((req, call) => {
      const r = ok(req, call) as { body: any };
      if (req.label !== 'topic:wealth') return r;
      topicCalls++;
      // 매번 각도 이름("이름을 걸고")을 옮겨 쓴다
      return { body: { sentences: r.body.sentences.map((x: any, i: number) => (i === 0 ? { ...x, text: '이름을 걸고 맡은 일을 해내는 편이에요.' } : x)) } };
    });
    const r = await generateReport({ chart, evidence: ev0, topicIds: ['wealth'], referenceYear: SAMPLE_REFERENCE_YEAR, transport: t, moderator: new FakeModerator(), asOf: SAMPLE_AS_OF });
    expect(topicCalls).toBe(1);
    expect(r.attempts.filter((a) => a.label === 'topic:wealth')[0]!.violations).toEqual([]);
    expect(r.body.observed!.angleCopy).toBeGreaterThanOrEqual(1);
  });
});

describe('5) 올해·내년 한 칸의 뜻 묶음 쏠림 (soft)', () => {
  const facts = { seunId: 'seun[0]', groupLabels: ['배움·보살핌'], hasRelation: false };
  const s = (text: string) => ({ text, evidenceIds: ['seun[0]'] });
  it('4문장 중 3문장이 같은 묶음 이름이면 잡고, 2문장이면 통과', () => {
    const three = [s('배움·보살핌을 뜻하는 글자가 들어와요.'), s('배움·보살핌의 뜻이 커져요.'), s('흙의 기운이 더해져요.'), s('배움·보살핌을 뜻하는 글자라 곁을 챙겨 주세요.')];
    expect(validateYearly(three, 'yearly.thisYear', facts).map((v) => v.code)).toContain('yearlyGroupSkew');
    const two = [three[0]!, s('불의 기운이 강해요.'), s('흙의 기운이 더해져요.'), three[3]!];
    expect(validateYearly(two, 'yearly.thisYear', facts).map((v) => v.code)).not.toContain('yearlyGroupSkew');
  });
});

describe('4) 150초 절대 상한: 끝나지 않은 칸은 코드 사실 문장으로, 주문은 실패시키지 않는다', () => {
  it('샘플 20건(어른·아이)의 사실 문장이 생성 문장과 같은 하드 검증을 통과한다', () => {
    for (const [i] of SAMPLE_INPUTS.entries()) {
      const { chart, evidence, indices, audience, forbidden } = setup(i);
      const rules = prepareRules({ evidence, forbidden, maxChars: REPORT_LAYOUT.maxSentenceChars });
      const b = fallbackBase(chart, indices, audience);
      const L = REPORT_LAYOUT;
      const v = [
        ...validateSection(b.summary, 'summary', L.summaryAiSentences, rules),
        ...validateSection(b.traits, 'traits', L.traitsSentences, rules),
        ...b.daewoonNotes.flatMap((n, j) => validateSection(n.sentences, `daewoonNotes[${j}]`, L.daewoonNoteSentences, rules)),
        ...validateSection(b.yearly.thisYear, 'yearly.thisYear', L.yearlySentences, rules),
        ...validateSection(b.yearly.nextYear, 'yearly.nextYear', L.yearlySentences, rules),
      ];
      expect(v, `sample ${i}`).toEqual([]);
      expect(b.yearly.nextYear.some((x) => x.text.includes('올해'))).toBe(false);
      for (const id of ['wealth', 'career', 'love']) {
        const topic = findTopic(id)!;
        const te = topicEvidence(topic, chart, evidence);
        const tr = prepareRules({ evidence: te, forbidden: [...forbidden, ...topic.extraForbidden], maxChars: L.maxSentenceChars });
        expect(validateSection(fallbackTopic(chart, te, indices, audience).sentences, `topics.${id}`, L.topicSentences, tr), `sample ${i} ${id}`).toEqual([]);
      }
    }
  });

  it('시뮬레이션: 기본 칸 응답이 상한보다 늦으면 기본 칸만 사실 문장으로 채우고 주제 칸은 AI 문장을 쓴다', async () => {
    const { chart, evidence, indices } = setup(0);
    const t = new FakeTransport(validResponder(indices), (label) => (label === 'base' ? 400 : 0));
    const started = Date.now();
    const r = await generateReport({ chart, evidence, topicIds: ['wealth'], referenceYear: SAMPLE_REFERENCE_YEAR, transport: t, moderator: new FakeModerator(), asOf: SAMPLE_AS_OF, limits: { hardMs: 100 } });
    const elapsed = Date.now() - started;
    expect(elapsed).toBeLessThan(400);
    expect(r.body.templated).toEqual(['base']);
    expect(r.body.traits[0]!.text).toMatch(/뜻하는 글자는 나를 뺀 7글자 중/u);
    expect(r.body.topics.wealth![0]!.text).toContain('근거를 바탕으로 쓴');
    expect(r.attempts.filter((a) => a.stopReason === 'deadlineTemplate').map((a) => a.label)).toEqual(['base']);
  });

  it('시뮬레이션: 검증 실패로 재시도하던 주제 칸이 상한에 닿아도 주문은 실패하지 않는다', async () => {
    const { chart, evidence, indices } = setup(0);
    const ok = validResponder(indices);
    // 주제 칸은 늘 근거 없는 문장(하드 위반)을 50ms 뒤에 돌려준다 → 3회 안에 상한(120ms)에 닿는다
    const t = new FakeTransport(
      (req, call) => (req.label === 'base' ? ok(req, call) : { body: { sentences: [{ text: '근거 없는 문장이에요.', evidenceIds: [] }] } }),
      (label) => (label === 'base' ? 0 : 50),
    );
    const r = await generateReport({ chart, evidence, topicIds: ['career'], referenceYear: SAMPLE_REFERENCE_YEAR, transport: t, moderator: new FakeModerator(), asOf: SAMPLE_AS_OF, limits: { hardMs: 120 } });
    expect(r.body.templated).toEqual(['topic:career']);
    expect(r.body.topics.career).toHaveLength(REPORT_LAYOUT.topicSentences);
    expect(r.body.traits[0]!.text).toContain('근거를 바탕으로 쓴');
  });

  it('상한 전에 끝나면 사실 문장으로 바꾸지 않는다', async () => {
    const { chart, evidence, indices } = setup(0);
    const r = await generateReport({ chart, evidence, topicIds: ['wealth'], referenceYear: SAMPLE_REFERENCE_YEAR, transport: new FakeTransport(validResponder(indices)), moderator: new FakeModerator(), asOf: SAMPLE_AS_OF, limits: { hardMs: 5_000 } });
    expect(r.body.templated).toBeUndefined();
  });
});
