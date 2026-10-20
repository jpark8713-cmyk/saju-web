// 태어난 지역(선택) → 경도. 경도 보정(D-003)에만 쓴다. 비우면 동경 127°(서울) 기본값.
// 값은 각 도시 중심부의 대략적인 경도(소수 한 자리)다. 1°가 4분이므로 0.1° 오차는 약 24초다.

export interface Region {
  id: string;
  name: string;
  longitude: number;
}

export const REGIONS: readonly Region[] = Object.freeze([
  { id: 'seoul', name: '서울', longitude: 127.0 },
  { id: 'busan', name: '부산', longitude: 129.1 },
  { id: 'daegu', name: '대구', longitude: 128.6 },
  { id: 'incheon', name: '인천', longitude: 126.7 },
  { id: 'gwangju', name: '광주', longitude: 126.9 },
  { id: 'daejeon', name: '대전', longitude: 127.4 },
  { id: 'ulsan', name: '울산', longitude: 129.3 },
  { id: 'sejong', name: '세종', longitude: 127.3 },
  { id: 'suwon', name: '수원', longitude: 127.0 },
  { id: 'chuncheon', name: '춘천', longitude: 127.7 },
  { id: 'gangneung', name: '강릉', longitude: 128.9 },
  { id: 'cheongju', name: '청주', longitude: 127.5 },
  { id: 'jeonju', name: '전주', longitude: 127.1 },
  { id: 'pohang', name: '포항', longitude: 129.4 },
  { id: 'changwon', name: '창원', longitude: 128.7 },
  { id: 'jeju', name: '제주', longitude: 126.5 },
]);

export function findRegion(id: string): Region | undefined {
  return REGIONS.find((r) => r.id === id);
}
