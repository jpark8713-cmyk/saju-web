// 총평 첫 문장들: 코드 템플릿으로 만든다(사업자 결정 2026-10-20, Docs/decisions.md D-014).
// 무료 미리보기에 그대로 공개하고, 결제 후 리포트도 같은 문장으로 시작한 뒤 AI가 이어 쓴다.
// 모든 문장에 근거 id를 붙이며, 근거의 chartRefs로 차트 글자를 강조할 수 있다.
// 전문 용어(일간·오행 이름) 대신 쉬운 말로 쓴다(D-042): 나를 나타내는 글자, 나무·불·흙·쇠·물.
import { ELEMENTS, ELEMENT_PLAIN, stemLabel } from '../engine/constants';
import type { Element, SajuChart } from '../engine/types';
import type { ReportSentence } from '../llm/types';
import { hasBatchim, josa } from './evidenceTerms';

/** 일간별 첫 문장 뒷부분 (일간 표기 뒤에 붙는다) */
const DAY_MASTER_IMAGE: readonly string[] = [
  '곧게 자라는 큰 나무처럼 방향을 정하면 꾸준히 밀고 나가는 성향으로 볼 수 있어요.',
  '덩굴과 풀처럼 환경에 맞춰 유연하게 자리를 넓혀 가는 성향으로 볼 수 있어요.',
  '한낮의 해처럼 밝고 드러내는 힘이 있어 주변을 환하게 만드는 성향으로 볼 수 있어요.',
  '등불처럼 은은하게 곁을 밝히며 섬세하게 마음을 쓰는 성향으로 볼 수 있어요.',
  '큰 산처럼 묵직하게 중심을 지키며 믿음을 주는 성향으로 볼 수 있어요.',
  '기름진 밭처럼 사람과 일을 품어 길러 내는 성향으로 볼 수 있어요.',
  '단단한 원석처럼 원칙이 분명하고 결단이 빠른 성향으로 볼 수 있어요.',
  '다듬어진 보석처럼 섬세한 기준으로 완성도를 챙기는 성향으로 볼 수 있어요.',
  '큰 강물처럼 넓게 보고 흐름을 읽어 움직이는 성향으로 볼 수 있어요.',
  '이슬과 빗물처럼 조용히 스며들며 깊이 생각하는 성향으로 볼 수 있어요.',
];

/** 오행이 많을 때(3개 이상) 경향과 행동 제안 */
const WHEN_STRONG: Record<Element, string> = {
  wood: '뻗어 나가려는 힘이 강한 편이니, 시작한 일을 마무리하는 습관을 함께 챙기면 좋아요.',
  fire: '표현과 열정이 앞서는 편이니, 중요한 결정 전에는 한 번 쉬어 가는 여유를 두면 좋아요.',
  earth: '지키고 버티는 힘이 큰 편이니, 가끔은 새로운 시도로 흐름을 바꿔 보면 좋아요.',
  metal: '원칙과 결단이 분명한 편이니, 주변 의견을 한 번 더 들어 보면 균형이 잡혀요.',
  water: '생각이 깊고 유연한 편이니, 떠오른 생각을 작은 행동으로 옮겨 보면 좋아요.',
};

/** 오행이 없을 때 채우는 방향 */
const WHEN_MISSING: Record<Element, string> = {
  wood: '작은 목표를 정해 꾸준히 이어 가는 습관',
  fire: '생각을 말이나 글로 꺼내 보는 연습',
  earth: '생활 리듬을 일정하게 지키는 습관',
  metal: '할 일의 우선순위를 적어 정리하는 습관',
  water: '하루에 잠깐이라도 생각을 비우는 시간',
};

/** 아이 리포트(만 13세 미만, D-044): 부모가 곁에서 도와줄 일로 쓴다 */
const CHILD_WHEN_STRONG: Record<Element, string> = {
  wood: '뻗어 나가려는 힘이 강한 편이니, 시작한 놀이를 끝까지 마무리해 보도록 곁에서 응원해 주면 좋아요.',
  fire: '표현과 열정이 앞서는 편이니, 들뜬 마음을 가라앉힐 수 있게 쉬는 시간을 함께 챙겨 주면 좋아요.',
  earth: '지키고 버티는 힘이 큰 편이니, 가끔은 새로운 놀이나 장소를 함께 경험하게 해 주면 좋아요.',
  metal: '자기 뜻이 분명한 편이니, 아이의 생각을 먼저 들어 준 뒤 함께 방법을 찾아 주면 좋아요.',
  water: '생각이 깊고 조심스러운 편이니, 떠올린 생각을 작은 행동으로 옮길 때까지 기다려 주면 좋아요.',
};

const CHILD_WHEN_MISSING: Record<Element, string> = {
  wood: '작은 일을 끝까지 해 보는 습관',
  fire: '느낀 것을 말이나 그림으로 꺼내 보는 습관',
  earth: '먹고 자는 시간을 일정하게 지키는 습관',
  metal: '쓴 물건을 제자리에 두는 습관',
  water: '조용히 쉬며 마음을 가라앉히는 습관',
};

/** 기운 이름 목록 + 조사 (예: 흙이, 나무·쇠가) */
function names(els: readonly Element[], kind: '이/가' | '은/는'): string {
  return josa(els.map((e) => ELEMENT_PLAIN[e]).join('·'), kind);
}

function dayMasterSentence(chart: SajuChart, child: boolean): ReportSentence {
  const stem = chart.pillars.day.stem;
  const element = ELEMENTS[Math.floor(stem / 2)]!;
  const glyph = stemLabel(stem);
  return {
    // 예: 나를 나타내는 글자가 물의 기운인 임(壬)이라, / 불의 기운인 정(丁)이라,
    // 아이 리포트는 부모가 읽으므로 "아이를 나타내는 글자"로 쓴다(D-045)
    text: `${child ? '아이를' : '나를'} 나타내는 글자가 ${ELEMENT_PLAIN[element]}의 기운인 ${glyph}${hasBatchim(glyph) ? '이라' : '라'}, ${DAY_MASTER_IMAGE[stem]}`,
    evidenceIds: ['dayMaster'],
  };
}

function balanceSentence(chart: SajuChart, child: boolean): ReportSentence {
  const { counts, total } = chart.elements;
  const max = Math.max(...ELEMENTS.map((e) => counts[e]));
  const strong = ELEMENTS.filter((e) => counts[e] === max && max >= 3);
  const missing = ELEMENTS.filter((e) => counts[e] === 0);
  const ids = ['elements.summary', ...[...strong, ...missing].map((e) => `elements.${e}`)];
  const whenStrong = child ? CHILD_WHEN_STRONG : WHEN_STRONG;
  // 아이 리포트는 "아이가 ~을 들이도록 곁에서 도와주면"으로 부모에게 말한다
  const build = (habit: string, tail: string) => (child ? `아이가 ${habit}을 들이도록 곁에서 도와주면 ${tail}` : `${habit}을 들이면 ${tail}`);

  if (strong.length === 1 && missing.length) {
    const s = strong[0]!;
    const habit = (child ? CHILD_WHEN_MISSING : WHEN_MISSING)[missing[0]!];
    return {
      text: `${total}글자 중 ${names([s], '이/가')} ${max}개로 많고 ${names(missing, '이/가')} 없어서, ${build(habit, '균형에 도움이 돼요.')}`,
      evidenceIds: ids,
    };
  }
  if (strong.length > 1) {
    return {
      text: `${total}글자 중 ${names(strong, '이/가')} 각각 ${max}개로 많아, ${whenStrong[strong[0]!]}`,
      evidenceIds: ids,
    };
  }
  if (strong.length === 1) {
    const s = strong[0]!;
    return { text: `${total}글자 중 ${names([s], '이/가')} ${max}개로 두드러져, ${whenStrong[s]}`, evidenceIds: ids };
  }
  if (missing.length === 1) {
    const m = missing[0]!;
    const habit = (child ? CHILD_WHEN_MISSING : WHEN_MISSING)[m];
    return {
      text: `다섯 기운 중 ${names([m], '이/가')} 없는 구성이라, ${build(habit, '균형을 잡는 데 도움이 돼요.')}`,
      evidenceIds: ids,
    };
  }
  if (missing.length > 1) {
    const habit = (child ? CHILD_WHEN_MISSING : WHEN_MISSING)[missing[0]!];
    return {
      text: child
        ? `${names(missing, '이/가')} 없는 구성이라, 아이가 ${habit}부터 하나씩 들이도록 곁에서 도와주면 좋아요.`
        : `${names(missing, '이/가')} 없는 구성이라, ${habit}부터 하나씩 들여 보면 좋아요.`,
      evidenceIds: ids,
    };
  }
  return {
    text: child
      ? '다섯 기운이 고르게 갖춰진 편이라, 한쪽으로 치우치지 않도록 아이의 지금 생활 리듬을 꾸준히 지켜 주면 좋아요.'
      : '다섯 기운이 고르게 갖춰진 편이라, 한쪽으로 치우치지 않도록 지금의 생활 리듬을 꾸준히 지키면 좋아요.',
    evidenceIds: ids,
  };
}

/** 총평 템플릿 문장 (무료 공개분). child: 만 13세 미만 아이 리포트(audience.ts의 isChildChart) */
export function summaryTemplate(chart: SajuChart, opts: { child?: boolean } = {}): ReportSentence[] {
  return [dayMasterSentence(chart, opts.child ?? false), balanceSentence(chart, opts.child ?? false)];
}
