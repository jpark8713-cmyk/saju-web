'use client';
// 화면 2: 정보 입력. 서버와 같은 검증 함수(validateBirthForm)로 버튼 활성 여부와 오류 문구를 정한다.
// 오류 문구는 손댄 칸에만 보이고, 버튼이 꺼져 있을 때는 빠진 항목을 버튼 아래에 모아 보여 준다.
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { REGIONS } from '../../config/regions';
import { SUPPORTED_RANGE } from '../../engine/settings';
import { NAME_MAX, validateBirthForm, type BirthField, type BirthForm, type FieldErrors } from '../../web/birthForm';
import { load, remove, save } from '../../web/session';

interface FormState {
  name: string;
  calendar: 'solar' | 'lunar';
  isLeapMonth: boolean;
  year: string;
  month: string;
  day: string;
  timeUnknown: boolean;
  hour: string;
  minute: string;
  gender: '' | 'male' | 'female';
  regionId: string;
  consent: boolean;
}

const EMPTY: FormState = {
  name: '', calendar: 'solar', isLeapMonth: false, year: '', month: '', day: '',
  timeUnknown: false, hour: '', minute: '', gender: '', regionId: '', consent: false,
};

const FIELD_LABELS: Record<BirthField, string> = {
  name: '이름', date: '생년월일', time: '태어난 시간', gender: '성별', region: '태어난 지역', consent: '개인정보 동의', form: '입력',
};

const num = (s: string): number | undefined => (s.trim() === '' || !/^\d+$/.test(s.trim()) ? undefined : Number(s));

function toBirthForm(s: FormState): BirthForm {
  return {
    name: s.name,
    calendar: s.calendar,
    isLeapMonth: s.calendar === 'lunar' && s.isLeapMonth,
    year: num(s.year),
    month: num(s.month),
    day: num(s.day),
    timeUnknown: s.timeUnknown,
    hour: s.timeUnknown ? undefined : num(s.hour),
    minute: s.timeUnknown ? undefined : num(s.minute),
    gender: s.gender || undefined,
    regionId: s.regionId || undefined,
    consent: s.consent,
  };
}

function fromBirthForm(b: BirthForm): FormState {
  const str = (n: number | undefined) => (n === undefined ? '' : String(n));
  return {
    name: b.name ?? '', calendar: b.calendar, isLeapMonth: b.isLeapMonth, year: str(b.year), month: str(b.month), day: str(b.day),
    timeUnknown: b.timeUnknown, hour: str(b.hour), minute: str(b.minute), gender: b.gender ?? '', regionId: b.regionId ?? '', consent: b.consent,
  };
}

function ErrorText({ id, text }: { id: string; text: string | undefined }) {
  return text ? (
    <div className="error" id={id} role="alert">
      {text}
    </div>
  ) : null;
}

export function InputForm() {
  const router = useRouter();
  const [s, setS] = useState<FormState>(EMPTY);
  const [touched, setTouched] = useState<Partial<Record<BirthField, boolean>>>({});
  const [serverErrors, setServerErrors] = useState<FieldErrors>({});

  // 미리보기·결제 실패에서 돌아오면 입력값을 되살린다. 서버 검증 오류가 있으면 함께 보여 준다
  useEffect(() => {
    const saved = load('saju.birth');
    if (saved) setS(fromBirthForm(saved));
    const errs = load('saju.inputErrors');
    if (errs) {
      setServerErrors(errs);
      setTouched(Object.fromEntries(Object.keys(errs).map((k) => [k, true])));
      remove('saju.inputErrors');
    }
  }, []);

  const result = useMemo(() => validateBirthForm(toBirthForm(s)), [s]);
  const errors: FieldErrors = result.ok ? serverErrors : { ...serverErrors, ...result.errors };
  const shown = (f: BirthField) => (touched[f] ? errors[f] : undefined);
  const missing = result.ok ? [] : (Object.keys(result.errors) as BirthField[]).map((f) => FIELD_LABELS[f]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K], field: BirthField) => {
    setS((prev) => ({ ...prev, [key]: value }));
    setTouched((prev) => ({ ...prev, [field]: true }));
    // 값을 고치면 그 칸의 서버 오류는 지운다
    setServerErrors((prev) => {
      const { [field]: _drop, ...rest } = prev;
      return rest;
    });
  };
  const touch = (field: BirthField) => setTouched((prev) => ({ ...prev, [field]: true }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!result.ok) return;
    save('saju.birth', toBirthForm(s));
    remove('saju.preview');
    router.push('/calculating');
  };

  return (
    <form className="section" onSubmit={submit} noValidate data-testid="birth-form" style={{ gap: 18 }}>
      <div className="field">
        <label className="label" htmlFor="name">
          이름 <span className="hint">(선택, 표지에만 써요)</span>
        </label>
        <input id="name" className="input" value={s.name} maxLength={NAME_MAX + 5} onChange={(e) => set('name', e.target.value, 'name')} aria-describedby="name-error" />
        <ErrorText id="name-error" text={shown('name')} />
      </div>

      <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="label">생년월일</legend>
        <div className="row" role="radiogroup" aria-label="달력">
          <label className="check">
            <input type="radio" name="calendar" checked={s.calendar === 'solar'} onChange={() => set('calendar', 'solar', 'date')} /> 양력
          </label>
          <label className="check">
            <input type="radio" name="calendar" checked={s.calendar === 'lunar'} onChange={() => set('calendar', 'lunar', 'date')} /> 음력
          </label>
          {s.calendar === 'lunar' && (
            <label className="check">
              <input type="checkbox" checked={s.isLeapMonth} onChange={(e) => set('isLeapMonth', e.target.checked, 'date')} data-testid="leap-month" /> 윤달
            </label>
          )}
        </div>
        <div className="row">
          <input className="input" inputMode="numeric" placeholder={`년 (${SUPPORTED_RANGE.minYear}~${SUPPORTED_RANGE.maxYear})`} aria-label="태어난 해"
            value={s.year} onChange={(e) => set('year', e.target.value, 'date')} onBlur={() => touch('date')} aria-describedby="date-error" />
          <input className="input" inputMode="numeric" placeholder="월" aria-label="태어난 달"
            value={s.month} onChange={(e) => set('month', e.target.value, 'date')} onBlur={() => touch('date')} aria-describedby="date-error" />
          <input className="input" inputMode="numeric" placeholder="일" aria-label="태어난 날"
            value={s.day} onChange={(e) => set('day', e.target.value, 'date')} onBlur={() => touch('date')} aria-describedby="date-error" />
        </div>
        <ErrorText id="date-error" text={shown('date')} />
      </fieldset>

      <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="label">태어난 시간</legend>
        <div className="row">
          <select className="select" aria-label="시" value={s.hour} disabled={s.timeUnknown} onChange={(e) => set('hour', e.target.value, 'time')} aria-describedby="time-error">
            <option value="">시</option>
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>
                {h}시
              </option>
            ))}
          </select>
          <select className="select" aria-label="분" value={s.minute} disabled={s.timeUnknown} onChange={(e) => set('minute', e.target.value, 'time')} aria-describedby="time-error">
            <option value="">분</option>
            {Array.from({ length: 60 }, (_, m) => (
              <option key={m} value={m}>
                {m}분
              </option>
            ))}
          </select>
        </div>
        <label className="check">
          <input type="checkbox" checked={s.timeUnknown} onChange={(e) => set('timeUnknown', e.target.checked, 'time')} data-testid="time-unknown" /> 시간을 몰라요 (시주 없이 세 기둥으로 풀어요)
        </label>
        <ErrorText id="time-error" text={shown('time')} />
      </fieldset>

      <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="label">성별</legend>
        <div className="row">
          <label className="check">
            <input type="radio" name="gender" checked={s.gender === 'female'} onChange={() => set('gender', 'female', 'gender')} /> 여성
          </label>
          <label className="check">
            <input type="radio" name="gender" checked={s.gender === 'male'} onChange={() => set('gender', 'male', 'gender')} /> 남성
          </label>
        </div>
        <span className="hint">대운이 흐르는 방향을 정하는 데 써요.</span>
        <ErrorText id="gender-error" text={shown('gender')} />
      </fieldset>

      <div className="field">
        <label className="label" htmlFor="region">
          태어난 지역 <span className="hint">(선택)</span>
        </label>
        <select id="region" className="select" value={s.regionId} onChange={(e) => set('regionId', e.target.value, 'region')}>
          <option value="">모름 · 선택 안 함 (서울 기준)</option>
          {REGIONS.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
        <span className="hint">지역에 따라 태어난 시각을 몇 분 정도 보정해요.</span>
        <ErrorText id="region-error" text={shown('region')} />
      </div>

      <div className="field box">
        <label className="check">
          <input type="checkbox" checked={s.consent} onChange={(e) => set('consent', e.target.checked, 'consent')} data-testid="consent" />
          <span>
            (필수) 풀이를 위해 생년월일시·성별을 수집·이용하는 데 동의해요. 서버에 보낸 입력값은 풀이가 끝나면 삭제하고, 이 브라우저 탭에 남은 값도 리포트를 받으면 지워요.{' '}
            <a href="/legal/privacy" target="_blank" rel="noreferrer">
              처리방침 보기
            </a>
          </span>
        </label>
        <ErrorText id="consent-error" text={shown('consent')} />
      </div>

      <ErrorText id="form-error" text={errors.form} />
      <button type="submit" className="button" disabled={!result.ok} data-testid="input-submit">
        내 사주 보기
      </button>
      {!result.ok && (
        <p className="hint" style={{ margin: 0 }} data-testid="missing-fields">
          아직 확인이 필요한 항목: {missing.join(', ')}
        </p>
      )}
    </form>
  );
}
