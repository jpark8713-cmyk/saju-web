// 원국 안의 합·충. 학파 차이가 적은 천간합·천간충·지지 육합·지지 충·지지 삼합(세 글자 모두 있을 때)만 다룬다.
// 형·파·해, 반합, 대운·세운과의 관계는 아직 다루지 않는다(Docs/decisions.md D-009).
import type { ChartRef, Element, PillarPosition, PillarSet, Relation } from './types';

/** 천간합: 갑기토, 을경금, 병신수, 정임목, 무계화 */
const STEM_COMBINE: readonly [number, number, Element][] = [
  [0, 5, 'earth'], [1, 6, 'metal'], [2, 7, 'water'], [3, 8, 'wood'], [4, 9, 'fire'],
];
/** 천간충: 갑경, 을신, 병임, 정계 */
const STEM_CLASH: readonly [number, number][] = [[0, 6], [1, 7], [2, 8], [3, 9]];
/** 지지 육합: 자축토, 인해목, 묘술화, 진유금, 사신수, 오미(화로 본다) */
const BRANCH_SIX_COMBINE: readonly [number, number, Element][] = [
  [0, 1, 'earth'], [2, 11, 'wood'], [3, 10, 'fire'], [4, 9, 'metal'], [5, 8, 'water'], [6, 7, 'fire'],
];
/** 지지 삼합: 신자진수, 해묘미목, 인오술화, 사유축금 */
const BRANCH_TRIPLE: readonly [number, number, number, Element][] = [
  [8, 0, 4, 'water'], [11, 3, 7, 'wood'], [2, 6, 10, 'fire'], [5, 9, 1, 'metal'],
];

interface Slot {
  ref: ChartRef;
  value: number;
}

function slots(p: PillarSet, part: 'stem' | 'branch'): Slot[] {
  const positions: PillarPosition[] = ['year', 'month', 'day', 'hour'];
  return positions.flatMap((pos) => {
    const pillar = p[pos];
    return pillar ? [{ ref: `${pos}.${part}` as ChartRef, value: pillar[part] }] : [];
  });
}

function pairs(list: Slot[]): [Slot, Slot][] {
  return list.flatMap((a, i) => list.slice(i + 1).map((b): [Slot, Slot] => [a, b]));
}

function matchPair(a: number, b: number, x: number, y: number): boolean {
  return (a === x && b === y) || (a === y && b === x);
}

function pairRelations(p: PillarSet): Relation[] {
  const stemPairs = pairs(slots(p, 'stem'));
  const branchPairs = pairs(slots(p, 'branch'));
  const stemCombine = stemPairs.flatMap(([a, b]) =>
    STEM_COMBINE.filter(([x, y]) => matchPair(a.value, b.value, x, y)).map(
      ([, , el]): Relation => ({ kind: 'stemCombine', refs: [a.ref, b.ref], resultElement: el }),
    ),
  );
  const stemClash = stemPairs.flatMap(([a, b]) =>
    STEM_CLASH.some(([x, y]) => matchPair(a.value, b.value, x, y))
      ? [{ kind: 'stemClash', refs: [a.ref, b.ref] } as Relation]
      : [],
  );
  const sixCombine = branchPairs.flatMap(([a, b]) =>
    BRANCH_SIX_COMBINE.filter(([x, y]) => matchPair(a.value, b.value, x, y)).map(
      ([, , el]): Relation => ({ kind: 'branchSixCombine', refs: [a.ref, b.ref], resultElement: el }),
    ),
  );
  const branchClash = branchPairs.flatMap(([a, b]) =>
    Math.abs(a.value - b.value) === 6 ? [{ kind: 'branchClash', refs: [a.ref, b.ref] } as Relation] : [],
  );
  return [...stemCombine, ...stemClash, ...sixCombine, ...branchClash];
}

function tripleRelations(p: PillarSet): Relation[] {
  const branches = slots(p, 'branch');
  return BRANCH_TRIPLE.flatMap(([a, b, c, el]) => {
    const members = [a, b, c].map((v) => branches.find((s) => s.value === v));
    if (members.some((m) => !m)) return [];
    return [{ kind: 'branchTripleCombine', refs: members.map((m) => m!.ref), resultElement: el } as Relation];
  });
}

export function computeRelations(p: PillarSet): Relation[] {
  return [...pairRelations(p), ...tripleRelations(p)];
}
