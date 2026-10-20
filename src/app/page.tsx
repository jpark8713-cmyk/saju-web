// 화면 1: 시작 화면. 문구는 SPEC 1-0장 기본안(사업자가 바꿀 수 있다).
import Link from 'next/link';
import { SERVICE } from '../config/business';
import { Page } from '../components/Page';

export default function StartPage() {
  return (
    <Page testId="screen-start">
      <header className="masthead">
        <div className="masthead-row">
          <h1 className="h1">{SERVICE.tagline}</h1>
          <div className="seal" aria-hidden="true">
            命
          </div>
        </div>
      </header>
      <ul className="sentences">
        <li>가입 없이, 필요한 주제만 골라 한 번에 결제해요. 충전이나 구독은 없어요.</li>
        <li>내 사주 원국(차트·오행·총평 첫 부분)은 무료로 먼저 볼 수 있어요.</li>
        <li>입력한 생년월일시는 풀이가 끝나면 삭제해요.</li>
        <li>풀이 문장마다 어느 글자를 보고 쓴 것인지 근거를 표시해요.</li>
      </ul>
      <Link href="/input" className="button" data-testid="start-button">
        무료로 내 사주 보기
      </Link>
      <p className="hint" style={{ margin: 0 }}>
        오락·참고용 풀이이며 의료·투자·법률 판단을 대신하지 않습니다.
      </p>
    </Page>
  );
}
