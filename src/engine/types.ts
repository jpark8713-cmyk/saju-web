// 사주 엔진 공용 타입. 엔진은 순수 함수만 두며 네트워크·DB에 의존하지 않는다.

export type Element = 'wood' | 'fire' | 'earth' | 'metal' | 'water';
export type YinYang = 'yang' | 'yin';
export type Gender = 'male' | 'female';
export type PillarPosition = 'year' | 'month' | 'day' | 'hour';

/** 천간 인덱스 0~9 (갑~계) */
export type StemIndex = number;
/** 지지 인덱스 0~11 (자~해) */
export type BranchIndex = number;

export type TenGod =
  | 'bigyeon' // 비견
  | 'geobjae' // 겁재
  | 'siksin' // 식신
  | 'sanggwan' // 상관
  | 'pyeonjae' // 편재
  | 'jeongjae' // 정재
  | 'pyeongwan' // 편관
  | 'jeonggwan' // 정관
  | 'pyeonin' // 편인
  | 'jeongin'; // 정인

export interface BirthTime {
  hour: number; // 0~23
  minute: number; // 0~59
}

export interface SajuInput {
  calendar: 'solar' | 'lunar';
  /** 음력일 때만 의미가 있다 */
  isLeapMonth: boolean;
  year: number;
  month: number;
  day: number;
  /** 시간 모름이면 null (3주 계산) */
  time: BirthTime | null;
  gender: Gender;
  /** 출생지 경도(동경, 도). 비우면 설정의 기본 경도를 쓴다 */
  birthplaceLongitude?: number;
}

/** 자시 처리 방식 */
export type JasiMode =
  | 'split' // 야자시/조자시 구분: 23시대는 당일 일주 + 다음날 일간 기준 자시
  | 'unified'; // 통자시: 23시부터 다음날 일주

export interface CalcSettings {
  jasiMode: JasiMode;
  /** 출생지 경도로 평균태양시 보정 */
  longitudeCorrection: boolean;
  /** 서머타임·과거 표준시(UTC+8:30 등) 보정. tzdb의 Asia/Seoul 이력을 쓴다 */
  historicalTimezone: boolean;
  /** 출생지를 비웠을 때 쓰는 경도 */
  defaultLongitude: number;
  /** 시간 모름일 때 년·월주 판정과 대운 계산에 쓰는 시각 */
  unknownTimeAssumption: BirthTime;
  /** 대운을 몇 개까지 만들지 (1~12) */
  daewoonCount: number;
  /** 출생~절입 시간을 분으로 바꿀 때 초 처리: floor(버림, 기본) | round(반올림) */
  daewoonRounding: 'floor' | 'round';
}

export interface Pillar {
  stem: StemIndex;
  branch: BranchIndex;
}

export interface PillarSet {
  year: Pillar;
  month: Pillar;
  day: Pillar;
  /** 시간 모름이면 null */
  hour: Pillar | null;
}

export interface CivilDateTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

export interface TimeResolution {
  /** 출생 순간(UTC epoch ms). 년·월주와 대운 계산 기준 */
  instantMs: number;
  /** 적용된 UTC 오프셋(분). 서머타임·과거 표준시 반영 결과 */
  utcOffsetMinutes: number;
  /** 일주·시주 판정에 쓴 현지 시각(경도 보정 반영) */
  localSolarTime: CivilDateTime;
  /** 입력 시각이 존재하지 않는 시각(서머타임 시작 구간)이었는지 */
  nonexistentWallTime: boolean;
  /** 입력 시각이 두 번 있는 시각(서머타임 종료 구간)이었는지 */
  ambiguousWallTime: boolean;
}

export interface DaewoonStart {
  /** 출생부터 대운 시작까지 (3일=1년, 1일=4개월, 1시간=5일) */
  years: number;
  months: number;
  days: number;
  forward: boolean;
  /** 계산에 쓴 절입 시각 (UTC epoch ms) */
  jieInstantMs: number;
  jieName: string;
}

export interface DaewoonEntry {
  index: number;
  pillar: Pillar;
  /** 대운 시작 시점까지 출생 후 경과 (만 기준) */
  startOffset: { years: number; months: number };
  /** 대운이 시작되는 양력 연·월 */
  startYear: number;
  startMonth: number;
  /** 대운이 시작되는 해의 세는 나이 (startYear - 출생 연도 + 1) */
  koreanAge: number;
}

export interface SeunEntry {
  year: number;
  pillar: Pillar;
}

export interface ElementDistribution {
  counts: Record<Element, number>;
  /** 센 글자 수 (3주면 6, 4주면 8) */
  total: number;
}

export interface TenGodEntry {
  position: PillarPosition;
  part: 'stem' | 'branch';
  tenGod: TenGod;
}

export type RelationKind =
  | 'stemCombine' // 천간합
  | 'stemClash' // 천간충
  | 'branchSixCombine' // 지지 육합
  | 'branchClash' // 지지 충
  | 'branchTripleCombine'; // 지지 삼합

export interface Relation {
  kind: RelationKind;
  /** 관련 위치 (예: day.stem) */
  refs: ChartRef[];
  /** 합으로 생기는 오행 (합·삼합일 때) */
  resultElement?: Element;
}

/** 차트에서 강조할 수 있는 위치 */
export type ChartRef =
  | `${PillarPosition}.${'stem' | 'branch'}`
  | `daewoon[${number}]`
  | `seun[${number}]`
  | `elements.${Element}`;

export interface SajuChart {
  input: {
    calendar: SajuInput['calendar'];
    hasTime: boolean;
    gender: Gender;
  };
  /** 계산에 쓴 양력 날짜(음력 입력은 변환 결과) */
  solarDate: { year: number; month: number; day: number };
  lunarDate: { year: number; month: number; day: number; isLeapMonth: boolean };
  pillars: PillarSet;
  elements: ElementDistribution;
  tenGods: TenGodEntry[];
  relations: Relation[];
  daewoonStart: DaewoonStart;
  daewoon: DaewoonEntry[];
  seun: SeunEntry[];
  settings: CalcSettings & { longitudeUsed: number };
  time: TimeResolution;
  /** 판정이 불확실할 수 있는 상황 (코드) */
  warnings: ChartWarning[];
  /** warnings마다 화면에 보여 줄 안내 문구와 세부 데이터 */
  notices: ChartNotice[];
}

export type ChartWarning =
  | 'unknownTimeOnJieDay' // 시간 모름 + 절입일 출생: 년·월주가 바뀔 수 있음
  | 'nonexistentWallTime'
  | 'ambiguousWallTime';

export interface ChartNotice {
  code: ChartWarning;
  /** 안내 문구 (사업자 결정 2026-10-20 기본안, 문구는 바꿀 수 있음) */
  message: string;
  /** unknownTimeOnJieDay일 때: 그날의 절입과, 절입 전·후로 태어났을 때의 년·월주 */
  jie?: {
    name: string;
    /** 한국 시각 표기 'YYYY-MM-DD HH:mm' (그 시각의 tzdb 오프셋 기준) */
    localTime: string;
    ifBefore: { year: Pillar; month: Pillar };
    ifAfter: { year: Pillar; month: Pillar };
  };
}

export type EvidenceKind =
  | 'pillar'
  | 'dayMaster'
  | 'tenGod'
  | 'elementBalance'
  | 'relation'
  | 'daewoonDirection'
  | 'daewoon'
  | 'seun';

export interface Evidence {
  id: string;
  kind: EvidenceKind;
  /** 사람이 읽는 근거 설명 (차트 값만 담는다) */
  content: string;
  /** 근거가 된 SajuChart 필드 경로 */
  sourceFields: string[];
  chartRefs: ChartRef[];
  /** 이 근거에 등장하는 간지·십신 표기. 풀이문 검증(Phase 2)에 쓴다 */
  terms: string[];
}
