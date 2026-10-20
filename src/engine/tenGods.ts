// 십신: 일간과 대상 천간의 오행 생극 관계 + 음양 일치 여부로 정한다. 지지는 본기 천간으로 본다.
import { BRANCH_MAIN_STEM, ELEMENTS, STEM_ELEMENTS, stemYinYang } from './constants';
import type { PillarPosition, PillarSet, TenGod, TenGodEntry } from './types';

/** 오행 순서 목→화→토→금→수에서 대상이 일간으로부터 몇 칸 떨어졌는지 (생: +1, 극: +2) */
function elementStep(dayStem: number, targetStem: number): number {
  const a = ELEMENTS.indexOf(STEM_ELEMENTS[dayStem]!);
  const b = ELEMENTS.indexOf(STEM_ELEMENTS[targetStem]!);
  return (b - a + 5) % 5;
}

const BY_STEP: readonly (readonly [TenGod, TenGod])[] = [
  ['bigyeon', 'geobjae'], // 같은 오행
  ['siksin', 'sanggwan'], // 일간이 생함
  ['pyeonjae', 'jeongjae'], // 일간이 극함
  ['pyeongwan', 'jeonggwan'], // 일간을 극함
  ['pyeonin', 'jeongin'], // 일간을 생함
];

export function tenGodOfStem(dayStem: number, targetStem: number): TenGod {
  const pair = BY_STEP[elementStep(dayStem, targetStem)]!;
  const samePolarity = stemYinYang(dayStem) === stemYinYang(targetStem);
  return samePolarity ? pair[0] : pair[1];
}

export function tenGodOfBranch(dayStem: number, branch: number): TenGod {
  return tenGodOfStem(dayStem, BRANCH_MAIN_STEM[branch]!);
}

/** 일간 자신을 뺀 모든 글자의 십신 */
export function computeTenGods(p: PillarSet): TenGodEntry[] {
  const dayStem = p.day.stem;
  const positions: PillarPosition[] = ['year', 'month', 'day', 'hour'];
  return positions.flatMap((position) => {
    const pillar = p[position];
    if (!pillar) return [];
    const stemEntry: TenGodEntry[] =
      position === 'day' ? [] : [{ position, part: 'stem', tenGod: tenGodOfStem(dayStem, pillar.stem) }];
    return [...stemEntry, { position, part: 'branch', tenGod: tenGodOfBranch(dayStem, pillar.branch) }];
  });
}
