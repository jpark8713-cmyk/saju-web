// 풀이 각도 고르기 (D-047). 서버 전용(node:crypto).
// 사주 8글자(시간 모름이면 6글자)와 기운·묶음 이름을 SHA-256으로 섞어 시작 각도를 정하고,
// 같은 리포트 안에서는 칸이 넘어갈 때마다 다음 각도로 돌린다. 그래서 바로 붙은 두 칸에서 같은 기운이 같은 각도로 나오지 않는다
// (각도가 하나뿐인 경우만 예외: 만 5세 이하의 규칙·책임).
import { createHash } from 'node:crypto';
import { TOPICS, type TenGodGroupId } from '../config/topics';
import { ELEMENTS, ELEMENT_PLAIN, TEN_GOD_GROUPS } from '../engine/constants';
import type { SajuChart } from '../engine/types';
import { ELEMENT_ANGLES, GROUP_ANGLES, RELATION_ANGLES, childGroupAngles, type Angle, type ReportAngles } from '../report/angleTable';
import type { Audience } from '../report/audience';

const GROUP_IDS = TEN_GOD_GROUPS.map((g) => g.id as TenGodGroupId);

/** 칸 순서: 총평 → 타고난 성향 → 주제(고른 것만, 주제 설정 순서) → 대운(리포트에 나온 순서) → 올해 → 내년 */
export function sectionKeys(topicIds: readonly string[], daewoonCount: number): string[] {
  return [
    'summary',
    'traits',
    ...TOPICS.filter((t) => topicIds.includes(t.id)).map((t) => `topic:${t.id}`),
    ...Array.from({ length: daewoonCount }, (_, i) => `daewoon:${i}`),
    'thisYear',
    'nextYear',
  ];
}

function chartKey(chart: SajuChart): string {
  return (['year', 'month', 'day', 'hour'] as const)
    .map((p) => {
      const x = chart.pillars[p];
      return x ? `${x.stem}-${x.branch}` : 'x';
    })
    .join('|');
}

function startIndex(chart: SajuChart, slot: string, n: number): number {
  return createHash('sha256').update(`${slot}#${chartKey(chart)}`).digest().readUInt32BE(0) % n;
}

/** 슬롯(기운 5 + 묶음 5 + 관계 2)별로 이 리포트에서 쓸 수 있는 각도. 12세 이하는 묶음 부분집합 */
export function angleOptions(audience: Pick<Audience, 'child' | 'toddler'>): Record<string, readonly Angle[]> {
  return {
    ...Object.fromEntries(ELEMENTS.map((el) => [el, ELEMENT_ANGLES[el]])),
    ...Object.fromEntries(GROUP_IDS.map((g) => [g, audience.child ? childGroupAngles(g, audience.toddler) : GROUP_ANGLES[g]])),
    combine: RELATION_ANGLES.combine,
    clash: RELATION_ANGLES.clash,
  };
}

/** 칸마다 기운·묶음별 각도를 정한다. 같은 사주·같은 칸 구성이면 늘 같다 */
export function assignAngles(chart: SajuChart, audience: Pick<Audience, 'child' | 'toddler'>, sections: readonly string[]): ReportAngles {
  const options = angleOptions(audience);
  const bySection: Record<string, Record<string, string>> = {};
  for (const [i, sec] of sections.entries()) {
    bySection[sec] = Object.fromEntries(
      Object.entries(options).map(([slot, list]) => [slot, list[(startIndex(chart, slot, list.length) + i) % list.length]!.name]),
    );
  }
  return { bySection, options: Object.fromEntries(Object.entries(options).map(([slot, list]) => [slot, list.map((a) => a.name)])) };
}

/** 관계 슬롯의 쉬운 이름 */
const RELATION_SLOT_LABEL: Record<string, string> = { combine: '묶이는 관계', clash: '부딪치는 관계' };

/** 슬롯의 쉬운 이름(흙, 규칙·책임, 묶이는 관계) */
export function slotLabel(slot: string): string {
  const el = ELEMENTS.find((e) => e === slot);
  if (el) return ELEMENT_PLAIN[el];
  return TEN_GOD_GROUPS.find((g) => g.id === slot)?.plain ?? RELATION_SLOT_LABEL[slot] ?? slot;
}

/**
 * 프롬프트에 넣을 칸별 각도 안내. sections: 이 호출이 쓰는 칸 키와 그 칸을 부르는 이름.
 * D-048: 각도마다 붙여 주던 생활 장면 문구는 넣지 않는다. 모델이 그 문구를 그대로 옮겨 같은 각도를 받은 리포트끼리 문장이 겹쳤다.
 */
export function angleLines(angles: ReportAngles, sections: readonly { key: string; name: string }[]): string {
  const rows = sections.map(({ key, name }) => {
    const m = angles.bySection[key] ?? {};
    const els = ELEMENTS.map((el) => `${ELEMENT_PLAIN[el]}=${m[el]}`);
    const grs = GROUP_IDS.map((g) => `${slotLabel(g)}=${m[g]}`);
    const rel = (['combine', 'clash'] as const).map((r) => `${slotLabel(r)}=${m[r]}`);
    return `- ${name}: [오행 표] ${els.join(', ')} / [묶음 표] ${grs.join(', ')} / [관계 표] ${rel.join(', ')}`;
  });
  return [
    '## 칸별 풀이 각도',
    '이 칸에서 그 기운·묶음·관계를 풀 때 아래 각도가 가리키는 쪽으로 풉니다. 각도는 방향만 알려 줍니다. 각도 이름을 문장에 그대로 옮기지 않고, 이 사람의 글자·개수·관계와 엮어 새 말로 씁니다.',
    '[오행 표]는 기운 개수·대운 문장에, [묶음 표]는 "~을 뜻하는 글자" 문장(올해·내년 칸에서 그해 글자의 뜻을 말하는 문장 포함)에, [관계 표]는 서로 묶이는·부딪치는 관계를 말하는 문장에만 씁니다. 한 문장에 두 표의 각도를 섞지 않습니다.',
    ...rows,
  ].join('\n');
}
