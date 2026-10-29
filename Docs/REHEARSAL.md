# 로컬 Docker 리허설 실행 순서

운영 이미지를 Docker Desktop이 있는 PC(데스크톱)에서 직접 돌려 보는 절차예요. NCP에 올리기 전에 무거운 확인을 여기서 끝내요. NCP에서 할 짧은 확인은 `Docs/deploy.md` 8-3이에요.

> **아직 한 번도 실행하지 않았어요.** 이 스크립트는 Docker가 없는 노트북에서 작성했어요(2026-10-29). 데스크톱에서 처음 돌릴 때 고칠 곳이 나올 수 있어요. 특히 "다른 경로로 복원" 단계는 확인하지 못했어요.

## 1. 준비 (데스크톱에서 한 번)

1. Docker Desktop을 켜고, Git Bash에서 `docker version`·`docker info`가 되는지 봐요.
2. 메모리가 빠듯하면 Docker Desktop 설정(Resources)이나 `%UserProfile%\.wslconfig`의 `memory=`로 Docker 상한을 4GB쯤으로 둬요.
3. 저장소를 받고(`git clone https://github.com/jpark8713-cmyk/saju-web.git`, 비공개 저장소라 접근 권한이 있는 GitHub 계정으로 로그인), 저장소 루트로 가요. 처음이면 `README.md`의 "새 PC에서 처음 시작하기"를 먼저 해요(이 리허설은 Node만 있으면 돼요. `npm ci`는 안 해도 돼요).
4. `cp .env.rehearsal.example .env.rehearsal` 후 `REFUND_ID_SECRET`(32자 이상, 만드는 명령은 파일 안에 있어요)을 채워요. 리포트·PDF까지 볼 거면 `LLM_API_KEY`도 넣어요. 이 파일은 커밋되지 않아요. 값은 대화창에 붙여 넣지 않아요.

## 2. 실행

```bash
# 기본: 빌드 → 시작 거부 6가지 → 예행 모드 → 주문·목 결제 → 백업·복원 (실제 AI 호출 없음, 비용 0)
bash scripts/rehearsal/local-rehearsal.sh

# 리포트·PDF까지: 실제 Claude API 1번(약 $0.25). 사업자에게 알리고 실행해요
ALLOW_AI_CALL=1 SKIP_BUILD=1 bash scripts/rehearsal/local-rehearsal.sh
```

- 옵션: `SKIP_BUILD=1`(이미 만든 이미지 사용), `KEEP=1`(끝나도 컨테이너·볼륨 유지), `HOST_PORT=3080`(브라우저로 볼 포트).
- 데스크톱의 Claude Code에게 맡길 때: "Docs/REHEARSAL.md대로 로컬 리허설을 실행하고 결과를 보고해 줘. AI 호출은 내 승인 뒤에." 처럼 부탁하면 돼요.
- 실행 중에 브라우저로 `http://localhost:3080`을 열면 화면 맨 위에 "리허설 서버 — 실제 결제 아님" 배너가 보여야 해요(`KEEP=1`로 실행하면 끝난 뒤에도 볼 수 있어요).

## 3. 무엇을 확인하나

| 단계 | 통과 기준 |
| --- | --- |
| 빌드 | 오류 없이 끝나요. 이미지 크기·빌드 시간이 `summary.txt`에 남아요. 빌드 중 메모리는 작업 관리자나 Docker Desktop 그래프로 같이 봐요 |
| 시작 거부 6가지 | 모두 "통과(거부됨)": NODE_ENV=development, NODE_ENV=test, 가짜 LLM(예행 모드여도), 예행 모드 없는 목 결제, 검수 전 주제, 예행 모드 + 실제 PG 키 |
| 예행 모드 실행 | `/api/health`가 `{"status":"ok","mode":"rehearsal"}`, 시작 직후 메모리 |
| 주문·목 결제 | 주문 → 결제 준비 → 목 결제창 승인 → 결제 확인까지 오류 없음 |
| (AI 허용 시) 생성·PDF | 생성 `done`, PDF가 `%PDF`로 시작하고 쪽수가 나와요(어른 주제 1개 기준). 컨테이너 안 Chromium과 한글 글꼴로 만들어져요. 결과 폴더의 PDF를 열어 글자가 깨지지 않았는지 봐요 |
| 백업·복원 | 백업 JSON에 표별 건수, `--check-only`가 `ok`, 다른 경로로 복원한 DB의 건수가 백업과 같아요 |

## 4. 결과

- `rehearsal-output/<시각>/summary.txt`(그리고 AI를 허용했으면 PDF)가 남아요. 이 폴더는 커밋되지 않아요.
- `summary.txt`의 내용(이미지 크기, 메모리, 각 단계 통과 여부)을 노트북 쪽 작업에 알려 주면 `Docs/deploy.md` 8-4(서버 사양)를 실측값으로 고쳐요.
- 실패하면 `docker logs saju-rehearsal`(KEEP=1일 때)과 `summary.txt`를 함께 봐요. 로그에는 설정 이름만 있고 값은 없어요.

## 5. 정리

기본으로 컨테이너와 볼륨은 지우고 이미지(`saju-web:rehearsal`)는 남겨요. 이미지도 지우려면 `docker image rm saju-web:rehearsal`.
