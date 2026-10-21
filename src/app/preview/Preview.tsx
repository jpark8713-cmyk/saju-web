'use client';
// 화면 4: 무료 미리보기. 서버가 보낸 무료 공개분(표지·차트·오행·총평 템플릿 문장)과 잠긴 섹션 제목만 보여 준다.
// 아래에 풀이 주제·받는 방법·이메일을 고르고 "다음"에서 주문을 만든다(POST /api/orders, 금액은 서버가 다시 계산).
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { priceFor } from '../../config/prices';
import { enabledTopics } from '../../config/topics';
import { ReportDocument } from '../../components/ReportDocument';
import type { PreviewView } from '../../report/view';
import { load, save, type Choices } from '../../web/session';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const won = (n: number) => `${n.toLocaleString('ko-KR')}원`;

type OrderErrors = Partial<Record<string, string>>;

function OrderBox({ choices, setChoices, onNext, busy, errors }: {
  choices: Choices;
  setChoices: (c: Choices) => void;
  onNext: () => void;
  busy: boolean;
  errors: OrderErrors;
}) {
  const topics = enabledTopics();
  const price = useMemo(() => priceFor(choices.topicIds), [choices.topicIds]);
  const wantsEmail = choices.deliveryMethods.includes('email');
  const emailOk = !wantsEmail || EMAIL_RE.test(choices.email.trim());
  const canNext = choices.deliveryMethods.length > 0 && emailOk && !busy;
  const toggle = <T extends string>(list: readonly T[], v: T, on: boolean): T[] => (on ? [...list.filter((x) => x !== v), v] : list.filter((x) => x !== v));

  return (
    <section className="section" data-testid="order-box" aria-label="주문 선택">
      <div className="section-head">
        <h2 className="h2">전체 리포트 받기</h2>
      </div>
      <fieldset className="field box" style={{ margin: 0 }}>
        <legend className="label">풀이 주제 (선택)</legend>
        <div className="hint">기본 리포트(총평·타고난 성향·대운 흐름·올해·내년 흐름) {won(price.base)}</div>
        {topics.map((t) => (
          <label key={t.id} className="check">
            <input type="checkbox" checked={choices.topicIds.includes(t.id)} data-testid={`topic-${t.id}`}
              onChange={(e) => setChoices({ ...choices, topicIds: toggle(choices.topicIds, t.id, e.target.checked) })} />
            <span style={{ flex: 1 }}>{t.label}</span>
            <span>+{won(priceFor([t.id]).topics[0]?.price ?? 0)}</span>
          </label>
        ))}
        {price.discount > 0 && <div className="hint">전체 선택 할인 -{won(price.discount)}</div>}
        <div className="total" data-testid="price-total">
          <span>합계</span>
          <span>{won(price.total)}</span>
        </div>
        {errors.topics && <div className="error">{errors.topics}</div>}
      </fieldset>

      <fieldset className="field box" style={{ margin: 0 }}>
        <legend className="label">받는 방법 (하나 이상)</legend>
        <label className="check">
          <input type="checkbox" checked={choices.deliveryMethods.includes('pdf')} data-testid="delivery-pdf"
            onChange={(e) => setChoices({ ...choices, deliveryMethods: toggle(choices.deliveryMethods, 'pdf', e.target.checked) })} />
          PDF 다운로드 (결제 후 화면에서 바로 받기)
        </label>
        <label className="check">
          <input type="checkbox" checked={wantsEmail} data-testid="delivery-email"
            onChange={(e) => setChoices({ ...choices, deliveryMethods: toggle(choices.deliveryMethods, 'email', e.target.checked) })} />
          이메일로 받기 (다운로드 링크 발송)
        </label>
        {wantsEmail && (
          <div className="field">
            <label className="label" htmlFor="email">
              이메일
            </label>
            <input id="email" className="input" type="email" inputMode="email" autoComplete="email" value={choices.email} data-testid="email"
              onChange={(e) => setChoices({ ...choices, email: e.target.value })} aria-describedby="email-error" />
            {(errors.email || (choices.email && !emailOk)) && (
              <div className="error" id="email-error" role="alert">
                {errors.email ?? '이메일 주소를 정확히 입력해 주세요.'}
              </div>
            )}
          </div>
        )}
        {choices.deliveryMethods.length === 0 && (
          <div className="error" role="alert">
            받는 방법을 하나 이상 선택해 주세요.
          </div>
        )}
        {errors.delivery && <div className="error">{errors.delivery}</div>}
        <div className="hint">어떤 방법을 고르셔도 결제 후 화면에서 리포트 전체를 볼 수 있어요.</div>
      </fieldset>
      {(errors.form || errors.payment || errors.date || errors.time) && (
        <div className="error" role="alert">
          {errors.form ?? errors.payment ?? '입력 정보를 다시 확인해 주세요.'}
        </div>
      )}
      <button type="button" className="button" disabled={!canNext} onClick={onNext} data-testid="preview-next">
        다음: 주문 확인과 결제
      </button>
    </section>
  );
}

export function Preview() {
  const router = useRouter();
  const [view, setView] = useState<PreviewView | null>(null);
  const [choices, setChoicesState] = useState<Choices>({ topicIds: [], deliveryMethods: ['pdf'], email: '' });
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<OrderErrors>({});

  useEffect(() => {
    const v = load('saju.preview');
    if (!v || !load('saju.birth')) {
      router.replace('/input');
      return;
    }
    setView(v);
    const c = load('saju.choices');
    if (c) setChoicesState(c);
  }, [router]);

  const setChoices = (c: Choices) => {
    setChoicesState(c);
    setErrors({});
    save('saju.choices', c);
  };

  const next = async () => {
    const birth = load('saju.birth');
    if (!birth) return router.replace('/input');
    setBusy(true);
    try {
      // 결제 수단은 서버가 켜진 수단 중 첫째로 정하고, 결제 화면에서 바꿀 수 있다
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ birth, topicIds: choices.topicIds, deliveryMethods: choices.deliveryMethods, email: choices.email }),
      });
      const data = await res.json();
      if (res.status === 201) {
        save('saju.order', { ...data, topicIds: data.breakdown.topics.map((t: { id: string }) => t.id), deliveryMethods: choices.deliveryMethods });
        router.push('/checkout');
      } else {
        setErrors(data.errors ?? { form: '주문을 만들지 못했어요. 잠시 후 다시 시도해 주세요.' });
      }
    } catch {
      setErrors({ form: '연결이 잠시 끊겼어요. 다시 시도해 주세요.' });
    } finally {
      setBusy(false);
    }
  };

  if (!view) return <p className="meta">불러오는 중이에요…</p>;
  return (
    <ReportDocument
      view={view}
      mode="screen"
      afterPreview={<OrderBox choices={choices} setChoices={setChoices} onNext={() => void next()} busy={busy} errors={errors} />}
    />
  );
}
