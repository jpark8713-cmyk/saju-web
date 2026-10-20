// 간지·오행 기본표. 명리학에서 학파 차이가 없는 표만 둔다.
import type { Element, Pillar, TenGod, YinYang } from './types';

export const STEMS_KO = ['갑', '을', '병', '정', '무', '기', '경', '신', '임', '계'] as const;
export const STEMS_HANJA = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'] as const;
export const BRANCHES_KO = ['자', '축', '인', '묘', '진', '사', '오', '미', '신', '유', '술', '해'] as const;
export const BRANCHES_HANJA = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'] as const;

export const STEM_ELEMENTS: readonly Element[] = [
  'wood', 'wood', 'fire', 'fire', 'earth', 'earth', 'metal', 'metal', 'water', 'water',
];
export const BRANCH_ELEMENTS: readonly Element[] = [
  'water', 'earth', 'wood', 'wood', 'earth', 'fire', 'fire', 'earth', 'metal', 'metal', 'earth', 'water',
];

/** 지지의 본기(정기) 천간. 지지 십신 판정에 쓴다 */
export const BRANCH_MAIN_STEM: readonly number[] = [9, 5, 0, 1, 4, 2, 3, 5, 6, 7, 4, 8];

export const ELEMENT_KO: Record<Element, string> = {
  wood: '목', fire: '화', earth: '토', metal: '금', water: '수',
};
export const ELEMENT_HANJA: Record<Element, string> = {
  wood: '木', fire: '火', earth: '土', metal: '金', water: '水',
};
export const ELEMENTS: readonly Element[] = ['wood', 'fire', 'earth', 'metal', 'water'];

export const TEN_GOD_KO: Record<TenGod, string> = {
  bigyeon: '비견', geobjae: '겁재', siksin: '식신', sanggwan: '상관', pyeonjae: '편재',
  jeongjae: '정재', pyeongwan: '편관', jeonggwan: '정관', pyeonin: '편인', jeongin: '정인',
};

export const POSITION_KO = { year: '년주', month: '월주', day: '일주', hour: '시주' } as const;
export const PART_KO = { stem: '천간', branch: '지지' } as const;

export function stemYinYang(stem: number): YinYang {
  return stem % 2 === 0 ? 'yang' : 'yin';
}

export function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

/** 60갑자 순번(0=갑자) → 간지 */
export function pillarFromCycle(index: number): Pillar {
  const i = mod(index, 60);
  return { stem: i % 10, branch: i % 12 };
}

/** 간지 → 60갑자 순번 */
export function cycleIndex(p: Pillar): number {
  for (let i = 0; i < 60; i++) {
    if (i % 10 === p.stem && i % 12 === p.branch) return i;
  }
  throw new Error(`유효하지 않은 간지 조합: ${p.stem}/${p.branch}`);
}

export function pillarKo(p: Pillar): string {
  return `${STEMS_KO[p.stem]}${BRANCHES_KO[p.branch]}`;
}

export function pillarHanja(p: Pillar): string {
  return `${STEMS_HANJA[p.stem]}${BRANCHES_HANJA[p.branch]}`;
}

/** 표시용: 갑자(甲子) */
export function pillarLabel(p: Pillar): string {
  return `${pillarKo(p)}(${pillarHanja(p)})`;
}

export function stemLabel(stem: number): string {
  return `${STEMS_KO[stem]}(${STEMS_HANJA[stem]})`;
}

export function branchLabel(branch: number): string {
  return `${BRANCHES_KO[branch]}(${BRANCHES_HANJA[branch]})`;
}
