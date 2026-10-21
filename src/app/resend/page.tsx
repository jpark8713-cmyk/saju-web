// 화면 C: 링크 만료·재발송 (상단 "주문 조회"와 만료된 다운로드 링크가 이리로 온다)
import { Page } from '../../components/Page';
import { DOWNLOAD_LINK_TTL_TEXT } from '../../config/delivery';
import { ResendForm } from './ResendForm';

export default async function ResendPage(props: PageProps<'/resend'>) {
  const q = await props.searchParams;
  const expired = q.reason === 'expired';
  return (
    <Page testId="screen-resend">
      <h1 className="h1">링크 다시 받기</h1>
      {expired && (
        <div className="box" data-testid="link-expired">
          다운로드 링크가 만료됐거나 올바르지 않아요. 링크는 리포트가 완성된 날부터 {DOWNLOAD_LINK_TTL_TEXT} 동안 쓸 수 있고, 새 링크를 받으면 이전 링크는 쓸 수
          없어요. 기간 안이라면 주문번호와 주문할 때 입력한 이메일로 새 링크를 받을 수 있어요. {DOWNLOAD_LINK_TTL_TEXT}이 지나면 PDF·리포트·이메일 주소를
          삭제해서 다시 받을 수 없어요.
        </div>
      )}
      <ResendForm />
    </Page>
  );
}
