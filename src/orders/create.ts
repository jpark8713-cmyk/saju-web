// 주문 생성 (POST /api/orders). 금액은 서버가 가격표로 계산하고, 클라이언트가 보낸 금액은 무시한다(SPEC 5장).
import { z } from 'zod';
import { defaultPaymentMethod, findPaymentMethod } from '../config/paymentMethods';
import { PRICES, priceFor, type PriceBreakdown } from '../config/prices';
import type { SajuChart } from '../engine/types';
import { isChildChart } from '../report/audience';
import { findTopic } from '../config/topics';
import { buildChart } from '../engine/chart';
import { CalendarInputError } from '../engine/calendar';
import type { Store, DeliveryMethod, Order } from '../store/types';
import { engineErrorToField, type FieldErrors } from '../web/birthForm';
import { validateBirthFormOnServer } from '../web/birthServer';
import { birthLabelOf } from '../report/view';
import { hashToken, newAccessToken, newOrderId } from './ids';
import { EMPTY_PAYMENT } from './paymentState';

export type OrderField = keyof FieldErrors | 'topics' | 'delivery' | 'email' | 'payment';
export type OrderErrors = Partial<Record<OrderField, string>>;

export class OrderInputError extends Error {
  constructor(readonly errors: OrderErrors) {
    super('주문 입력 오류');
    this.name = 'OrderInputError';
  }
}

const bodySchema = z.object({
  birth: z.unknown(),
  topicIds: z.array(z.string()),
  deliveryMethods: z.array(z.string()),
  email: z.string().optional().nullable(),
  /** 비우면 켜진 수단 중 첫째. 결제 화면에서 바꿀 수 있다(결제 준비 때 다시 검증) */
  paymentMethod: z.string().optional().nullable(),
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function isValidEmail(email: string): boolean {
  return email.length <= 254 && EMAIL_RE.test(email);
}

export interface CreatedOrder {
  orderId: string;
  accessToken: string;
  amount: number;
  breakdown: PriceBreakdown;
  paymentMethod: string;
}

function validateChoices(b: z.infer<typeof bodySchema>): { errors: OrderErrors; delivery: DeliveryMethod[]; email: string | null; method: string } {
  const errors: OrderErrors = {};
  const unknownTopics = b.topicIds.filter((id) => !findTopic(id)?.enabled);
  if (unknownTopics.length || new Set(b.topicIds).size !== b.topicIds.length) errors.topics = '선택할 수 없는 주제가 있습니다.';
  const delivery = [...new Set(b.deliveryMethods)];
  if (delivery.length === 0) errors.delivery = '받는 방법을 하나 이상 선택해 주세요.';
  else if (delivery.some((d) => d !== 'pdf' && d !== 'email')) errors.delivery = '받는 방법이 올바르지 않습니다.';
  const wantsEmail = delivery.includes('email');
  const email = (b.email ?? '').trim();
  if (wantsEmail && !isValidEmail(email)) errors.email = '이메일 주소를 정확히 입력해 주세요.';
  const method = b.paymentMethod ? findPaymentMethod(b.paymentMethod) : defaultPaymentMethod();
  if (!method || !method.enabled) errors.payment = '선택할 수 없는 결제 수단입니다.';
  // 이메일 받기를 고르지 않았으면 이메일을 저장하지 않는다
  return { errors, delivery: delivery as DeliveryMethod[], email: wantsEmail ? email : null, method: method?.id ?? '' };
}

export async function createOrder(store: Store, raw: unknown, now = new Date()): Promise<CreatedOrder> {
  const body = bodySchema.safeParse(raw);
  if (!body.success) throw new OrderInputError({ form: '주문 정보 형식이 올바르지 않습니다.' });
  const birth = validateBirthFormOnServer(body.data.birth);
  const choice = validateChoices(body.data);
  const errors: OrderErrors = { ...(birth.ok ? {} : birth.errors), ...choice.errors };
  if (!birth.ok || Object.keys(errors).length) throw new OrderInputError(errors);

  const referenceYear = new Date(now.getTime() + 9 * 3_600_000).getUTCFullYear();
  let chart: SajuChart;
  try {
    chart = buildChart(birth.value.input, { referenceYear }); // 존재하지 않는 음력 날짜·윤달 등 엔진 검증
  } catch (e) {
    if (e instanceof CalendarInputError) throw new OrderInputError(engineErrorToField(e.code, birth.value.input));
    throw e;
  }

  // 아이 사주면 결제 화면·주문 내역의 주제 이름도 아이용으로 보여 준다(리포트 생성과 같은 기준 시각, D-046)
  const breakdown = priceFor(body.data.topicIds, PRICES, { child: isChildChart(chart, now) });
  const accessToken = newAccessToken();
  const order: Order = {
    id: newOrderId(now),
    accessTokenHash: hashToken(accessToken),
    status: 'created',
    amount: breakdown.total,
    breakdown,
    topicIds: breakdown.topics.map((t) => t.id),
    deliveryMethods: choice.delivery,
    email: choice.email,
    paymentMethod: choice.method,
    payment: { ...EMPTY_PAYMENT },
    referenceYear,
    createdAt: now.toISOString(),
    paidAt: null,
    pendingBirth: { input: birth.value.input, name: birth.value.name, label: birthLabelOf(birth.value.input, birth.value.timeText) },
    generation: { runs: 0, startedAt: null, finishedAt: null, lastFailure: null },
    devForceGenerationFailure: false,
  };
  await store.createOrder(order);
  return { orderId: order.id, accessToken, amount: order.amount, breakdown, paymentMethod: order.paymentMethod };
}
