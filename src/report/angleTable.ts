// 풀이 각도 표 (사업자 승인 2026-10-22, 시안 2판, D-047). 화면 번들에서도 쓰는 순수 데이터다(해시 계산은 llm/angles.ts).
// - 오행 표: 오행 개수·올해·내년·대운 문장에만 쓴다. 묶음 표: 십신(뜻 묶음) 문장에만 쓴다. 한 문장에서 섞지 않는다.
// - 12세 이하는 부분집합을 쓴다(아래 CHILD_GROUP_ANGLES). 오행 표는 아이도 네 가지를 그대로 쓰고 아이 모습으로 푼다.
import type { TenGodGroupId } from '../config/topics';
import type { Element } from '../engine/types';

export interface Angle {
  /** 각도 이름 (사실 카드에 보여 준다) */
  name: string;
  /**
   * 사람이 읽는 설명(그 각도가 가리키는 생활 장면). 프롬프트에는 넣지 않는다:
   * 6차 측정에서 모델이 장면 문구를 문장에 그대로 옮겨 리포트끼리 겹쳤다(D-048)
   */
  scene: string;
}

// D-048: 기운·묶음마다 6가지로 늘렸다(각 표의 뒤 두 줄이 새로 넣은 각도). 4가지일 때 같은 칸에서 같은 각도가 자주 겹쳤다
export const ELEMENT_ANGLES: Readonly<Record<Element, readonly Angle[]>> = Object.freeze({
  wood: [
    { name: '성장·자람', scene: '꾸준히 커 가는 힘, 조금씩 늘어나는 것' },
    { name: '싹틈·첫걸음', scene: '새로 시작하는 때, 처음 해 보는 시도' },
    { name: '뻗어 감·넓힘', scene: '관심을 넓히기, 새 분야를 알아보기' },
    { name: '곧게 섬·방향 잡기', scene: '갈 길을 정하기, 앞날을 그려 보기' },
    { name: '생기·싱그러움', scene: '기운이 살아나고 새로워지는 느낌' },
    { name: '휘어 감·유연함', scene: '꺾이지 않고 휘어서 버티는 힘' },
  ],
  fire: [
    { name: '드러냄·열기', scene: '생각과 마음을 겉으로 꺼내기' },
    { name: '달아오름·의욕', scene: '의욕이 오르는 때, 몸과 마음의 온도' },
    { name: '어울림·만남', scene: '사람들과 함께하는 자리(특정 인물 없이)' },
    { name: '환히 비춤·알림', scene: '알리고 보여 주기, 눈에 띄는 일' },
    { name: '따뜻함·온기', scene: '곁을 데우는 다정함' },
    { name: '번져 감·퍼짐', scene: '한 가지가 여러 곳으로 퍼져 나가기' },
  ],
  earth: [
    { name: '터전·자리 잡음', scene: '익숙한 자리, 생활의 바탕' },
    { name: '버팀·오래 감', scene: '하던 일을 이어 가기, 견디는 힘' },
    { name: '가운데 섬·조율', scene: '여러 일 사이에서 균형을 잡기' },
    { name: '품음·쌓아 둠', scene: '있는 그대로 담아 두고 모으기' },
    { name: '넉넉함·너그러움', scene: '여유 있게 받아 주는 마음' },
    { name: '거둠·갈무리', scene: '해 온 것을 거두어 정리하기' },
  ],
  metal: [
    { name: '정돈·결단', scene: '필요 없는 것을 덜고 결정을 내리기' },
    { name: '다듬음·덜어 냄', scene: '모양을 고르고 군더더기를 빼기' },
    { name: '맺음·끝맺기', scene: '마무리 짓기, 미뤄 둔 일을 닫기' },
    { name: '단단함·굳힘', scene: '흔들리지 않게 다잡는 힘' },
    { name: '선 긋기·분명함', scene: '할 것과 안 할 것을 가르기' },
    { name: '곧은 말·바른 소리', scene: '돌려 말하지 않고 바로 말하기' },
  ],
  water: [
    { name: '궁리·깊은 생각', scene: '곰곰이 따져 보기, 생각을 깊게 하기' },
    { name: '스며듦·맞춰 감', scene: '상황에 맞춰 바꾸기, 부드럽게 따라가기' },
    { name: '쉼·가라앉힘', scene: '멈추어 쉬기, 마음을 가라앉히기' },
    { name: '헤아림·때 고르기', scene: '주변을 헤아리고 알맞은 때를 고르기' },
    { name: '흘러 감·막힘 풀기', scene: '막힌 것을 돌아 흘러가게 하기' },
    { name: '고요함·속 깊음', scene: '겉보다 속이 깊은 마음' },
  ],
});

export const GROUP_ANGLES: Readonly<Record<TenGodGroupId, readonly Angle[]>> = Object.freeze({
  bigeop: [
    { name: '스스로 해내기', scene: '제 힘으로 해 보려는 마음' },
    { name: '내 몫 지키기', scene: '자기 것과 자기 자리를 챙기기' },
    { name: '견주며 힘 얻기', scene: '남과 비교하며 의욕을 내기' },
    { name: '자기 속도', scene: '남이 아니라 제 박자로 가기' },
    { name: '나란히 걷기', scene: '비슷한 사람들 사이에서 함께 가기' },
    { name: '내 뜻 세우기', scene: '제 생각을 분명히 세우기' },
  ],
  siksang: [
    { name: '말과 글로 꺼내기', scene: '생각을 표현하는 힘' },
    { name: '손으로 만들기', scene: '손재주, 직접 만들어 보이기' },
    { name: '재능을 일로 잇기', scene: '잘하는 것을 쓸모 있게 하기' },
    { name: '즐거움·여유', scene: '좋아하는 일에서 얻는 기쁨' },
    { name: '새롭게 꾸미기', scene: '있는 것을 새 모양으로 바꿔 보기' },
    { name: '궁금한 것 파고들기', scene: '관심 가는 것을 깊이 알아보기' },
  ],
  jaeseong: [
    { name: '직접 움직이기', scene: '몸을 움직여 결과를 만들기' },
    { name: '실속 챙기기', scene: '쓸모와 이익을 따져 보기' },
    { name: '기회 알아보기', scene: '새 일감을 찾아 나서기' },
    { name: '살림·관리', scene: '가진 것을 고르게 다루기' },
    { name: '부지런히 굴리기', scene: '쉬지 않고 일을 돌려 가기' },
    { name: '쓸 곳 가리기', scene: '쓸 데와 아낄 데를 가르기' },
  ],
  gwanseong: [
    { name: '틀과 기준', scene: '정해진 틀 안에서 안정을 느끼기' },
    { name: '맡은 몫', scene: '맡은 일을 끝까지 해내기' },
    { name: '꾸준한 순서', scene: '반복되는 순서와 일과' },
    { name: '믿음 주기', scene: '주변이 기대는 든든함' },
    { name: '이름 걸고 하기', scene: '자기 이름에 부끄럽지 않게 하기' },
    { name: '절제·삼가기', scene: '하고 싶어도 한발 물러서기' },
  ],
  inseong: [
    { name: '받아들이기', scene: '새것을 받아들이고 익히기' },
    { name: '돌보기', scene: '곁을 살피고 챙기기' },
    { name: '기댈 곳', scene: '도움을 받고 힘을 얻는 자리' },
    { name: '준비·채움', scene: '미리 채워 두고 대비하기' },
    { name: '차근차근 익히기', scene: '서두르지 않고 몸에 붙이기' },
    { name: '물려받은 것 살리기', scene: '이어받은 것을 바탕으로 삼기' },
  ],
});

/**
 * 합·충 각도(D-048). 서로 묶이는·부딪치는 관계를 행동 제안이 아니라 성향·모습으로 풀 때의 방향.
 * 원국 안의 합·충(relation.*)과 그해 글자와의 합·충(세운 근거) 문장에 쓴다.
 */
export const RELATION_ANGLES: Readonly<Record<'combine' | 'clash', readonly Angle[]>> = Object.freeze({
  combine: [
    { name: '어울려 하나 되기', scene: '어울려 하나가 되는 힘' },
    { name: '서로 끌어당김', scene: '떨어져 있던 것이 가까워지는 힘' },
    { name: '합쳐 새 힘 내기', scene: '둘이 합쳐 다른 기운을 키우기' },
    { name: '맞물려 이어짐', scene: '앞뒤가 맞물려 이어지는 흐름' },
    { name: '누그러져 부드러워짐', scene: '날이 서 있던 것이 무뎌지기' },
    { name: '한데 모여 커짐', scene: '흩어진 힘이 모여 커지기' },
  ],
  clash: [
    { name: '부딪치며 바뀜', scene: '부딪치며 변화를 만드는 힘' },
    { name: '흔들어 깨움', scene: '익숙한 것이 흔들려 새로 보이기' },
    { name: '엇갈리며 새 길', scene: '엇갈린 끝에 다른 길이 보이기' },
    { name: '팽팽한 긴장', scene: '양쪽이 맞서 힘이 실리는 상태' },
    { name: '자극·움직임', scene: '가만있던 것이 움직이게 되는 자극' },
    { name: '자리 바꿈', scene: '있던 자리를 옮기는 힘' },
  ],
});

/**
 * 월·연 칸 프롬프트에 넣는 합·충 각도의 뜻 설명(D-052 3단계). 각도 이름 대신 넣는다:
 * 실측에서 이름을 문장에 그대로 옮겼다("부딪치며 바뀌듯", "합쳐 새 힘을 내듯"). 이름의 낱말을 쓰지 않고 가리키는 쪽만 적었다
 */
export const RELATION_ANGLE_MEANINGS: Readonly<Record<string, string>> = Object.freeze({
  '어울려 하나 되기': '주변과 잘 섞이는 쪽',
  '서로 끌어당김': '거리가 가까워지는 쪽',
  '합쳐 새 힘 내기': '둘이 더해져 다른 힘이 생기는 쪽',
  '맞물려 이어짐': '앞뒤가 끊기지 않는 쪽',
  '누그러져 부드러워짐': '날 선 것이 무뎌지는 쪽',
  '한데 모여 커짐': '흩어진 것이 모이는 쪽',
  '부딪치며 바뀜': '변화가 생기는 쪽',
  '흔들어 깨움': '익숙한 것이 새로 보이는 쪽',
  '엇갈리며 새 길': '다른 길이 보이는 쪽',
  '팽팽한 긴장': '양쪽이 맞서 힘이 실리는 쪽',
  '자극·움직임': '가만있던 것이 움직이는 쪽',
  '자리 바꿈': '하던 방식을 달리해 보는 쪽',
});

/** 12세 이하 묶음 각도 부분집합. 없는 묶음은 표 전체를 그대로 쓴다 */
export function childGroupAngles(group: TenGodGroupId, toddler: boolean): readonly Angle[] {
  const all = GROUP_ANGLES[group];
  const pick = (names: readonly string[]) => all.filter((a) => names.includes(a.name));
  switch (group) {
    case 'jaeseong':
      // "물건 다루기"는 살림·관리 대신 둔 아이용 각도(6세 이상은 용돈 포함)
      return [all[0]!, { name: '물건 다루기', scene: toddler ? '물건을 아끼고 나누기' : '물건을 아끼고 나누기, 용돈 다루기' }];
    case 'siksang':
      return all.filter((a) => a.name !== '재능을 일로 잇기');
    case 'gwanseong':
      return toddler ? pick(['꾸준한 순서']) : pick(['맡은 몫', '꾸준한 순서']);
    case 'bigeop':
      // D-048: 만 5세 이하에게 "남과 비교하며 의욕을 내기"는 맞지 않는다
      return toddler ? all.filter((a) => a.name !== '견주며 힘 얻기') : all;
    default:
      return all;
  }
}

/** 리포트 본문에 저장하는 각도 기록: 칸마다 기운·묶음·관계별 각도 이름, 슬롯별로 쓸 수 있는 각도 목록 */
export interface ReportAngles {
  /** 칸 키(summary, traits, topic:wealth, daewoon:0, thisYear …) → 슬롯(earth, gwanseong, combine …) → 각도 이름 */
  bySection: Record<string, Record<string, string>>;
  /** 슬롯 → 이 리포트에서 쓸 수 있는 각도 이름(사실 카드의 "뜻 전체") */
  options: Record<string, string[]>;
}
