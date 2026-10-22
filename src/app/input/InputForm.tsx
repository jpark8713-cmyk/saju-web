'use client';
// 화면 2: 정보 입력. 서버와 같은 검증 함수(validateBirthForm)로 버튼 활성 여부와 오류 문구를 정한다.
// 오류 문구는 손댄 칸에만 보이고, 버튼이 꺼져 있을 때는 빠진 항목을 버튼 아래에 모아 보여 준다.
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { districtsOf, findRegion, PROVINCES, provinceIdOf } from '../../config/regions';
import { DEFAULT_SETTINGS, SUPPORTED_RANGE } from '../../engine/settings';
import {
  boundaryMissingMessage, boundaryQuestion, NAME_MAX, rangeChoiceLabel, validateBirthForm,
  type BirthField, type BirthForm, type FieldErrors, type MinuteRange,
} from '../../web/birthForm';
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
  /** 숫자 문자열, 비어 있음, 또는 'unknown'(분 모름, D-039) */
  minute: string;
  /** 분 모름 + 경계가 있을 때의 답: 고른 구간의 시작 분 문자열, 'unknown'(모름), 또는 비어 있음 */
  minuteSegment: string;
  gender: '' | 'male' | 'female';
  regionId: string;
  consent: boolean;
}

const EMPTY: FormState = {
  name: '', calendar: 'solar', isLeapMonth: false, year: '', month: '', day: '',
  timeUnknown: false, hour: '', minute: '', minuteSegment: '', gender: '', regionId: '', consent: false,
};

/** 분 모름일 때 그 시의 분 구간(서버 계산). key는 구간을 정하는 입력(날짜·시·지역) */
interface BoundaryState {
  key: string;
  ranges: MinuteRange[] | null;
  failed: boolean;
}

/** 버튼 아래 안내 순서(화면 위에서 아래로) */
const FIELD_ORDER: readonly BirthField[] = ['form', 'name', 'date', 'time', 'gender', 'region', 'consent'];

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
    minute: s.timeUnknown || s.minute === 'unknown' ? undefined : num(s.minute),
    minuteUnknown: !s.timeUnknown && s.minute === 'unknown',
    minuteSegment: s.timeUnknown || s.minute !== 'unknown' || s.minuteSegment === '' ? undefined : s.minuteSegment === 'unknown' ? 'unknown' : num(s.minuteSegment),
    gender: s.gender || undefined,
    regionId: s.regionId || undefined,
    consent: s.consent,
  };
}

function fromBirthForm(b: BirthForm): FormState {
  const str = (n: number | undefined) => (n === undefined ? '' : String(n));
  return {
    name: b.name ?? '', calendar: b.calendar, isLeapMonth: b.isLeapMonth, year: str(b.year), month: str(b.month), day: str(b.day),
    timeUnknown: b.timeUnknown, hour: str(b.hour), minute: b.minuteUnknown ? 'unknown' : str(b.minute),
    minuteSegment: b.minuteSegment === undefined ? '' : String(b.minuteSegment),
    gender: b.gender ?? '',
    // 예전 목록의 지역(없어진 아이디)은 비워 "모름 · 해외"와 화면 표시를 맞춘다
    regionId: b.regionId && findRegion(b.regionId) ? b.regionId : '',
    consent: b.consent,
  };
}

/** 분 구간을 정하는 입력(날짜·시·지역). 분 모름이 아니거나 아직 덜 채웠으면 null */
function boundaryKeyOf(b: BirthForm): string | null {
  if (b.timeUnknown || !b.minuteUnknown || b.hour === undefined || b.year === undefined || b.month === undefined || b.day === undefined) return null;
  return JSON.stringify([b.calendar, b.isLeapMonth, b.year, b.month, b.day, b.hour, b.regionId ?? '']);
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
  const [mounted, setMounted] = useState(false);

  // 미리보기·결제 실패에서 돌아오면 입력값을 되살린다. 서버 검증 오류가 있으면 함께 보여 준다
  useEffect(() => {
    setMounted(true);
    const saved = load('saju.birth');
    if (saved) setS(fromBirthForm(saved));
    const errs = load('saju.inputErrors');
    if (errs) {
      setServerErrors(errs);
      setTouched(Object.fromEntries(Object.keys(errs).map((k) => [k, true])));
      remove('saju.inputErrors');
    }
  }, []);

  const form = useMemo(() => toBirthForm(s), [s]);
  const result = useMemo(() => validateBirthForm(form), [form]);
  const boundaryKey = useMemo(() => (validateBirthForm({ ...form, gender: 'female', consent: true }).ok ? boundaryKeyOf(form) : null), [form]);
  const [boundary, setBoundary] = useState<BoundaryState | null>(null);
  const lastBoundaryKey = useRef<string | null>(null);

  // 분 모름: 그 시 안에서 결과가 바뀌는 분이 있는지 서버에 묻는다. 날짜·시·지역이 바뀌면 다시 묻고, 예전 답은 지운다
  useEffect(() => {
    if (!boundaryKey) return;
    let alive = true;
    // 날짜·시·지역이 실제로 바뀌었을 때만 예전 답을 지운다(돌아와서 복원된 답은 둔다). 서버도 답을 다시 확인한다
    if (lastBoundaryKey.current !== null && lastBoundaryKey.current !== boundaryKey) {
      setS((prev) => (prev.minuteSegment === '' ? prev : { ...prev, minuteSegment: '' }));
    }
    lastBoundaryKey.current = boundaryKey;
    fetch('/api/time-boundary', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ birth: form }) })
      .then((r) => (r.ok ? (r.json() as Promise<{ ranges: MinuteRange[] | null }>) : Promise.reject(new Error(String(r.status)))))
      .then((d) => alive && setBoundary({ key: boundaryKey, ranges: d.ranges, failed: false }))
      .catch(() => alive && setBoundary({ key: boundaryKey, ranges: null, failed: true }));
    return () => {
      alive = false;
    };
    // form은 boundaryKey가 바뀔 때의 값만 쓴다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boundaryKey]);

  const hour = form.hour ?? 0;
  const current = boundary && boundary.key === boundaryKey ? boundary : null;
  const ranges = current?.ranges && current.ranges.length > 1 ? current.ranges : null;
  const boundaryProblem = !boundaryKey
    ? null
    : !current
      ? '태어난 시의 몇 분에 따라 결과가 달라지는지 확인하고 있어요.'
      : current.failed
        ? '분에 따라 결과가 달라지는지 확인하지 못했어요. 분을 직접 고르거나 잠시 뒤 다시 시도해 주세요.'
        : ranges && s.minuteSegment === ''
          ? boundaryMissingMessage(hour, ranges)
          : null;

  const errors: FieldErrors = result.ok ? serverErrors : { ...serverErrors, ...result.errors };
  const shown = (f: BirthField) => (touched[f] ? errors[f] : undefined);
  // 버튼 아래에 빠진 항목을 문장으로 보여 준다(손대지 않은 칸도 포함)
  const missing = [
    ...(result.ok ? [] : FIELD_ORDER.flatMap((f) => (result.errors[f] ? [result.errors[f]!] : []))),
    ...(result.ok || !result.errors.time ? (boundaryProblem ? [boundaryProblem] : []) : []),
  ];
  const ready = result.ok && !boundaryProblem;
  const provinceId = provinceIdOf(s.regionId);

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
    if (!ready) return;
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
            <option value="unknown">분 모름</option>
            {Array.from({ length: 60 }, (_, m) => (
              <option key={m} value={m}>
                {m}분
              </option>
            ))}
          </select>
        </div>
        {/* 분 모름 + 그 시 안에 결과가 바뀌는 분이 있을 때만 한 줄 더 묻는다(D-039) */}
        {!s.timeUnknown && ranges && (
          <div className="row" role="radiogroup" aria-label={boundaryQuestion(hour, ranges)} data-testid="minute-boundary" style={{ flexWrap: 'wrap' }}>
            <span className="meta" style={{ width: '100%' }}>
              {boundaryQuestion(hour, ranges)} (모르면 &apos;모름&apos;)
            </span>
            {ranges.map((r, i) => (
              <label key={r.fromMinute} className="check">
                <input type="radio" name="minuteSegment" checked={s.minuteSegment === String(r.fromMinute)} onChange={() => set('minuteSegment', String(r.fromMinute), 'time')} />{' '}
                {rangeChoiceLabel(hour, ranges, i)}
              </label>
            ))}
            <label className="check">
              <input type="radio" name="minuteSegment" checked={s.minuteSegment === 'unknown'} onChange={() => set('minuteSegment', 'unknown', 'time')} /> 모름 (시주 없이 풀고, 가능한 시주를 함께 보여 드려요)
            </label>
          </div>
        )}
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

      <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="label">
          태어난 지역 <span className="hint">(선택)</span>
        </legend>
        <div className="row">
          {/* 시도를 바꾸면 시군구는 "시군구 모름"(시도 아이디)으로 돌아간다 */}
          <select id="region" className="select" aria-label="시도" value={provinceId} onChange={(e) => set('regionId', e.target.value, 'region')} aria-describedby="region-error" data-testid="region-province">
            <option value="">모름 · 해외 (서울 기준 동경 {DEFAULT_SETTINGS.defaultLongitude}°)</option>
            {PROVINCES.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <select className="select" aria-label="시군구" value={s.regionId} disabled={!provinceId} onChange={(e) => set('regionId', e.target.value, 'region')} aria-describedby="region-error" data-testid="region-district">
            <option value={provinceId}>{provinceId ? '시군구 모름' : '시군구'}</option>
            {districtsOf(provinceId).map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
        <span className="hint">지역에 따라 태어난 시각을 몇 분 정도 보정해요. 해외에서 태어났다면 &quot;모름 · 해외&quot;를 골라 주세요.</span>
        <ErrorText id="region-error" text={shown('region')} />
      </fieldset>

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
      <button type="submit" className="button" disabled={!mounted || !ready} data-testid="input-submit">
        내 사주 보기
      </button>
      {/* 화면 스크립트가 붙기 전에는 버튼이 꺼져 있다. 그대로 멈추면 입력 문제가 아니라 화면을 못 불러온 것이다 */}
      {/* 안내 영역은 늘 두고 내용만 바꾼다(스크린리더가 처음 나타난 안내도 읽도록) */}
      <div aria-live="polite">
        {!mounted ? (
          <p className="hint" style={{ margin: 0 }} data-testid="input-loading">
            화면을 불러오는 중이에요. 계속 이 문구가 보이면 새로고침해 주세요.
          </p>
        ) : (
          missing.length > 0 && (
            <ul className="error" style={{ margin: 0, paddingLeft: 18 }} data-testid="missing-fields">
              {missing.map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
          )
        )}
      </div>
    </form>
  );
}
