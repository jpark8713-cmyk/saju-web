// 화면 2: 정보 입력
import { Page } from '../../components/Page';
import { InputForm } from './InputForm';

export default function InputPage() {
  return (
    <Page testId="screen-input">
      <h1 className="h1">정보 입력</h1>
      <InputForm />
    </Page>
  );
}
