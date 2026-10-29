// 화면·PDF용 사주 차트 데이터. 계산 결과(SajuChart)를 그대로 옮기기만 한다(AI는 관여하지 않는다).
import {
  BRANCHES_HANJA, BRANCHES_KO, BRANCH_ELEMENTS, ELEMENTS, ELEMENT_HANJA, ELEMENT_KO, POSITION_KO, STEMS_HANJA, STEMS_KO,
  STEM_ELEMENTS, TEN_GOD_KO, pillarLabel,
} from '../engine/constants';
import { daewoonStartLabel } from '../engine/daewoon';
import type { ChartRef, Element, PillarPosition, SajuChart } from '../engine/types';

export interface Glyph {
  ko: string;
  hanja: string;
  element: Element;
  elementKo: string;
}

export interface PillarCell {
  position: PillarPosition;
  title: string;
  /** 시간 모름이면 null */
  stem: (Glyph & { ref: ChartRef; tenGod: string }) | null;
  branch: (Glyph & { ref: ChartRef; tenGod: string }) | null;
}

export interface ChartView {
  hasTime: boolean;
  /** 화면 순서: 시주 · 일주 · 월주 · 년주 */
  pillars: PillarCell[];
  elements: { element: Element; ko: string; hanja: string; count: number; ref: ChartRef }[];
  elementTotal: number;
  daewoon: { index: number; label: string; startLabel: string; ref: ChartRef }[];
  seun: { index: number; year: number; label: string; ref: ChartRef }[];
}

const ORDER: PillarPosition[] = ['hour', 'day', 'month', 'year'];

function tenGodOf(chart: SajuChart, position: PillarPosition, part: 'stem' | 'branch'): string {
  if (position === 'day' && part === 'stem') return '일간';
  const t = chart.tenGods.find((x) => x.position === position && x.part === part);
  return t ? TEN_GOD_KO[t.tenGod] : '';
}

export function buildChartView(chart: SajuChart): ChartView {
  const pillars = ORDER.map((position): PillarCell => {
    const p = chart.pillars[position];
    const title = position === 'day' ? '일주 (나)' : POSITION_KO[position];
    if (!p) return { position, title, stem: null, branch: null };
    const stemEl = STEM_ELEMENTS[p.stem]!;
    const branchEl = BRANCH_ELEMENTS[p.branch]!;
    return {
      position,
      title,
      stem: {
        ko: STEMS_KO[p.stem]!, hanja: STEMS_HANJA[p.stem]!, element: stemEl, elementKo: ELEMENT_KO[stemEl],
        ref: `${position}.stem`, tenGod: tenGodOf(chart, position, 'stem'),
      },
      branch: {
        ko: BRANCHES_KO[p.branch]!, hanja: BRANCHES_HANJA[p.branch]!, element: branchEl, elementKo: ELEMENT_KO[branchEl],
        ref: `${position}.branch`, tenGod: tenGodOf(chart, position, 'branch'),
      },
    };
  });
  return {
    hasTime: chart.input.hasTime,
    pillars,
    elements: ELEMENTS.map((element) => ({
      element, ko: ELEMENT_KO[element], hanja: ELEMENT_HANJA[element], count: chart.elements.counts[element], ref: `elements.${element}` as ChartRef,
    })),
    elementTotal: chart.elements.total,
    daewoon: chart.daewoon.map((d) => ({ index: d.index, label: pillarLabel(d.pillar), startLabel: daewoonStartLabel(d, chart.solarDate), ref: `daewoon[${d.index}]` as ChartRef })),
    seun: chart.seun.map((s, i) => ({ index: i, year: s.year, label: pillarLabel(s.pillar), ref: `seun[${i}]` as ChartRef })),
  };
}
