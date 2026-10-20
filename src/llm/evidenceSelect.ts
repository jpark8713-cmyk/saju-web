// 호출마다 넘길 근거를 고른다. 주제 호출은 주제 설정의 근거만 넘겨 비용을 줄이고 풀이 범위를 좁힌다.
import { TEN_GOD_GROUPS } from '../engine/constants';
import type { Evidence, SajuChart } from '../engine/types';
import type { TopicConfig } from '../config/topics';

/** 모든 주제에 공통으로 넘기는 근거 */
function isCommon(e: Evidence): boolean {
  return (
    e.id === 'dayMaster' ||
    e.kind === 'elementBalance' ||
    e.kind === 'daewoonDirection' ||
    e.kind === 'daewoon' ||
    e.kind === 'seun'
  );
}

export function topicEvidence(topic: TopicConfig, chart: SajuChart, evidence: readonly Evidence[]): Evidence[] {
  const groupMembers = new Set<string>(
    TEN_GOD_GROUPS.filter((g) => topic.evidence.tenGodGroups.includes(g.id)).flatMap((g) => [...g.members]),
  );
  const tenGodIds = new Set(
    chart.tenGods.filter((t) => groupMembers.has(t.tenGod)).map((t) => `tenGod.${t.position}.${t.part}`),
  );
  const groupIds = new Set(topic.evidence.tenGodGroups.map((g) => `tenGodGroup.${g}`));
  const explicit = new Set(topic.evidence.ids);
  const touching = new Set<string>(topic.evidence.relationsTouching);
  return evidence.filter(
    (e) =>
      isCommon(e) ||
      groupIds.has(e.id) ||
      tenGodIds.has(e.id) ||
      explicit.has(e.id) ||
      (e.kind === 'relation' && e.chartRefs.some((r) => touching.has(r))),
  );
}

/**
 * 대운 해설 대상: 기준 연도 7월 1일이 속한 대운과 그다음 대운.
 * 연중에 대운이 바뀌는 해는 그해 절반 이상을 차지하는 대운을 "현재"로 본다(Docs/decisions.md D-015).
 * 아직 첫 대운 전이면 첫 대운부터, 마지막 대운이면 마지막 두 개.
 */
export function targetDaewoonIndices(chart: SajuChart, referenceYear: number, count: number): number[] {
  const list = chart.daewoon;
  const midYear = referenceYear * 12 + 6; // 7월 (월은 0부터)
  const current = list.findLastIndex((d) => d.startYear * 12 + (d.startMonth - 1) <= midYear);
  const start = Math.min(Math.max(current, 0), Math.max(list.length - count, 0));
  return list.slice(start, start + count).map((d) => d.index);
}
