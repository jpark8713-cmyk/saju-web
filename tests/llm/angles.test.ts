// 풀이 각도(D-047): 사주 해시로 시작, 칸마다 다음 각도, 12세 이하 부분집합, 프롬프트·사실 카드 (가짜 LLM, 실제 호출 없음)
import { describe, expect, it } from 'vitest';
import { REPORT_LAYOUT } from '../../src/config/report';
import { buildChart } from '../../src/engine/chart';
import { buildEvidence } from '../../src/engine/evidence';
import { angleLines, angleOptions, assignAngles, sectionKeys } from '../../src/llm/angles';
import { targetDaewoonIndices } from '../../src/llm/evidenceSelect';
import { generateReport } from '../../src/llm/generate';
import { SAMPLE_AS_OF, SAMPLE_INPUTS, SAMPLE_REFERENCE_YEAR } from '../../src/llm/samples';
import { validateAngleMix, validateConcreteCase } from '../../src/llm/validate';
import { buildReportView } from '../../src/report/view';
import { FakeModerator, FakeTransport, validResponder } from './fakes';

const charts = SAMPLE_INPUTS.map((input) => buildChart(input, { referenceYear: SAMPLE_REFERENCE_YEAR }));
const adult = { child: false, toddler: false };

describe('칸 순서와 각도 배정', () => {
  const sections = sectionKeys(['love', 'wealth'], 2);

  it('칸 순서: 총평 → 성향 → 주제(설정 순서) → 대운 → 올해 → 내년', () => {
    expect(sections).toEqual(['summary', 'traits', 'topic:wealth', 'topic:love', 'daewoon:0', 'daewoon:1', 'thisYear', 'nextYear']);
  });

  it('같은 사주면 늘 같은 각도', () => {
    expect(assignAngles(charts[0]!, adult, sections)).toEqual(assignAngles(buildChart(SAMPLE_INPUTS[0]!, { referenceYear: SAMPLE_REFERENCE_YEAR }), adult, sections));
  });

  it('바로 붙은 두 칸은 같은 기운·묶음이 같은 각도로 나오지 않는다(각도가 둘 이상일 때)', () => {
    for (const chart of charts) {
      const a = assignAngles(chart, adult, sections);
      for (let i = 1; i < sections.length; i++) {
        for (const slot of Object.keys(a.options)) {
          expect(a.bySection[sections[i]!]![slot], `${slot} @ ${sections[i]}`).not.toBe(a.bySection[sections[i - 1]!]![slot]);
        }
      }
    }
  });

  it('시작 각도는 사주마다 퍼진다(샘플 20건에서 흙의 총평 각도가 세 가지 이상)', () => {
    const firsts = new Set(charts.map((c) => assignAngles(c, adult, sections).bySection.summary!.earth));
    expect(firsts.size).toBeGreaterThanOrEqual(3);
  });
});

describe('12세 이하 부분집합', () => {
  const names = (child: boolean, toddler: boolean, slot: string) => angleOptions({ child, toddler })[slot]!.map((a) => a.name);
  it('재물·활동: 직접 움직이기·물건 다루기만', () => {
    expect(names(true, false, 'jaeseong')).toEqual(['직접 움직이기', '물건 다루기']);
  });
  it('표현·재능: 재능을 일로 잇기를 뺀다', () => {
    expect(names(true, false, 'siksang')).not.toContain('재능을 일로 잇기');
    expect(names(true, false, 'siksang')).toHaveLength(5);
  });
  it('D-048 자립·경쟁: 5세 이하는 견주며 힘 얻기를 뺀다(6~12세는 그대로)', () => {
    expect(names(true, true, 'bigeop')).not.toContain('견주며 힘 얻기');
    expect(names(true, true, 'bigeop')).toHaveLength(5);
    expect(names(true, false, 'bigeop')).toContain('견주며 힘 얻기');
  });
  it('규칙·책임: 5세 이하는 꾸준한 순서, 6~12세는 맡은 몫·꾸준한 순서', () => {
    expect(names(true, true, 'gwanseong')).toEqual(['꾸준한 순서']);
    expect(names(true, false, 'gwanseong')).toEqual(['맡은 몫', '꾸준한 순서']);
  });
  it('D-048 어른은 여섯 가지, 기회 알아보기의 장면은 "새 일감을 찾아 나서기"', () => {
    expect(names(false, false, 'jaeseong')).toEqual(['직접 움직이기', '실속 챙기기', '기회 알아보기', '살림·관리', '부지런히 굴리기', '쓸 곳 가리기']);
    for (const [slot, list] of Object.entries(angleOptions(adult))) expect(list, slot).toHaveLength(6);
    expect(angleOptions(adult).jaeseong!.find((a) => a.name === '기회 알아보기')!.scene).toBe('새 일감을 찾아 나서기');
  });
});

describe('프롬프트와 본문', () => {
  const chart = charts[0]!;
  const evidence = buildEvidence(chart);
  const indices = targetDaewoonIndices(chart, SAMPLE_REFERENCE_YEAR, REPORT_LAYOUT.daewoonNoteCount);

  it('기본·주제 호출에 칸별 각도를 넣고, 본문에 각도 기록을 남긴다', async () => {
    const t = new FakeTransport(validResponder(indices));
    const r = await generateReport({ chart, evidence, topicIds: ['wealth'], referenceYear: SAMPLE_REFERENCE_YEAR, transport: t, moderator: new FakeModerator(), asOf: SAMPLE_AS_OF });
    const base = t.requests.find((q) => q.label === 'base')!.user;
    const topic = t.requests.find((q) => q.label === 'topic:wealth')!.user;
    expect(base).toContain('## 칸별 풀이 각도');
    expect(base).toContain('- yearly.nextYear: [오행 표]');
    expect(topic).toContain('- sentences: [오행 표]');
    expect(r.body.angles!.bySection['topic:wealth']).toBeDefined();
    const line = angleLines(r.body.angles!, [{ key: 'thisYear', name: 'x' }]);
    expect(line).toContain(`흙=${r.body.angles!.bySection.thisYear!.earth}`);
  });

  it('사실 카드: 뜻 전체(6가지)와 이 문장의 각도', () => {
    const angles = assignAngles(chart, adult, sectionKeys([], 0));
    const s = [{ text: '흙이 3개라 차분한 해예요.', evidenceIds: ['seun[0]', 'elements.earth'] }];
    const body = { summary: [], traits: [], topics: {}, daewoonNotes: [], yearly: { thisYear: s, nextYear: s }, angles };
    const view = buildReportView({ chart, evidence, body, topicIds: [], name: null, birthLabel: '' });
    const el = view.evidence.find((e) => e.id === 'elements')!;
    expect(el.meanings).toEqual([`흙의 뜻: ${angles.options.earth!.join(' / ')}`]);
    expect(angles.options.earth).toHaveLength(6);
    const thisYear = view.sections.find((x) => x.id === 'yearly')!.groups[0]!.sentences[0]!;
    expect(thisYear.angleNotes![el.n]).toBe(`이 문장은 흙 "${angles.bySection.thisYear!.earth}" 쪽으로 풀었어요.`);
  });

  it('각도 기록이 없는 이전 리포트는 뜻·각도를 보여 주지 않는다', () => {
    const s = [{ text: 'x', evidenceIds: ['elements.earth'] }];
    const view = buildReportView({ chart, evidence, body: { summary: [], traits: [], topics: {}, daewoonNotes: [], yearly: { thisYear: s, nextYear: s } }, topicIds: [], name: null, birthLabel: '' });
    expect(view.evidence.every((e) => e.meanings === undefined)).toBe(true);
    expect(view.sections.find((x) => x.id === 'yearly')!.groups[0]!.sentences[0]!.angleNotes).toBeUndefined();
  });
});

describe('구체 사례·각도 섞기 검사(마지막 시도에서는 봐줌)', () => {
  const v = (fn: typeof validateConcreteCase, t: string) => fn([{ path: 'p', text: t }]).map((x) => x.code);
  it.each(['오래 알고 지낸 사람이나 익숙한 일터에서 힘을 얻어요.', '집이나 일터의 정리부터 해 보세요.', '작업 공간을 정돈해 보세요.'])('구체 사례: %s', (t) => {
    expect(v(validateConcreteCase, t)).toEqual(['concreteCase']);
  });
  it('일반 문장은 구체 사례가 아니다', () => {
    expect(v(validateConcreteCase, '쓰지 않는 물건을 덜어 내 보세요.')).toEqual([]);
  });
  it('한 문장에 두 표의 각도를 섞으면 표시, 한쪽만 쓰면 통과', () => {
    expect(v(validateAngleMix, '흙의 터전처럼 맡은 몫을 끝까지 해내는 편이에요.')).toEqual(['angleMix']);
    expect(v(validateAngleMix, '흙의 기운이 터전을 다지는 쪽으로 힘을 보태요.')).toEqual([]);
    expect(v(validateAngleMix, '규칙·책임을 뜻하는 글자라 맡은 몫을 끝까지 해내는 편이에요.')).toEqual([]);
  });
});

describe('D-047 리뷰: 각도 섞기 검사의 오탐', () => {
  it.each(['주변을 헤아려 받아들이는 편이에요.', '마음이 가라앉을 때 곁을 돌보는 편이에요.', '정돈된 자리에서 실속을 챙겨요.', '어울림 속에서 말과 글로 꺼내요.'])('흔한 말은 걸지 않는다: %s', (t) => {
    expect(validateAngleMix([{ path: 'p', text: t }])).toEqual([]);
  });
});
