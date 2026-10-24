// 가격표 (원). 합계 = 기본가 + 월별·10년 흐름 가격 + 선택한 주제별 가격의 합 - 전체 선택 할인 (SPEC 1장, D-054).
// 상품 구성: 기본 리포트(총평·타고난 성향·대운 흐름·올해·내년 흐름) + 월별(아이는 계절별)·10년 흐름 + 고른 주제.
// 월별·10년 흐름은 모든 리포트에 들어 있다(D-052). 빼고 파는 선택형 상품은 주문 화면·생성 분기가 필요해 아직 없다.
// TODO(owner): 아래 값은 개발·테스트용 임시 값이다. 실제 가격은 AI 비용(D-019)과 결제 수수료를 보고 사업자가 정한다.
import { enabledTopics } from './topics';

export interface PriceTable {
  /** 기본 리포트(총평·타고난 성향·대운 흐름·올해·내년 흐름) */
  base: number;
  /** 월별(아이는 계절별)·10년 흐름. 0이면 기본가에 포함된 것으로 보여 주고, 값을 정하면 따로 한 줄로 더한다 */
  periods: number;
  /** 주제별 기본 가격 */
  perTopic: number;
  /** 주제마다 다르게 둘 때 (주제 id → 가격) */
  topicOverrides: Readonly<Record<string, number>>;
  /** 켜져 있는 주제를 모두 고르면 빼 주는 금액 (0이면 할인 없음) */
  allTopicsDiscount: number;
}

export const PRICES: Readonly<PriceTable> = Object.freeze({
  base: 10_000,
  periods: 0,
  perTopic: 3_000,
  topicOverrides: Object.freeze({}),
  allTopicsDiscount: 0,
});

export interface PriceBreakdown {
  base: number;
  /** 월별·10년 흐름 가격(0이면 기본가에 포함). 예전 주문 기록에는 없다 */
  periods?: number;
  topics: { id: string; label: string; price: number }[];
  discount: number;
  total: number;
}

/** 서버와 화면이 같은 계산을 쓴다. 금액은 클라이언트가 보낸 값을 믿지 않고 항상 이 함수로 다시 계산한다 */
export function priceFor(topicIds: readonly string[], table: PriceTable = PRICES, opts: { child?: boolean } = {}): PriceBreakdown {
  // 아이 사주(만 13세 미만)는 주제 이름만 아이용으로 보여 준다. 값·가격은 같다(D-046)
  const topics = enabledTopics()
    .filter((t) => topicIds.includes(t.id))
    .map((t) => ({ id: t.id, label: opts.child ? t.childLabel : t.label, price: table.topicOverrides[t.id] ?? table.perTopic }));
  const allSelected = topics.length > 0 && topics.length === enabledTopics().length;
  const discount = allSelected ? table.allTopicsDiscount : 0;
  const total = table.base + table.periods + topics.reduce((s, t) => s + t.price, 0) - discount;
  return { base: table.base, periods: table.periods, topics, discount, total };
}
