// 태어난 지역: 시도 → 시군구 두 단계 선택과 경도 연결 (D-038)
import { describe, expect, it } from 'vitest';
import { DISTRICTS, districtsOf, findRegion, PROVINCES, provinceIdOf } from '../../src/config/regions';
import { buildChart } from '../../src/engine';
import { validateBirthForm, type BirthForm } from '../../src/web/birthForm';

const FORM = (regionId?: string, hour = 13, minute = 31): BirthForm => ({
  name: '', calendar: 'solar', isLeapMonth: false, year: 1990, month: 5, day: 15,
  timeUnknown: false, hour, minute, gender: 'female', regionId, consent: true,
});

const longitudeOf = (regionId?: string): number | undefined => {
  const r = validateBirthForm(FORM(regionId));
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.value.input.birthplaceLongitude;
};

/** 시도별 경도 범위(대략, 섬 포함). 데이터 입력 실수(다른 시도 값을 넣거나 자릿수를 틀린 것)를 잡는다 */
const BOUNDS: Record<string, [number, number]> = {
  seoul: [126.76, 127.19], busan: [128.76, 129.32], daegu: [128.35, 128.77], incheon: [124.6, 126.8],
  gwangju: [126.64, 127.0], daejeon: [127.24, 127.56], ulsan: [128.95, 129.47], sejong: [127.1, 127.4],
  gyeonggi: [126.3, 127.86], gangwon: [127.08, 129.37], chungbuk: [127.27, 128.66], chungnam: [125.9, 127.65],
  jeonbuk: [126.4, 127.9], jeonnam: [125.0, 127.9], gyeongbuk: [127.8, 131.0], gyeongnam: [127.57, 129.23],
  jeju: [126.1, 127.0],
};

describe('시도·시군구 데이터', () => {
  it('시도는 17개이고 요청한 순서다', () => {
    expect(PROVINCES.map((p) => p.name)).toEqual([
      '서울', '부산', '대구', '인천', '광주', '대전', '울산', '세종', '경기', '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주',
    ]);
  });

  it('모든 시도에 시군구가 있고, 아이디는 겹치지 않는다', () => {
    for (const p of PROVINCES) expect(districtsOf(p.id).length).toBeGreaterThan(0);
    const ids = DISTRICTS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    // 시도 아이디와 시군구 아이디도 겹치지 않는다
    for (const p of PROVINCES) expect(ids).not.toContain(p.id);
  });

  it('시도별 시군구 수 (2026년 행정구역)', () => {
    const counts = Object.fromEntries(PROVINCES.map((p) => [p.id, districtsOf(p.id).length]));
    expect(counts).toEqual({
      seoul: 25, busan: 16, daegu: 9, incheon: 11, gwangju: 5, daejeon: 5, ulsan: 5, sejong: 1, gyeonggi: 31,
      gangwon: 18, chungbuk: 11, chungnam: 15, jeonbuk: 14, jeonnam: 22, gyeongbuk: 22, gyeongnam: 18, jeju: 2,
    });
  });

  it.each(PROVINCES.map((p) => [p.name, p.id] as const))('%s: 시도 대표 경도와 모든 시군구 경도가 그 시도 범위 안에 있다', (_name, id) => {
    const [min, max] = BOUNDS[id]!;
    for (const v of [findRegion(id)!.longitude, ...districtsOf(id).map((d) => d.longitude)]) {
      expect(v).toBeGreaterThanOrEqual(min);
      expect(v).toBeLessThanOrEqual(max);
    }
  });

  it('시군구 아이디에서 시도를 찾는다', () => {
    expect(provinceIdOf('gyeonggi:광주시')).toBe('gyeonggi');
    expect(provinceIdOf('gwangju')).toBe('gwangju');
    expect(provinceIdOf('')).toBe('');
  });
});

describe('같은 이름 지역은 시도에 따라 다른 경도로 계산한다', () => {
  it.each([
    ['광주', 'gwangju', 'gyeonggi:광주시'],
    ['광주 동구 / 대구 동구', 'gwangju:동구', 'daegu:동구'],
    ['고성', 'gangwon:고성군', 'gyeongnam:고성군'],
    ['강서구', 'seoul:강서구', 'busan:강서구'],
  ])('%s', (_name, a, b) => {
    expect(longitudeOf(a)).toBe(findRegion(a)!.longitude);
    expect(longitudeOf(b)).toBe(findRegion(b)!.longitude);
    expect(longitudeOf(a)).not.toBe(longitudeOf(b));
  });

  it('중구는 5개 시도에 있고 모두 다른 경도다(인천 중구는 2026년 제물포구·영종구로 바뀜)', () => {
    const ids = DISTRICTS.filter((d) => d.name === '중구').map((d) => d.id);
    expect(ids.sort()).toEqual(['busan:중구', 'daegu:중구', 'daejeon:중구', 'seoul:중구', 'ulsan:중구'].sort());
    const lons = ids.map((id) => longitudeOf(id));
    expect(new Set(lons).size).toBe(ids.length);
  });

  it('광주광역시와 경기 광주시는 시 경계 시각(1990-05-15 13:31)에서 시주가 갈린다', () => {
    const chart = (regionId: string) => {
      const r = validateBirthForm(FORM(regionId, 13, 31));
      if (!r.ok) throw new Error('invalid');
      return buildChart(r.value.input, { referenceYear: 2026 });
    };
    const gwangju = chart('gwangju:북구');
    const gyeonggi = chart('gyeonggi:광주시');
    // 동경 126.91° → 12:58 오시(午), 동경 127.26° → 13:00 미시(未)
    expect(gwangju.time.localSolarTime).toMatchObject({ hour: 12, minute: 58 });
    expect(gyeonggi.time.localSolarTime).toMatchObject({ hour: 13, minute: 0 });
    expect(gwangju.pillars.hour?.branch).toBe(6);
    expect(gyeonggi.pillars.hour?.branch).toBe(7);
    expect(gwangju.settings.longitudeUsed).toBe(126.91);
    expect(gyeonggi.settings.longitudeUsed).toBe(127.26);
  });
});

describe('모름·해외, 시군구 모름, 잘못된 값', () => {
  it('모름·해외(선택 안 함)면 경도를 넘기지 않아 기본 127°(서울)로 보정한다', () => {
    expect(longitudeOf(undefined)).toBeUndefined();
    const r = validateBirthForm(FORM(undefined));
    if (!r.ok) throw new Error('invalid');
    expect(buildChart(r.value.input, { referenceYear: 2026 }).settings).toMatchObject({ longitudeCorrection: true, longitudeUsed: 127 });
  });

  it('시도만 고르면(시군구 모름) 시도 대표 경도를 쓴다', () => {
    expect(longitudeOf('gangwon')).toBe(128.3);
    expect(findRegion('gangwon')!.name).toBe('강원 (시군구 모름)');
  });

  it('없는 지역 아이디(예전 목록의 suwon 등)는 다시 고르라고 한다', () => {
    for (const id of ['suwon', 'gyeonggi:없는시', 'gyeonggi:']) {
      const r = validateBirthForm(FORM(id));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors.region).toBe('태어난 지역을 다시 선택해 주세요.');
    }
  });
});

describe('버튼 아래 안내 문구', () => {
  it('시만 고르고 분을 비우면 분까지 선택하라고 알려 준다', () => {
    const r = validateBirthForm({ ...FORM('seoul'), minute: undefined });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.time).toBe("태어난 시간의 분까지 선택해 주세요. 모르면 '분 모름'을 골라 주세요.");
  });

  it('시·분 모두 비우면 시간을 넣거나 모름을 고르라고 알려 준다', () => {
    const r = validateBirthForm({ ...FORM('seoul'), hour: undefined, minute: undefined });
    if (!r.ok) expect(r.errors.time).toBe('태어난 시간을 입력하거나 "모름"을 선택해 주세요.');
    else throw new Error('should fail');
  });
});
