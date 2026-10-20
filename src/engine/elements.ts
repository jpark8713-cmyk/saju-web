// 오행 분포: 원국에 드러난 글자(천간·지지)를 한 글자씩 센다. 지장간 가중치는 쓰지 않는다(Docs/decisions.md D-008).
import { BRANCH_ELEMENTS, STEM_ELEMENTS } from './constants';
import type { Element, ElementDistribution, Pillar, PillarSet } from './types';

export function computeElements(p: PillarSet): ElementDistribution {
  const pillars = [p.year, p.month, p.day, p.hour].filter((x): x is Pillar => x !== null);
  const chars: Element[] = pillars.flatMap((x) => [STEM_ELEMENTS[x.stem]!, BRANCH_ELEMENTS[x.branch]!]);
  const counts: Record<Element, number> = { wood: 0, fire: 0, earth: 0, metal: 0, water: 0 };
  const filled = chars.reduce((acc, el) => ({ ...acc, [el]: acc[el] + 1 }), counts);
  return { counts: filled, total: chars.length };
}
