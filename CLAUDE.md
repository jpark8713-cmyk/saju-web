@AGENTS.md

# 작업 규칙

## 포트 정리 (사용자 지시 2026-10-21)

- 개발·테스트 서버 포트(예: 3100, 3200)를 비울 때는 그 포트를 쓰는 프로세스만 종료한다.
  - 찾기: `netstat -ano | findstr :3100` (마지막 열이 PID)
  - 종료: Git Bash `taskkill //PID <PID> //F`, PowerShell `Stop-Process -Id <PID>`
- Node 프로세스 전체를 종료하는 명령은 쓰지 않는다. 예: `taskkill /IM node.exe`, `taskkill //F //IM node.exe`, `Stop-Process -Name node`, `pkill node`, `killall node`. 이 PC에서 돌고 있는 다른 Node 작업까지 꺼진다.
- 리뷰어 등 하위 에이전트에게 작업을 맡길 때도 이 규칙을 전달한다.
