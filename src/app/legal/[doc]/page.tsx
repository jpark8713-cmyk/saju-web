// 약관·환불 규정·개인정보 처리방침 (자리 표시). 문구는 사업자가 법적 검토 후 확정한다(TODO(owner), SPEC 1-3장).
import { notFound } from 'next/navigation';
import { Page } from '../../../components/Page';
import { BUSINESS, SERVICE } from '../../../config/business';
import { REFUND_POLICY_SUMMARY, RETENTION_POLICY } from '../../../config/legal';

const DOCS = {
  terms: {
    title: '이용약관',
    lines: [
      `${SERVICE.name}(이하 "서비스")는 입력한 생년월일시로 사주를 계산하고 풀이 리포트를 제공해요.`,
      '풀이는 오락·참고용이며 의료·투자·법률 판단을 대신하지 않아요.',
      '결제는 리포트 한 건 단위이며 충전·구독 상품은 없어요.',
      '[약관 본문은 사업자가 확정한 뒤 이 자리에 들어갑니다.]',
    ],
  },
  refund: { title: '환불 규정', lines: [...REFUND_POLICY_SUMMARY, '[세부 조건은 법적 검토 후 확정합니다.]'] },
  privacy: {
    title: '개인정보 처리방침',
    lines: [
      '수집 항목: 생년월일시·성별(필수), 이름·태어난 지역(선택), 이메일(이메일 받기·환불 요청 시)',
      '이용 목적: 사주 계산과 리포트 작성, 리포트 전달, 환불 안내',
      ...RETENTION_POLICY,
      `문의: ${BUSINESS.contact}`,
    ],
  },
} as const;

export function generateStaticParams() {
  return Object.keys(DOCS).map((doc) => ({ doc }));
}

export default async function LegalPage(props: PageProps<'/legal/[doc]'>) {
  const { doc } = await props.params;
  const d = DOCS[doc as keyof typeof DOCS];
  if (!d) notFound();
  return (
    <Page testId={`screen-legal-${doc}`}>
      <h1 className="h1">{d.title}</h1>
      <ul className="sentences" style={{ listStyle: 'disc', paddingLeft: 18 }}>
        {d.lines.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
    </Page>
  );
}
