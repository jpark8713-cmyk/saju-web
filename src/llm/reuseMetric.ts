// 근거 반복 지표 (근거 반복 줄이기 C, D-023). 측정 스크립트와 이전 결과 분석이 같은 함수를 쓴다.
// - 대상 칸: 총평(템플릿 문장 제외), 성향, 주제별, 대운, 올해·내년
// - 대운·세운 근거(daewoon*, seun*)는 원래 해당 칸 전용이라 세지 않는다
import { REPORT_LAYOUT } from '../config/report';
import type { ReportBody, ReportSentence } from './types';

export interface ReuseStats {
  /** 한 번 이상 인용된 근거 수 */
  citedIds: number;
  /** 3개 이상 칸에서 인용된 근거 수 */
  idsIn3PlusSections: number;
  /** 근거 하나가 인용된 칸 수의 합 (평균 = sectionSum / citedIds) */
  sectionSum: number;
  /** dayMaster가 인용된 칸 수 (템플릿 제외) */
  dayMasterSections: number;
}

function sections(body: ReportBody): Record<string, readonly ReportSentence[]> {
  return {
    summary: body.summary.slice(REPORT_LAYOUT.summaryTemplateSentences),
    traits: body.traits,
    ...Object.fromEntries(Object.entries(body.topics).map(([k, v]) => [`topic:${k}`, v])),
    daewoon: body.daewoonNotes.flatMap((n) => n.sentences),
    yearly: [...body.yearly.thisYear, ...body.yearly.nextYear],
  };
}

export function evidenceReuse(body: ReportBody): ReuseStats {
  const usedIn = new Map<string, Set<string>>();
  for (const [sec, list] of Object.entries(sections(body))) {
    for (const s of list) {
      for (const id of s.evidenceIds) {
        if (id.startsWith('daewoon') || id.startsWith('seun')) continue;
        const set = usedIn.get(id) ?? new Set<string>();
        set.add(sec);
        usedIn.set(id, set);
      }
    }
  }
  const counts = [...usedIn.values()].map((v) => v.size);
  return {
    citedIds: counts.length,
    idsIn3PlusSections: counts.filter((n) => n >= 3).length,
    sectionSum: counts.reduce((a, b) => a + b, 0),
    dayMasterSections: usedIn.get('dayMaster')?.size ?? 0,
  };
}

/** 여러 리포트의 지표를 합친다 */
export function sumReuse(list: readonly ReuseStats[]): ReuseStats & { avgSectionsPerId: number } {
  const total = list.reduce(
    (a, b) => ({
      citedIds: a.citedIds + b.citedIds,
      idsIn3PlusSections: a.idsIn3PlusSections + b.idsIn3PlusSections,
      sectionSum: a.sectionSum + b.sectionSum,
      dayMasterSections: a.dayMasterSections + b.dayMasterSections,
    }),
    { citedIds: 0, idsIn3PlusSections: 0, sectionSum: 0, dayMasterSections: 0 },
  );
  return { ...total, avgSectionsPerId: total.citedIds ? Number((total.sectionSum / total.citedIds).toFixed(2)) : 0 };
}
