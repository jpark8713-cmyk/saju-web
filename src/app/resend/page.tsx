// 화면 C: 링크 만료·재발송 (상단 "주문 조회"와 만료된 다운로드 링크가 이리로 온다)
import { Page } from '../../components/Page';
import { ResendForm } from './ResendForm';

export default async function ResendPage(props: PageProps<'/resend'>) {
  const q = await props.searchParams;
  const expired = q.reason === 'expired';
  return (
    <Page testId="screen-resend">
      <h1 className="h1">링크 다시 받기</h1>
      {expired && (
        <div className="box" data-testid="link-expired">
          다운로드 링크가 만료됐거나 올바르지 않아요. 주문번호와 이메일을 입력하면 새 링크를 보내 드려요.
        </div>
      )}
      <ResendForm />
    </Page>
  );
}
