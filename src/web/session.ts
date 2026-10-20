// 브라우저 탭 안에서만 쓰는 임시 보관(sessionStorage). 서버나 로그로 보내지 않는다.
// 탭을 닫으면 사라진다. 결제 실패 후 미리보기로 돌아올 때 입력값을 유지하는 데 쓴다(화면 A).
import type { BirthForm, FieldErrors } from './birthForm';
import type { PreviewView } from '../report/view';
import type { PriceBreakdown } from '../config/prices';

export interface Choices {
  topicIds: string[];
  deliveryMethods: ('pdf' | 'email')[];
  email: string;
}

export interface SavedOrder {
  orderId: string;
  accessToken: string;
  amount: number;
  breakdown: PriceBreakdown;
  topicIds: string[];
  deliveryMethods: ('pdf' | 'email')[];
  paymentMethod: string;
}

interface Slots {
  'saju.birth': BirthForm;
  'saju.inputErrors': FieldErrors;
  'saju.preview': PreviewView;
  'saju.choices': Choices;
  'saju.order': SavedOrder;
  'saju.payFailure': string;
}

export function load<K extends keyof Slots>(key: K): Slots[K] | null {
  try {
    const raw = window.sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Slots[K]) : null;
  } catch {
    return null;
  }
}

export function save<K extends keyof Slots>(key: K, value: Slots[K]): void {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 저장할 수 없는 환경(사생활 보호 모드 등)에서는 이 탭의 화면 이동만 유지된다
  }
}

export function remove(key: keyof Slots): void {
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // 위와 같음
  }
}

/** 주문 토큰을 붙인 요청 헤더 */
export function orderHeaders(token: string): HeadersInit {
  return { 'content-type': 'application/json', 'x-order-token': token };
}
