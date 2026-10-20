// 가격표 (원). 합계 = 기본가 + 선택한 주제별 가격의 합 - 전체 선택 할인 (SPEC 1장).
// TODO(owner): 아래 값은 개발·테스트용 임시 값이다. 실제 가격은 AI 비용(D-019)과 결제 수수료를 보고 사업자가 정한다.
import { enabledTopics } from './topics';

export interface PriceTable {
  base: number;
  /** 주제별 기본 가격 */
  perTopic: number;
  /** 주제마다 다르게 둘 때 (주제 id → 가격) */
  topicOverrides: Readonly<Record<string, number>>;
  /** 켜져 있는 주제를 모두 고르면 빼 주는 금액 (0이면 할인 없음) */
  allTopicsDiscount: number;
}

export const PRICES: Readonly<PriceTable> = Object.freeze({
  base: 10_000,
  perTopic: 3_000,
  topicOverrides: Object.freeze({}),
  allTopicsDiscount: 0,
});

export interface PriceBreakdown {
  base: number;
  topics: { id: string; label: string; price: number }[];
  discount: number;
  total: number;
}

/** 서버와 화면이 같은 계산을 쓴다. 금액은 클라이언트가 보낸 값을 믿지 않고 항상 이 함수로 다시 계산한다 */
export function priceFor(topicIds: readonly string[], table: PriceTable = PRICES): PriceBreakdown {
  const topics = enabledTopics()
    .filter((t) => topicIds.includes(t.id))
    .map((t) => ({ id: t.id, label: t.label, price: table.topicOverrides[t.id] ?? table.perTopic }));
  const allSelected = topics.length > 0 && topics.length === enabledTopics().length;
  const discount = allSelected ? table.allTopicsDiscount : 0;
  const total = table.base + topics.reduce((s, t) => s + t.price, 0) - discount;
  return { base: table.base, topics, discount, total };
}
