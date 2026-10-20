// 풀이 주제 목록. 주제를 추가할 때는 이 배열에 항목만 더한다(화면 체크박스·프롬프트·검증이 이 목록을 쓴다).
// 새 주제는 샘플 풀이 3~5개를 사람이 검수한 뒤 enabled를 켠다(SPEC Phase 2, Docs/decisions.md D-016).
import type { ChartRef } from '../engine/types';

export type TenGodGroupId = 'bigeop' | 'siksang' | 'jaeseong' | 'gwanseong' | 'inseong';

export interface ForbiddenRule {
  /** 정규식 원문 (플래그 u) */
  pattern: string;
  reason: string;
}

export interface TopicConfig {
  id: string;
  /** 체크박스·제목에 쓰는 이름 */
  label: string;
  enabled: boolean;
  /** 샘플 검수를 마쳤는지. TODO(owner): 첫 3개 주제도 Phase 2 샘플로 검수 필요 */
  reviewed: boolean;
  /** 이 주제 풀이에 넘길 근거 (공통 근거는 코드가 항상 더한다: 대운 방향·대운, 세운. D-023) */
  evidence: {
    tenGodGroups: readonly TenGodGroupId[];
    /** 추가로 넘길 근거 id */
    ids: readonly string[];
    /** 이 위치가 들어간 합충 근거도 넘긴다 */
    relationsTouching: readonly ChartRef[];
  };
  /** 풀이 방향 지침 (프롬프트에 그대로 들어간다) */
  guidance: string;
  /** 공통 금지 표현에 더해 이 주제에서만 막을 표현 */
  extraForbidden: readonly ForbiddenRule[];
}

export const TOPICS: readonly TopicConfig[] = Object.freeze([
  {
    id: 'wealth',
    label: '재물',
    enabled: true,
    reviewed: false,
    evidence: {
      tenGodGroups: ['jaeseong', 'siksang', 'bigeop'],
      ids: [],
      relationsTouching: [],
    },
    guidance:
      '재물을 대하는 태도, 돈이 들어오고 나가는 흐름의 경향, 관리 습관을 다룹니다. ' +
      '재성(재물)·식상(재물을 만드는 활동)·비겁(재물을 나누거나 다투는 힘)의 개수와 위치, 대운·세운 흐름을 근거로 씁니다. ' +
      '특정 금융상품·자산을 사거나 팔라는 말, 수익을 장담하는 말은 하지 않습니다.',
    extraForbidden: [
      { pattern: '(대박|일확천금|부자가 (됩니다|될 것))', reason: '재물 결과 장담' },
      { pattern: '(빚|파산|손실이 (확실|반드시))', reason: '재물 손실 단정' },
    ],
  },
  {
    id: 'career',
    label: '직업·적성',
    enabled: true,
    reviewed: false,
    evidence: {
      tenGodGroups: ['gwanseong', 'inseong', 'siksang'],
      ids: ['pillar.month.stem', 'pillar.month.branch', 'tenGod.month.stem', 'tenGod.month.branch'],
      relationsTouching: ['month.stem', 'month.branch'],
    },
    guidance:
      '일하는 방식, 잘 맞는 역할과 환경, 배움과 성장의 방향을 다룹니다. ' +
      '관성(조직·책임)·인성(배움·자격)·식상(표현·기술)과 사회 활동을 뜻하는 월주를 근거로 씁니다. ' +
      '특정 직업을 꼭 하라거나 하지 말라는 단정, 합격·승진을 장담하는 말은 하지 않습니다.',
    extraForbidden: [{ pattern: '(반드시 (합격|승진|성공)|(합격|승진)(합니다|할 것입니다))', reason: '결과 장담' }],
  },
  {
    id: 'love',
    label: '연애·결혼',
    enabled: true,
    reviewed: false,
    evidence: {
      tenGodGroups: ['jaeseong', 'gwanseong'],
      ids: ['pillar.day.branch', 'tenGod.day.branch'],
      relationsTouching: ['day.branch'],
    },
    guidance:
      '관계를 맺는 방식, 가까운 사람과 소통하는 습관, 관계에서 신경 쓰면 좋은 점을 다룹니다. ' +
      '배우자 자리로 보는 일지(일주 지지)와 그 합충, 재성·관성을 근거로 씁니다. ' +
      '결혼 시기·이혼·상대를 단정하거나 관계를 끝내라고 권하는 말은 하지 않습니다.',
    extraForbidden: [
      { pattern: '(이혼(하게|할 것|합니다)|결혼(을)? 못|평생 (혼자|외롭))', reason: '관계 결과 단정' },
      { pattern: '(바람을 피|외도)', reason: '관계 불안 조장' },
    ],
  },
]);

export function findTopic(id: string): TopicConfig | undefined {
  return TOPICS.find((t) => t.id === id);
}

export function enabledTopics(): TopicConfig[] {
  return TOPICS.filter((t) => t.enabled);
}
