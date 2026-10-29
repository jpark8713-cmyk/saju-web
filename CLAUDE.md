@AGENTS.md

# 작업 규칙

## 포트 정리 (사용자 지시 2026-10-21)

- 개발·테스트 서버 포트(예: 3100, 3200)를 비울 때는 그 포트를 쓰는 프로세스만 종료한다.
  - 찾기: `netstat -ano | findstr :3100` (마지막 열이 PID)
  - 종료: Git Bash `taskkill //PID <PID> //F`, PowerShell `Stop-Process -Id <PID>`
- Node 프로세스 전체를 종료하는 명령은 쓰지 않는다. 예: `taskkill /IM node.exe`, `taskkill //F //IM node.exe`, `Stop-Process -Name node`, `pkill node`, `killall node`. 이 PC에서 돌고 있는 다른 Node 작업까지 꺼진다.
- 리뷰어 등 하위 에이전트에게 작업을 맡길 때도 이 규칙을 전달한다.

## 리뷰어를 동시에 돌릴 때 (사용자 지시 2026-10-21)

- 리뷰어마다 빌드 폴더와 포트를 따로 준다. 서로의 빌드 파일(.next)이 겹치면 타입 검사·화면 테스트 결과가 섞인다.
  - 빌드 폴더: `NEXT_DIST_DIR=.next-r1`, `NEXT_DIST_DIR=.next-r2` (tsconfig에 이 두 폴더의 타입 경로를 미리 넣어 두어 Next가 tsconfig를 고치지 않는다)
  - 포트: `PW_PORT=3300`(개발 서버 테스트), `PW_PORT=3400`(운영 빌드 테스트)처럼 리뷰어마다 다르게
  - 예: `NEXT_DIST_DIR=.next-r1 PW_PORT=3300 npx playwright test`, `NEXT_DIST_DIR=.next-r1 PW_PORT=3400 npx playwright test -c playwright.prod.config.ts`


## 개인정보 (사용자 지시 2026-10-29)

- 사용자 이메일 주소를 요청 헤더·URL·페이로드에 넣지 않는다(사용자가 명시적으로 요청한 경우만 예외).
