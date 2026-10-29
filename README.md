# saju-web

근거가 보이는 사주 리포트 웹서비스예요. 생년월일시를 넣으면 만세력 엔진이 사주 차트를 계산하고, Claude가 차트의 근거를 붙여 풀이를 써요. 결제하면 리포트를 화면·PDF·이메일 링크로 받아요.

- 스펙: [`SAJU_SPEC.md`](SAJU_SPEC.md)
- 결정 기록: [`Docs/decisions.md`](Docs/decisions.md) (D-001~)
- 운영 배포(NCP·Docker·nginx·백업): [`Docs/deploy.md`](Docs/deploy.md)
- 출시 전 할 일: [`Docs/LAUNCH_CHECKLIST.md`](Docs/LAUNCH_CHECKLIST.md)
- 화면 디자인 기준: [`DESIGN.md`](DESIGN.md)
- 로컬 Docker 리허설: [`Docs/REHEARSAL.md`](Docs/REHEARSAL.md)

## 새 PC에서 처음 시작하기

1. **설치:** Git, Node.js 26.13.0(`Dockerfile`의 `FROM`과 같은 버전, nodejs.org 공식 설치 파일). Docker 리허설을 할 PC라면 Docker Desktop(WSL 2)도요.
2. **저장소 받기:** `git clone <비공개 저장소 주소>` → 저장소 폴더로 이동.
3. **의존성:** `npm ci` → `npx playwright install chromium`(PDF·화면 테스트용).
4. **환경 설정:** `cp .env.example .env` 후 필요한 값만 채워요(아래 "환경 변수"). 비용 없이 돌리려면 `ENABLE_FAKE_LLM=true`, `PAYMENT_PROVIDER=mock`. 비밀값(API 키 등)은 `.env`에만 두고 커밋하지 않아요(`.gitignore`가 `.env`, `.env.*`, `samples-output/`, `node_modules/`를 빼요).
5. **테스트:** `npm run typecheck` → `npm test` → `npm run e2e`(포트 3100) → `npm run e2e:prod`(포트 3200). 다른 작업이 그 포트를 쓰면 `PW_PORT`와 `NEXT_DIST_DIR`를 바꿔요(`CLAUDE.md`).
6. **실행:** `npm run dev` → http://localhost:3000.
7. 이 PC에만 있는 것: 실제 풀이 샘플(`samples-output/`)과 `.env` 값은 저장소에 없어요. 필요하면 따로 옮기거나 다시 만들어요(샘플 생성은 유료, `npm run measure:cost`).

## 진행 상황

| Phase | 내용 | 상태 |
|-------|------|------|
| 1 | 사주 계산 엔진과 교차검증 (`src/engine`) | 완료 |
| 2 | LLM 풀이 생성·검수·비용 측정 (`src/llm`) | 완료 (D-024) |
| 3 | 웹 화면 (`src/app`) | 완료 |
| 4 | 결제(목 어댑터)·환불 접수·SQLite·배포 구성 | 완료 (D-032). 실제 PG 연동은 사업자·PG 답변 뒤 |
| 5 | 결과물 전달(PDF 저장·이메일 링크·재발송·보관 기간 정리) | 완료 (D-035·D-036). 실제 메일 서비스 연동은 서비스명·도메인 확정 뒤 |

## 준비물

- **Node.js 26.13.0.** 내장 SQLite(`node:sqlite`)를 써요. 운영 이미지(`Dockerfile`)도 같은 버전이에요(D-060).
- **Chromium (Playwright):** PDF 생성과 화면 테스트에 필요해요.
  ```bash
  npx playwright install chromium
  ```
- 이 프로젝트의 Next.js는 16.3.8이에요. 예전 버전과 API가 달라요. 코드를 고치기 전에 `node_modules/next/dist/docs/`를 확인해 주세요(`AGENTS.md`).

## 설치

```bash
npm ci
npx playwright install chromium
cp .env.example .env   # 값을 채워요(아래 표). .env는 커밋하지 않아요
```

## 환경 변수

전체 목록과 설명은 [`.env.example`](.env.example)에 있어요. 운영에서 필요한 값은 `Docs/deploy.md` 2장을 봐 주세요.

| 이름 | 로컬 개발 | 운영 | 설명 |
|------|-----------|------|------|
| `LLM_API_KEY` | 실제 풀이를 만들 때만 | 필수 | Claude API 키 |
| `LLM_MODEL` | 선택 | 선택 | 비우면 `claude-sonnet-5-5` (D-021) |
| `ENABLE_FAKE_LLM` | `true` 권장 | **넣지 않음** | 정해진 문장을 돌려주는 가짜 LLM이에요. 비용이 들지 않아요. 개발 서버에서만 켜져요. 운영 빌드에 들어 있으면 서버가 시작하지 않아요(D-058) |
| `DATABASE_URL` | 선택 | 필수 | 예: `file:./data/saju.db`. 비우면 메모리 저장소예요. 서버를 끄면 데이터가 사라지고, 운영에서는 시작하지 않아요 |
| `DB_REQUIRE_VOLUME` | 비움 | 이미지에 고정 | DB 폴더가 Docker 볼륨이 아니면 시작하지 않아요 |
| `PAYMENT_PROVIDER` | `mock` | 실제 PG 연동 전까지 없음 | 목 결제는 개발 서버와 운영 빌드의 예행 모드(`REHEARSAL_MODE=1`)에서만 돼요. 그 밖의 운영 빌드에서 `mock`이면 시작하지 않아요(D-058) |
| `REHEARSAL_MODE` | 비움 | 예행 연습 때만 `1` | 화면 위 "리허설 서버" 배너, `/api/health`의 `mode: rehearsal`. 출시 전에 지워요(D-058) |
| `PAYMENT_METHODS_ENABLED` | `kakaopay` | `kakaopay` | 켤 결제 수단(쉼표로 구분) |
| `APP_ORIGIN` | 선택 | 필수 | 서비스 주소. PDF 생성과 결제 복귀 주소에 써요 |
| `REFUND_ID_SECRET` | 선택 | 필수 | 환불 접수번호 HMAC 키(32자 이상) |
| `TRUST_PROXY` | 비움 | `true` | 앞단 nginx가 `X-Real-IP`를 넣을 때만 켜요 |
| `EMAIL_PROVIDER` | `console` | 미정 (D-033) | `console`은 메일을 보내지 않고 개발용 보관함(`/api/dev/outbox`)에 넣어요 |
| `DATAGOKR_API_KEY` | 선택 | 쓰지 않음 | 천문연 절기 기준 데이터를 다시 받을 때만 써요(`npm run fetch:kasi`) |

운영 빌드(`next build` → `next start`)에서는 목 결제(예행 모드 제외), 가짜 LLM, 콘솔 메일, 개발용 보관함이 모두 꺼져요. 운영 빌드인지는 실행 때의 `NODE_ENV`가 아니라 빌드 때 정해져요(D-058).

## 로컬 실행

```bash
# 개발 서버 (http://localhost:3000)
# .env에 PAYMENT_PROVIDER=mock, ENABLE_FAKE_LLM=true를 두면 결제부터 리포트까지 비용 없이 끝까지 돌려 볼 수 있어요
npm run dev

# 운영 빌드로 실행
npm run build
npm start
```

- 운영 빌드는 개발용 값을 받아 주지 않아요(D-058). `.env`에 `ENABLE_FAKE_LLM`이 있거나, `PAYMENT_PROVIDER=mock`인데 `REHEARSAL_MODE=1`이 없거나, 검수(`reviewed`) 전 주제가 판매 중이면 `npm start`가 `[시작 점검]` 메시지를 남기고 멈춰요. 운영 빌드 확인은 보통 `npm run e2e:prod`(값을 알아서 맞춰 띄워요)로 해요.

- 결제 화면에서 결제하면 목 결제창(`/dev/mock-pg`)이 열려요. 결제 성공, 실패, "결제 성공 후 생성 실패"를 골라 흐름을 확인할 수 있어요.
- 이메일 링크는 `/api/dev/outbox`(개발 전용)에서 확인해요.

## 테스트

```bash
npm run typecheck    # 타입 검사 (tsc --noEmit)
npm test             # 단위·통합 테스트 (vitest): 엔진·풀이·저장소·결제·전달·정리
npm run e2e          # 화면 테스트 (Playwright, 개발 서버 3100번 포트, 임시 SQLite)
npm run e2e:prod     # 운영 빌드 화면 테스트 (next build + next start, 3200번 포트)
```

- 테스트는 가짜 LLM과 목 결제를 써서 비용이 들지 않아요.
- `npm run measure:cost`는 **실제 Claude API를 호출해 요금이 나가요.** 꼭 필요할 때만 돌려요(D-019).
- 여러 사람(또는 리뷰어)이 동시에 화면 테스트를 돌릴 때는 빌드 폴더와 포트를 나눠요(`CLAUDE.md`):
  ```bash
  NEXT_DIST_DIR=.next-r1 PW_PORT=3300 npx playwright test
  NEXT_DIST_DIR=.next-r1 PW_PORT=3400 npx playwright test -c playwright.prod.config.ts
  ```
- 포트를 비울 때는 그 포트를 쓰는 프로세스만 종료해요. Node 전체를 끄는 명령은 쓰지 않아요(`CLAUDE.md`).
  ```bash
  netstat -ano | findstr :3100      # 마지막 열이 PID
  taskkill //PID <PID> //F          # Git Bash
  ```

## 문제 해결

- **개발 서버에서 계산이 모두 실패할 때:** 화면 3이 "서버에서 계산하지 못했어요"를 보여 주고 서버 로그에 `os error 1224`(파일 쓰기 실패)가 보이면, 입력값 문제가 아니라 개발 서버 빌드 캐시가 잠긴 거예요. 그 포트의 개발 서버만 끄고(`netstat -ano | findstr :<포트>` → `taskkill //PID <PID> //T //F`) 다시 띄워 주세요. 윈도에서는 개발 서버가 떠 있는 동안 소스 파일을 고치면 생길 수 있어서, 화면을 직접 확인할 때는 수정을 마친 뒤 서버를 새로 띄우는 게 안전해요(D-040).
- **버튼이 계속 꺼져 있을 때:** 버튼 아래에 빠진 항목이 문장으로 나와요. "화면을 불러오는 중이에요"가 계속 보이면 화면 스크립트가 붙지 않은 거라 새로고침해 주세요(D-038).

## 관리 스크립트

| 명령 | 하는 일 |
|------|---------|
| `npm run admin -- …` | 환불 조회·처리, 멈춘 생성 복구 (`Docs/deploy.md` 6장) |
| `npm run db:backup` / `db:restore` / `db:prune` | SQLite 백업·복원·오래된 사본 정리 (`Docs/deploy.md` 5장) |
| `npm run db:purge` | 보관 기간이 지난 PDF·리포트·이메일 정리. 운영에서는 매시간 백업 전에 자동으로 돌아요 |

## 폴더 구조

```
src/engine     사주 계산 엔진 (만세력, 오행, 십신, 대운·세운, 근거)
src/llm        풀이 생성, 검증, AI 검수, Claude 호출
src/app        Next.js 화면과 API 라우트
src/report     리포트 화면·PDF 공통 구성
src/orders     주문·생성·리포트 접근
src/payments   결제 어댑터 (목 구현)
src/admin      환불 처리 등 관리 기능
src/delivery   PDF 저장, 이메일 링크, 재발송, 보관 기간 정리
src/store      저장소 (메모리·SQLite, 같은 계약 테스트)
src/config     가격·주제·결제 수단·보관 기간·법적 문구 설정
scripts        관리·백업·측정 스크립트
deploy         nginx, 백업 타이머, 복원 스크립트
tests          engine / llm / web(vitest), e2e(Playwright)
```
