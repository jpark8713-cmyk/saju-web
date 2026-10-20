// 사업자 정보 (모든 화면 하단 공통 푸터, PG·카카오페이 심사 확인 항목).
// TODO(owner): 서비스명, 한 줄 소개, 사업자 정보는 사업자가 확정한다(SPEC 10장). 그 전에는 자리 표시 문구를 보여 준다.

export const SERVICE = Object.freeze({
  name: '[서비스명]',
  tagline: '이 풀이가 왜 나왔는지, 내 사주 글자로 보여드립니다.',
});

export const BUSINESS = Object.freeze({
  companyName: '[상호]',
  representative: '[대표자]',
  registrationNumber: '[사업자등록번호]',
  mailOrderNumber: '[통신판매업 신고번호]',
  address: '[주소]',
  contact: '[연락처]',
});
