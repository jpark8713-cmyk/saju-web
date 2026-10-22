// 간지·십신 표기 찾기, 문장 검증, 금지 표현
import { describe, expect, it } from 'vitest';
import { buildChart } from '../../src/engine/chart';
import { BRANCHES_KO, STEMS_KO, TEN_GOD_GROUPS, TEN_GOD_KO } from '../../src/engine/constants';
import { buildEvidence } from '../../src/engine/evidence';
import { COMMON_FORBIDDEN } from '../../src/llm/forbidden';
import { findJargon } from '../../src/llm/jargon';
import { allowedTerms, extractTerms } from '../../src/llm/terms';
import { hasMultipleSentences, prepareRules, validateNumbers, validateRepetition, validateSentence, validateStandalone } from '../../src/llm/validate';
import { SAMPLE_INPUTS, SAMPLE_REFERENCE_YEAR } from '../../src/llm/samples';

describe('extractTerms', () => {
  it.each([
    ['일간 갑(甲)은 곧은 나무예요.', ['甲']],
    ['갑자(甲子) 대운에는', ['甲', '子', '갑자']],
    ['임신년에는 흐름이 바뀌어요.', ['임신']],
    ['임신과 출산 이야기는 하지 않아요.', []],
    ['갑목 일간이라', ['갑']],
    ['정재와 편관이 보여요.', ['정재', '편관']],
    ['칠살의 기운', ['편관']],
    ['재성이 많은 편이에요.', ['재성']],
    // 쉬운 그룹 표기(D-042)는 그룹 이름으로 본다
    ['재물·활동을 뜻하는 글자가 있어요.', ['재성']],
    ['표현 · 재능의 기운이 보여요.', ['식상']],
    ['재물과 활동을 챙겨요.', []],
    ['그런 건 상관없이 괜찮아요.', []],
    ['상관이 강하면 표현이 많아요.', ['상관']],
    ['기사를 읽고 정리해 보세요.', []],
    // 리뷰에서 찾은 놓침: 조사가 붙은 한글 간지
    ['갑목이 강해요.', ['갑']],
    ['병화는 밝아요.', ['병']],
    ['경금을 다듬어요.', ['경']],
    // 띄어 쓴 천간+오행은 찾지 않는다 ("책임 수행" 오탐을 막으려는 대가, D-017 한계)
    ['갑 목의 기운', []],
    ['임수가 강한 편이에요.', ['임']],
    ['갑자가 들어와요.', ['갑자']],
    ['일주가 정축이에요.', ['정축']],
    ['세운이 병오예요.', ['병오']],
    ['임신년에는 흐름이 바뀌어요.', ['임신']],
    // 리뷰에서 찾은 오탐: 일반 낱말
    ['임신 시기에는 쉬어 가요.', []],
    ['기록을 경신 일정에 맞춰요.', []],
    ['기사 일정을 확인해요.', []],
    ['정유 시간에 맞춰 가요.', []],
    ['상관 없이 해 보세요.', []],
    ['상관관계를 살펴봐요.', []],
    ['갑자기 바뀌어도 괜찮아요.', []],
    ['정해진 순서대로 해요.', []],
    ['마음을 정화하는 시간을 가져요.', []],
    ['기미가 보이면 쉬어 가세요.', []],
    // 2차 리뷰에서 찾은 오탐: 낱말 중간의 천간+오행
    ['안정을 목표로 차근차근 쌓아 가요.', []],
    ['책임 수행 능력이 좋아요.', []],
    ['책임수준을 지켜요.', []],
    ['주정 화학 분야', []],
    ['신 금리 상품', []],
    ['일을 목록으로 정리해요.', []],
    ['경금속 가공 일', []],
    // 2차 리뷰에서 찾은 놓침: 띄어 쓴 간지 단독
    ['갑자 기운이 들어와요.', ['갑자']],
    ['병오 기운이 강해요.', ['병오']],
    ['병오 시기에는', ['병오']],
    ['갑자생이에요.', ['갑자']],
    ['갑자 해에는', ['갑자']],
    ['일주 정축', ['정축']],
    ['정축, 을묘 기운이 겹쳐요.', ['정축', '을묘']],
    // 3차 리뷰에서 찾은 오탐: 낱말 중간의 십신 이름, 띄어 쓴 정화
    ['고정관념에서 벗어나 보세요.', []],
    ['개인성향에 맞는 일을 고르면 좋아요.', []],
    ['습관성 소비를 줄이면 좋아요.', []],
    ['지정인원을 정해 두면 좋아요.', []],
    ['인성 교육처럼 기본을 다져요.', []],
    ['마음 정화 시간을 가져 보세요.', []],
    ['정화 작업처럼 정리해요.', []],
    // 3차 리뷰에서 찾은 놓침: 서술격 어미 뒤 한글 간지
    ['갑자인 해예요.', ['갑자']],
    ['갑자이며 흐름이 바뀌어요.', ['갑자']],
    ['갑자해에는 쉬어 가요.', ['갑자']],
    ['병화이라서 밝아요.', ['병']],
    ['병화답게 따뜻해요.', ['병']],
    ['일간이 경금입니다.', ['경']],
  ])('%s', (text, expected) => {
    expect(extractTerms(text).sort()).toEqual([...expected].sort());
  });
});

describe('validateSentence', () => {
  // 1990-05-15 14:30 남: 경오년, 일간 경(庚)
  const chart = buildChart(SAMPLE_INPUTS[0]!, { referenceYear: SAMPLE_REFERENCE_YEAR });
  const evidence = buildEvidence(chart);
  const rules = prepareRules({ evidence, forbidden: COMMON_FORBIDDEN, maxChars: 120 });
  const dayStem = evidence.find((e) => e.id === 'dayMaster')!;
  const hanja = dayStem.terms[1]!; // 일간 한자

  it('근거를 인용한 정상 문장은 통과', () => {
    expect(validateSentence({ text: `나를 나타내는 글자 ${hanja}의 성향이 드러나요.`, evidenceIds: ['dayMaster'] }, 's', rules)).toEqual([]);
  });

  it('전문 용어가 남으면 거부 (D-042)', () => {
    const v = validateSentence({ text: `일간 ${hanja}의 성향이 드러나요.`, evidenceIds: ['dayMaster'] }, 's', rules);
    expect(v.map((x) => [x.code, x.detail])).toEqual([['jargon', '전문 용어를 쉬운 말로 바꿔 씁니다: 일간']]);
  });

  it('근거 id가 없으면 거부', () => {
    expect(validateSentence({ text: '좋은 하루예요.', evidenceIds: [] }, 's', rules).map((v) => v.code)).toEqual(['noEvidence']);
  });

  it('목록에 없는 id는 거부', () => {
    expect(validateSentence({ text: '좋은 하루예요.', evidenceIds: ['pillar.hour.foo'] }, 's', rules).map((v) => v.code)).toEqual([
      'unknownEvidence',
    ]);
  });

  it('근거 목록 어디에도 없는 간지를 쓰면 거부', () => {
    // 대운 10개가 천간 10개를 모두 덮으므로 근거에 없는 60갑자 이름(+접미어)으로 시험한다
    const terms = allowedTerms(evidence);
    const names = Array.from({ length: 60 }, (_, i) => `${STEMS_KO[i % 10]}${BRANCHES_KO[i % 12]}`);
    const absent = names.find((n) => !terms.has(n));
    expect(absent).toBeDefined();
    const v = validateSentence({ text: `${absent}년의 기운이 있어요.`, evidenceIds: ['dayMaster'] }, 's', rules);
    expect(v.map((x) => x.code)).toContain('termNotInEvidence');
  });

  it('간지가 근거 목록에는 있지만 인용한 근거에는 없으면 거부 (내용 불일치)', () => {
    const elementEv = 'elements.wood';
    const v = validateSentence({ text: `나를 나타내는 글자 ${hanja}의 성향이에요.`, evidenceIds: [elementEv] }, 's', rules);
    expect(v.map((x) => x.code)).toEqual(['termNotInCitedEvidence']);
  });

  it('한글로만 쓴 간지도 인용한 근거와 맞아야 한다 (리뷰 재현: 경 일간에 "임수가")', () => {
    const v = validateSentence({ text: '임수가 강한 편이에요.', evidenceIds: ['dayMaster'] }, 's', rules);
    expect(v.map((x) => x.code)).toContain('termNotInCitedEvidence');
  });

  it('0개인 십신 그룹 근거로 "있다"고 쓸 수 없다 (리뷰 재현)', () => {
    const empty = evidence.find((e) => e.kind === 'tenGodGroup' && e.content.includes(' 0개'))!;
    const groupName = empty.terms[0]!;
    expect(empty.terms).toEqual([groupName]);
    const member = { 재성: '정재', 관성: '정관', 인성: '정인', 식상: '식신', 비겁: '비견' }[groupName]!;
    const plain = TEN_GOD_GROUPS.find((g) => g.ko === groupName)!.plain;
    expect(validateSentence({ text: `${plain}을 뜻하는 글자가 없는 편이에요.`, evidenceIds: [empty.id] }, 's', rules)).toEqual([]);
    // 원국에 없는 십신이면 근거 목록 전체에도 없어 더 강한 규칙(termNotInEvidence)으로 걸린다
    const codes = validateSentence({ text: `${member}가 있어요.`, evidenceIds: [empty.id] }, 's', rules).map((x) => x.code);
    expect(codes.some((c) => c === 'termNotInCitedEvidence' || c === 'termNotInEvidence')).toBe(true);
  });

  it('십신 이름도 인용한 근거와 맞아야 한다', () => {
    const tg = evidence.find((e) => e.kind === 'tenGod')!;
    const name = tg.terms[tg.terms.length - 1]!;
    // 문장에는 십신 이름 대신 쉬운 그룹 표기(D-042)를 쓰고, 그 표기도 인용한 근거와 맞아야 한다
    const plain = TEN_GOD_GROUPS.find((g) => g.members.some((m) => TEN_GOD_KO[m] === name))!.plain;
    expect(validateSentence({ text: `${plain}의 성향이 보여요.`, evidenceIds: [tg.id] }, 's', rules)).toEqual([]);
    expect(validateSentence({ text: `${plain}의 성향이 보여요.`, evidenceIds: ['elements.fire'] }, 's', rules).map((v) => v.code)).toContain(
      'termNotInCitedEvidence',
    );
  });

  it('글자 수 상한을 넘으면 거부', () => {
    const v = validateSentence({ text: '가'.repeat(121), evidenceIds: ['dayMaster'] }, 's', rules);
    expect(v.map((x) => x.code)).toEqual(['tooLong']);
  });

  it.each([
    ['위장 질환에 주의하세요.', '질병·의료 판단'],
    ['주식에 투자하세요.', '투자 권유·재물 손실 단정'],
    ['큰 사고를 당할 수 있어요.', '사망·재앙 단정'],
    ['반드시 실패하게 돼요.', '불안을 키우는 단정'],
    ['적중률이 높은 풀이예요.', '입증할 수 없는 정확성 표현'],
  ])('금지 표현: %s', (text, reason) => {
    const v = validateSentence({ text, evidenceIds: ['dayMaster'] }, 's', rules);
    // 걸린 낱말도 함께 알려 준다(D-044)
    const details = v.filter((x) => x.code === 'forbidden').map((x) => x.detail);
    expect(details).toHaveLength(1);
    expect(details[0]).toMatch(new RegExp(`^금지 표현\\(${reason.replace(/[()·]/g, '.')}\\): ".+"$`, 'u'));
  });
});

describe('한 칸에 문장 하나', () => {
  it.each([
    ['책임감을 중시하는 면이 있어요. 할 일을 적어 두면 부담이 줄어요.', true],
    ['좋은 흐름이에요! 천천히 해 보세요.', true],
    ['정말 그럴까요? 차근차근 살펴봐요.', true],
    ['“차분하게 가요.” 이런 마음가짐이 좋아요.', true],
    ['책임감을 중시하는 면이 있어요.', false],
    ['금(金)이 3.5배 많다는 뜻은 아니에요.', false],
    ['마음가짐이 좋아요.”', false],
    ['문장 끝 부호가 없어도 하나예요', false],
  ])('%s → 둘 이상: %s', (text, multi) => {
    expect(hasMultipleSentences(text)).toBe(multi);
  });

  it('두 문장을 넣은 칸은 검증에서 거부된다', () => {
    const chart = buildChart(SAMPLE_INPUTS[0]!, { referenceYear: SAMPLE_REFERENCE_YEAR });
    const rules = prepareRules({ evidence: buildEvidence(chart), forbidden: COMMON_FORBIDDEN, maxChars: 120 });
    const v = validateSentence({ text: '흐름이 좋아요. 기록해 보세요.', evidenceIds: ['dayMaster'] }, 's', rules);
    expect(v.map((x) => x.code)).toEqual(['multipleSentences']);
  });
});

describe('숫자 사실과 대운 시작 표기 (D-022)', () => {
  const chart = buildChart(SAMPLE_INPUTS[0]!, { referenceYear: SAMPLE_REFERENCE_YEAR });
  const evidence = buildEvidence(chart);
  const byId = new Map(evidence.map((e) => [e.id, e]));
  const d1 = chart.daewoon[1]!;
  const label = `${d1.koreanAge}세(${d1.startYear}년 ${d1.startMonth}월)`;
  const cite = (...ids: string[]) => ids.map((id) => byId.get(id)!);

  it('대운 시작을 표준 표기 그대로 쓰면 통과', () => {
    expect(validateNumbers(`${label}부터 새 흐름이 열려요.`, 'p', cite('daewoon[1]'))).toEqual([]);
  });

  it.each([
    [`${d1.koreanAge}세부터 새 흐름이 열려요.`],
    [`${d1.startYear}년 ${d1.startMonth}월부터 새 흐름이 열려요.`],
    [`${d1.startYear}년부터 새 흐름이 열려요.`],
  ])('나이나 연·월만 따로 쓰면 거부: %s', (text) => {
    expect(validateNumbers(text, 'p', cite('daewoon[1]')).map((v) => v.code)).toContain('daewoonStartFormat');
  });

  it('인용한 근거에 없는 연·월·나이는 거부', () => {
    const wrong = `${d1.koreanAge + 1}세(${d1.startYear + 1}년 ${d1.startMonth}월)부터 흐름이 바뀌어요.`;
    const codes = validateNumbers(wrong, 'p', cite('daewoon[1]')).map((v) => v.code);
    expect(codes).toContain('numberNotInEvidence');
  });

  it('세운 연도는 세운 근거를 인용하면 통과, 인용하지 않으면 거부', () => {
    expect(validateNumbers(`${SAMPLE_REFERENCE_YEAR}년에는 차분히 정리해요.`, 'p', cite('seun[0]'))).toEqual([]);
    expect(validateNumbers(`${SAMPLE_REFERENCE_YEAR}년에는 차분히 정리해요.`, 'p', cite('dayMaster')).map((v) => v.code)).toEqual([
      'numberNotInEvidence',
    ]);
  });

  it('숫자가 없거나 "10년간" 같은 기간은 대상이 아니다', () => {
    expect(validateNumbers('10년간 이어지는 흐름이에요.', 'p', cite('daewoon[1]'))).toEqual([]);
    expect(validateNumbers('차분히 정리해 보세요.', 'p', cite('daewoon[1]'))).toEqual([]);
  });
});

describe('숫자 규칙: 리뷰에서 찾은 우회·오탐·누락 (D-022)', () => {
  const chart = buildChart(SAMPLE_INPUTS[0]!, { referenceYear: SAMPLE_REFERENCE_YEAR });
  const ev = new Map(buildEvidence(chart).map((e) => [e.id, e]));
  const cite = (...ids: string[]) => ids.map((id) => ev.get(id)!);
  const [d0, d1] = [chart.daewoon[0]!, chart.daewoon[1]!];
  const L0 = `${d0.koreanAge}세(${d0.startYear}년 ${d0.startMonth}월)`;
  const L1 = `${d1.koreanAge}세(${d1.startYear}년 ${d1.startMonth}월)`;
  const codes = (text: string, ...ids: string[]) => validateNumbers(text, 'p', cite(...ids)).map((v) => v.code);

  it('표준 표기 옆에 따로 쓴 연도는 거부 (우회 1)', () => {
    expect(codes(`${L0}부터이고 ${d1.startYear}년에 바뀝니다.`, 'daewoon[0]', 'daewoon[1]')).toContain('daewoonStartFormat');
  });

  it('두 근거를 섞은 가짜 표기는 거부 (우회 2)', () => {
    const fake = `${d1.koreanAge}세(${d0.startYear}년 ${d0.startMonth}월)`;
    expect(codes(`${fake}부터 두 번째 대운이에요.`, 'daewoon[0]', 'daewoon[1]')).toContain('numberNotInEvidence');
  });

  it('두 대운을 각각 표준 표기로 쓰면 통과', () => {
    expect(codes(`${L0}부터 ${L1}까지 흐름이 이어져요.`, 'daewoon[0]', 'daewoon[1]')).toEqual([]);
  });

  it('전각 괄호도 같은 표기로 본다', () => {
    expect(codes(`${L0.replace('(', '（').replace(')', '）')}부터 흐름이 열려요.`, 'daewoon[0]')).toEqual([]);
  });

  it('대운과 세운을 함께 인용하고 세운 연도만 쓰면 통과 (오탐 수정)', () => {
    expect(codes(`${SAMPLE_REFERENCE_YEAR}년은 새 대운의 흐름이 함께하는 해예요.`, 'seun[0]', 'daewoon[1]')).toEqual([]);
  });

  it('대운을 인용하고 세운 연도에 월을 붙이면 표준 표기를 요구', () => {
    expect(codes(`${SAMPLE_REFERENCE_YEAR}년 6월에는 대운이 바뀌어요.`, 'seun[0]', 'daewoon[1]')).toContain('daewoonStartFormat');
  });

  it.each([
    [`${d0.koreanAge}살부터 대운이 시작돼요.`],
    ['여덟 살부터 대운이 시작돼요.'],
    ['스물여덟 살부터 흐름이 바뀌어요.'],
    [`${String(d0.startYear).slice(2)}년부터 대운이 시작돼요.`],
    [`${d0.startYear}.${d0.startMonth}부터 대운이 시작돼요.`],
  ])('다른 표기의 나이·연·월은 거부 (누락 수정): %s', (text) => {
    expect(codes(text, 'daewoon[0]')).toContain('daewoonStartFormat');
  });

  it.each(['1~2문장으로 정리해요.', '10년간 이어지는 흐름이에요.', '30대에는 차분히 쌓아요.', '2~3년에 걸쳐 다져요.', '3개월마다 돌아봐요.'])(
    '기간 표현은 대상이 아니다: %s',
    (text) => {
      expect(codes(text, 'daewoon[0]')).toEqual([]);
    },
  );
});

describe('개수 규칙: 개수는 인용한 근거에 적힌 값만 (D-043)', () => {
  // 샘플 0번: 시간을 아는 사주라 원국 8글자, 일간을 뺀 7글자 기준으로 그룹을 센다
  const chart = buildChart(SAMPLE_INPUTS[0]!, { referenceYear: SAMPLE_REFERENCE_YEAR });
  const evidence = buildEvidence(chart);
  const ev = new Map(evidence.map((e) => [e.id, e]));
  const codes = (text: string, ...ids: string[]) => validateNumbers(text, 'p', ids.map((id) => ev.get(id)!)).map((v) => v.code);
  const group = evidence.find((e) => e.kind === 'tenGodGroup' && !/ 0개/.test(e.content))!;
  const n = /(\d+)개/.exec(group.content)![1]!;
  const el = evidence.find((e) => e.id.startsWith('elements.') && /중 [1-9]개/.test(e.content))!;
  const m = /중 (\d+)개/.exec(el.content)![1]!;

  it('그룹 근거는 일간을 뺀 글자 수를 적는다', () => {
    expect(chart.elements.total).toBe(8);
    expect(group.content).toContain(`원국 8글자 중 일간(나를 나타내는 글자)을 뺀 7글자에서 ${n}개`);
  });

  it('근거의 글자 수·개수를 그대로 쓰면 통과', () => {
    expect(codes(`나를 나타내는 글자를 뺀 7글자 중 ${n}개가 있어요.`, group.id)).toEqual([]);
    expect(codes(`내 사주 8글자 중 ${m}개예요.`, el.id)).toEqual([]);
    expect(codes(`내 사주 8글자 중 ${n}개가 있어요.`, group.id)).toEqual([]);
  });

  it('근거와 다른 글자 수는 거부 (측정에서 찾은 "6글자 중")', () => {
    expect(codes(`내 사주 6글자 중 ${n}개가 있어요.`, group.id)).toContain('numberNotInEvidence');
  });

  it('근거와 다른 개수는 거부', () => {
    expect(codes(`7글자 중 ${Number(n) + 4}개가 있어요.`, group.id)).toContain('numberNotInEvidence');
  });

  it('대운 근거를 함께 인용해도 개수는 근거 문구와 대조한다', () => {
    expect(codes(`이 흐름에는 내 사주 8글자 중 ${m}개인 기운이 더해져요.`, 'daewoon[0]', el.id)).toEqual([]);
    expect(codes('이 흐름에는 9개의 기운이 더해져요.', 'daewoon[0]', el.id)).toContain('numberNotInEvidence');
  });

  it('한글로 쓴 조언 속 개수와 기간은 대상이 아니다', () => {
    expect(codes('할 일을 세 가지만 적어 보세요.', group.id)).toEqual([]);
    expect(codes('3개월마다 한 번 돌아보세요.', group.id)).toEqual([]);
  });

  it('대운·세운 근거에 천간·지지 오행을 적는다', () => {
    // D-048: 그해 글자의 뜻(십신·묶음)과 원국 글자와의 관계도 적는다
    expect(ev.get('seun[0]')!.content).toMatch(
      /^2026년 세운은 .+\(.+\): 천간 .\(.\) 오행 .\(.\), 지지 .\(.\) 오행 .\(.\)\. 일간 기준 천간 .\(.\)은\(는\) .+\((비겁|식상|재성|관성|인성)\), 지지 .\(.\)은\(는\) .+\((비겁|식상|재성|관성|인성)\)\. 원국과의 관계: .+$/u,
    );
    expect(ev.get('daewoon[0]')!.content).toMatch(/, 천간 .\(.\) 오행 .\(.\), 지지 .\(.\) 오행 .\(.\)$/u);
  });
});

describe('기간 표현은 두 자리 연도로 보지 않는다 (리뷰 MEDIUM)', () => {
  const chart = buildChart(SAMPLE_INPUTS[0]!, { referenceYear: SAMPLE_REFERENCE_YEAR });
  const ev = new Map(buildEvidence(chart).map((e) => [e.id, e]));
  const codes = (text: string, ...ids: string[]) => validateNumbers(text, 'p', ids.map((id) => ev.get(id)!)).map((v) => v.code);

  it.each([
    '10년에 한 번 오는 큰 변화의 흐름으로 볼 수 있어요.',
    '20년에 걸쳐 쌓아 가는 흐름이에요.',
    '10년도 지나지 않아 다시 정리할 때가 와요.',
    '10년에 걸친 대운이에요.',
    '10년에서 20년 사이에 천천히 다져요.',
  ])('대운 인용: %s', (text) => {
    expect(codes(text, 'daewoon[1]')).toEqual([]);
  });

  it('세운만 인용: "10년에 한 번쯤" 통과', () => {
    expect(codes('10년에 한 번쯤 방향을 점검해 보면 좋아요.', 'seun[0]')).toEqual([]);
  });

  it('두 자리 연도 + 부터는 여전히 잡는다', () => {
    expect(codes('17년부터 흐름이 바뀌어요.', 'daewoon[1]')).toContain('daewoonStartFormat');
  });
});

describe('십신 그룹 근거에 글자도 적는다 (D-018, 3차 측정 재시도 원인)', () => {
  const chart = buildChart(SAMPLE_INPUTS[0]!, { referenceYear: SAMPLE_REFERENCE_YEAR });
  const evidence = buildEvidence(chart);
  const rules = prepareRules({ evidence, forbidden: COMMON_FORBIDDEN, maxChars: 120 });

  it('글자가 있는 그룹은 문구와 terms에 그 글자가 들어가고, 그룹을 인용한 문장이 그 글자를 써도 통과', () => {
    const groups = evidence.filter((e) => e.kind === 'tenGodGroup' && !e.content.includes(' 0개'));
    expect(groups.length).toBeGreaterThan(0);
    for (const g of groups) {
      const hanja = g.terms.find((t) => /[一-鿿]/u.test(t))!;
      expect(g.content).toContain(`(${hanja})`);
      const v = validateSentence({ text: `${hanja} 자리의 기운이 드러나는 편이에요.`, evidenceIds: [g.id] }, 's', rules);
      expect(v, g.id).toEqual([]);
    }
  });

  it('0개인 그룹은 여전히 그룹 이름만 허용', () => {
    for (const g of evidence.filter((e) => e.kind === 'tenGodGroup' && e.content.includes(' 0개'))) {
      expect(g.terms).toHaveLength(1);
    }
  });
});

describe('전문 용어 찾기 (D-042)', () => {
  it.each([
    ['일간 임(壬)은 물이에요.', ['일간']],
    ['원국에 흙이 많아요.', ['원국']],
    ['년주 천간 을(乙)은 상관이에요.', ['년주', '천간', '상관']],
    ['월주 지지 미(未)가 있어요.', ['지지', '월주']],
    ['2026년 세운은 병오(丙午)예요.', ['세운']],
    ['정축(丁丑) 대운이 이어져요.', ['대운']],
    ['토(土)가 3개예요.', ['오행 한자 표기']],
    ['임수(壬水)라 넓게 봐요.', ['일간 표기(예: 임수(壬水))']],
    ['양(陽)의 기운이에요.', ['음양']],
    ['칠살의 힘이 있어요.', ['편관']],
    // 일반 낱말은 잡지 않는다
    ['일주일에 한 번 정리해 보세요.', []],
    ['주변의 지지를 받으면 힘이 나요.', []],
    ['계획을 세운 뒤 움직여요.', []],
    ['상관없이 꾸준히 해 보세요.', []],
    // 리뷰에서 찾은 오탐(D-042)
    ['관성적으로 하던 일을 돌아봐요.', []],
    ['비겁하게 느껴질 수 있어요.', []],
    ['식상한 표현은 줄여요.', []],
    ['흐름에 역행하지 않아요.', []],
    // 십신 이름으로 쓴 "상관이 있어요"는 일반 낱말 예외로 가리지 않는다(검증 우회 방지)
    ['내 사주에 상관이 있어요.', ['상관']],
    ['세운을 맞아요.', ['세운']],
    ['횟수(2번)를 정해 두세요.', []],
    ['인원수(2명)를 줄여요.', []],
    ['업무 일지를 써 보세요.', []],
    // 리뷰에서 찾은 누락
    ['십신으로 보면 그래요.', ['십신']],
    ['일지 진(辰)이 있어요.', ['일지']],
    ['월지에 흙이 있어요.', ['월지']],
    ['태어난 해의 윗글자 을(乙)은 표현·재능을 뜻하는 글자라, 생각을 드러내는 편이에요.', []],
    ['2026년은 병오(丙午)의 해라, 활동이 늘 수 있어요.', []],
    ['61세(2025년 6월)부터 이어지는 정축(丁丑)의 큰 흐름은 차분한 편이에요.', []],
  ])('%s', (text, expected) => {
    expect(findJargon(text).sort()).toEqual([...expected].sort());
  });
});

describe('D-045: 관계를 사람 관계로 바꾸기·반복되는 풀이 말', () => {
  const chart = buildChart(SAMPLE_INPUTS[0]!, { referenceYear: SAMPLE_REFERENCE_YEAR });
  const evidence = buildEvidence(chart);
  const rules = prepareRules({ evidence, forbidden: [], maxChars: 120 });
  const rel = evidence.find((e) => e.kind === 'relation')!;
  const codes = (text: string, ids: string[]) => validateSentence({ text, evidenceIds: ids }, 's', rules).map((v) => v.code);

  it('합·충 근거를 인용하고 사람과의 관계로 풀면 거부, 다른 근거면 대상이 아니다', () => {
    expect(codes('두 글자가 서로 묶이는 관계라, 부모와 가까이 붙어 지내는 편이에요.', [rel.id])).toContain('relationAsPerson');
    expect(codes('두 글자가 서로 묶이는 관계라, 서로 힘을 보태는 흐름으로 볼 수 있어요.', [rel.id])).not.toContain('relationAsPerson');
    expect(codes('가족과 함께하는 시간을 넉넉히 두면 좋아요.', ['dayMaster'])).not.toContain('relationAsPerson');
  });

  it('같은 풀이 말을 3문장 이상 쓰면 마지막 문장 쪽 위반, 템플릿 문장도 함께 센다', () => {
    const s = (texts: string[]) => texts.map((text, i) => ({ path: `p[${i}]`, text }));
    expect(validateRepetition(s(['약속을 지켜요.', '약속이 중요해요.']))).toEqual([]);
    const v = validateRepetition(s(['약속을 지켜요.', '약속이 중요해요.', '약속은 가볍게 정해요.']));
    expect(v.map((x) => [x.code, x.path])).toEqual([['repeatedWord', 'p[2]']]);
    expect(validateRepetition(s(['여유를 두세요.', '여유 있게 움직여요.']), ['쉬어 가는 여유를 두면 좋아요.'])).toHaveLength(1);
  });
});

describe('D-046: 행동으로 잇는 합·충, 사회 활동, 묶음 이름, 앞 문장 의존', () => {
  const chart = buildChart(SAMPLE_INPUTS[0]!, { referenceYear: SAMPLE_REFERENCE_YEAR });
  const evidence = buildEvidence(chart);
  const rules = prepareRules({ evidence, forbidden: [], maxChars: 120 });
  const rel = evidence.find((e) => e.kind === 'relation')!;
  const codes = (text: string, ids: string[]) => validateSentence({ text, evidenceIds: ids }, 's', rules).map((v) => v.code);

  it('합·충 근거를 인용한 문장이 행동 제안으로 끝나면 거부, 모습·경향이면 통과', () => {
    expect(codes('두 글자가 서로 묶이는 관계라, 두 가지 역할을 이어 보는 시도를 해 보세요.', [rel.id])).toContain('relationAsAdvice');
    expect(codes('두 글자가 서로 부딪치는 관계라, 마음이 두 갈래로 갈릴 수 있어요.', [rel.id])).not.toContain('relationAsAdvice');
    expect(codes('하루 일정을 적어 보세요.', ['dayMaster'])).not.toContain('relationAsAdvice');
  });

  it('태어난 달 근거 + "사회 활동"은 거부, 다른 근거면 대상이 아니다', () => {
    expect(codes('사회 활동에서도 내 생각을 드러내는 편이에요.', ['tenGod.month.stem'])).toContain('positionMeaning');
    expect(codes('사회 활동이 늘어나는 해로 볼 수 있어요.', ['seun[0]'])).not.toContain('positionMeaning');
  });

  it('"~을 뜻하는 글자" 앞이 다섯 묶음 이름이 아니면 거부(가운뎃점 앞뒤 띄어쓰기는 같게 본다)', () => {
    expect(codes('묘(卯)는 하루 일과와 반복되는 순서를 뜻하는 글자라, 순서를 좋아해요.', ['tenGod.year.branch'])).toContain('groupLabel');
    expect(codes('묘(卯)는 규칙·책임을 뜻하는 글자라, 순서를 좋아해요.', ['tenGod.year.branch'])).not.toContain('groupLabel');
    expect(codes('묘(卯)는 규칙 · 책임을 뜻하는 글자라, 순서를 좋아해요.', ['tenGod.year.branch'])).not.toContain('groupLabel');
  });

  it('앞 문장에 기대는 표현은 standalone 위반(첫머리·문장 안)', () => {
    const v = (t: string) => validateStandalone([{ path: 'p', text: t }]).map((x) => x.code);
    expect(v('그래서 큰 지출을 정하기 전에 몫을 나눠 두면 좋아요.')).toEqual(['dependentSentence']);
    expect(v('이 시기에는 이미 해 온 일을 다지는 편이에요.')).toEqual(['dependentSentence']);
    expect(v('을(乙)도 같은 뜻의 글자라 순서를 좋아해요.')).toEqual(['dependentSentence']);
    expect(v('앞 시기에 이어 쇠의 기운이 계속 들어와요.')).toEqual(['dependentSentence']);
    expect(v('이시기 같은 말은 없어요.')).toEqual([]);
    expect(v('갑자(甲子)의 흐름에서는 호기심이 자라는 편이에요.')).toEqual([]);
    expect(v('이런저런 일이 생길 수 있어요.')).toEqual([]);
  });
});

describe('D-046 리뷰: 묶음 이름 규칙의 허용', () => {
  const chart = buildChart(SAMPLE_INPUTS[0]!, { referenceYear: SAMPLE_REFERENCE_YEAR });
  const rules = prepareRules({ evidence: buildEvidence(chart), forbidden: [], maxChars: 120 });
  const codes = (text: string) => validateSentence({ text, evidenceIds: ['tenGod.year.stem'] }, 's', rules).map((v) => v.code);
  it('오행 이름·따옴표는 허용한다', () => {
    expect(codes('을(乙)은 나무의 기운을 뜻하는 글자예요.')).not.toContain('groupLabel');
    expect(codes('을(乙)은 ‘표현·재능’을 뜻하는 글자예요.')).not.toContain('groupLabel');
  });
});
