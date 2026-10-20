// 총평 첫 문장들: 코드 템플릿으로 만든다(사업자 결정 2026-10-20, Docs/decisions.md D-014).
// 무료 미리보기에 그대로 공개하고, 결제 후 리포트도 같은 문장으로 시작한 뒤 AI가 이어 쓴다.
// 모든 문장에 근거 id를 붙이며, 근거의 chartRefs로 차트 글자를 강조할 수 있다.
import { ELEMENTS, ELEMENT_HANJA, ELEMENT_KO, STEMS_HANJA, STEMS_KO } from '../engine/constants';
import type { Element, SajuChart } from '../engine/types';
import type { ReportSentence } from '../llm/types';

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

function el(e: Element): string {
  return `${ELEMENT_KO[e]}(${ELEMENT_HANJA[e]})`;
}

function josaIGa(e: Element): string {
  // 목·금은 받침이 있어 '이', 화·토·수는 '가'
  return e === 'wood' || e === 'metal' ? '이' : '가';
}

function dayMasterSentence(chart: SajuChart): ReportSentence {
  const stem = chart.pillars.day.stem;
  const element = ELEMENTS[Math.floor(stem / 2)]!;
  const copula = josaIGa(element) === '이' ? '이라' : '라';
  return {
    // 예: 경금(庚金)이라, 병화(丙火)라
    text: `일간이 ${STEMS_KO[stem]}${ELEMENT_KO[element]}(${STEMS_HANJA[stem]}${ELEMENT_HANJA[element]})${copula}, ${DAY_MASTER_IMAGE[stem]}`,
    evidenceIds: ['dayMaster'],
  };
}

function balanceSentence(chart: SajuChart): ReportSentence {
  const { counts, total } = chart.elements;
  const max = Math.max(...ELEMENTS.map((e) => counts[e]));
  const strong = ELEMENTS.filter((e) => counts[e] === max && max >= 3);
  const missing = ELEMENTS.filter((e) => counts[e] === 0);
  const ids = ['elements.summary', ...[...strong, ...missing].map((e) => `elements.${e}`)];

  if (strong.length === 1 && missing.length) {
    const s = strong[0]!;
    return {
      text: `${total}글자 중 ${el(s)}${josaIGa(s)} ${max}개로 많고 ${missing.map(el).join('·')}${josaIGa(missing[missing.length - 1]!)} 없어서, ${WHEN_MISSING[missing[0]!]}을 들이면 균형에 도움이 돼요.`,
      evidenceIds: ids,
    };
  }
  if (strong.length > 1) {
    const last = strong[strong.length - 1]!;
    return {
      text: `${total}글자 중 ${strong.map(el).join('·')}${josaIGa(last)} 각각 ${max}개로 많아, ${WHEN_STRONG[strong[0]!]}`,
      evidenceIds: ids,
    };
  }
  if (strong.length === 1) {
    const s = strong[0]!;
    return { text: `${total}글자 중 ${el(s)}${josaIGa(s)} ${max}개로 두드러져, ${WHEN_STRONG[s]}`, evidenceIds: ids };
  }
  if (missing.length === 1) {
    const m = missing[0]!;
    return {
      text: `다섯 오행 중 ${el(m)}${josaIGa(m)} 없는 구성이라, ${WHEN_MISSING[m]}을 들이면 균형을 잡는 데 도움이 돼요.`,
      evidenceIds: ids,
    };
  }
  if (missing.length > 1) {
    return {
      text: `${missing.map(el).join('·')}${josaIGa(missing[missing.length - 1]!)} 없는 구성이라, ${WHEN_MISSING[missing[0]!]}부터 하나씩 들여 보면 좋아요.`,
      evidenceIds: ids,
    };
  }
  return {
    text: '다섯 오행이 고르게 갖춰진 편이라, 한쪽으로 치우치지 않도록 지금의 생활 리듬을 꾸준히 지키면 좋아요.',
    evidenceIds: ids,
  };
}

/** 총평 템플릿 문장 (무료 공개분) */
export function summaryTemplate(chart: SajuChart): ReportSentence[] {
  return [dayMasterSentence(chart), balanceSentence(chart)];
}
