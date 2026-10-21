# 배포 절차 (NCP, Phase 4)

> 상태: 설정 파일과 절차를 준비했다. 이 PC에 Docker가 없어 이미지 빌드와 서버에서의 실행은 아직 확인하지 못했다.
> 확인한 것: `next build`, 운영 모드 실행(SQLite), 설정이 빠졌을 때 시작을 멈추는 동작, 백업·복원 스크립트(로컬 파일), 셸 스크립트 문법.
> 실제 PG 연동은 하지 않았다. 운영 환경에서는 결제하기 버튼이 꺼져 있다.

## 1. 구성

| 구성 요소 | 내용 |
| --- | --- |
| 서버 | NCP Server(Ubuntu 22.04 이상) 1대. Docker, nginx, aws CLI 설치 |
| 앱 | `Dockerfile`로 만든 이미지 1개(Node 26.7.0, 포트 3000) |
| DB | SQLite 파일 `/data/saju.db`. `/data`는 Docker 볼륨(서버의 `/srv/saju/data`)이어야 한다(D-030) |
| 백업 | 매시간 온라인 백업 → NCP Object Storage(`deploy/backup-hourly.sh`, systemd 타이머) |
| 앞단 | nginx: HTTPS 종료, IP별 속도 제한, 본문 64KB 상한, `X-Real-IP` 덮어쓰기(`deploy/nginx.conf`) |
| PDF | 이미지 안의 헤드리스 Chromium(Playwright 1.63.0)과 Noto 글꼴(D-025) |

## 2. 환경변수

| 이름 | 운영 | 설명 |
| --- | --- | --- |
| `NODE_ENV` | `production` (이미지에 고정) | 개발 전용 기능(목 결제, 가짜 LLM)은 development·test에서만 켜진다 |
| `DATABASE_URL` | `file:/data/saju.db` (이미지 기본값) | 없으면 서버가 시작하지 않는다 |
| `DB_REQUIRE_VOLUME` | `true` (이미지에 고정) | DB 폴더가 컨테이너 볼륨이 아니면 서버가 시작하지 않는다 |
| `APP_ORIGIN` | **필수** | 서비스 주소(예: `https://example.com`). PDF 생성기와 결제창 복귀 주소가 이 값만 쓴다. 없으면 서버가 시작하지 않는다 |
| `REFUND_ID_SECRET` | **필수** | 환불 접수번호 HMAC 키, 32자 이상 임의 문자열. 바꾸면 같은 입력의 접수번호가 달라진다. 없으면 서버가 시작하지 않는다 |
| `TRUST_PROXY` | **필수** (`true`) | nginx가 `X-Real-IP`를 덮어쓰는 구성에서 켠다. 안 켜면 앱은 모든 요청을 한 IP로 세고, 시작할 때 경고를 남긴다 |
| `LLM_API_KEY` | 필수 | Claude API 키 |
| `LLM_MODEL` | 선택 | 비우면 `claude-sonnet-5-5`(D-021) |
| `PAYMENT_PROVIDER` | PG 계약 뒤 | `mock`은 운영에서 동작하지 않는다. 실제 PG 어댑터는 별도 Phase |
| `PAYMENT_METHODS_ENABLED` | 선택 | 켤 결제 수단(쉼표 구분). 기본 `kakaopay` |
| `PAYMENT_CLIENT_KEY`, `PAYMENT_SECRET_KEY` | PG 계약 뒤 | PG 키 |
| `EMAIL_PROVIDER`, `EMAIL_API_KEY`, `EMAIL_FROM` | Phase 5 | 메일 발송 |
| `STORAGE_PROVIDER`, `STORAGE_BUCKET`, `DOWNLOAD_TOKEN_TTL_DAYS` | Phase 5 | PDF 저장소·링크 만료 |
| `ENABLE_FAKE_LLM` | 쓰지 않음 | 개발·테스트 전용 |
| `DATAGOKR_API_KEY` | 쓰지 않음 | 천문연 대조 fixture 생성용 |

비밀값은 서버의 환경 파일(`/etc/saju/app.env`, 권한 600)에만 둔다. 백업 업로드용 Object Storage 인증키는 따로 `/etc/saju/backup.env`(권한 600)에 둔다(5장). 둘 다 저장소에 넣지 않는다.

## 3. 처음 설치

1. 서버 준비: Docker, nginx, certbot, aws CLI 설치. 방화벽은 80·443만 연다(3000은 서버 안에서만).
2. 데이터 폴더: `sudo mkdir -p /srv/saju/data && sudo chown 1000:1000 /srv/saju/data` (이미지의 실행 사용자 `node`가 uid 1000이다).
3. 이미지 빌드: `docker build -t saju-web:<버전> . && docker tag saju-web:<버전> saju-web:current`
4. 환경 파일 작성: 2장의 운영 필수 값.
5. 실행:
   ```bash
   docker run -d --name saju-web --restart unless-stopped \
     --env-file /etc/saju/app.env \
     -v /srv/saju/data:/data \
     -p 127.0.0.1:3000:3000 saju-web:current
   ```
   `-v /srv/saju/data:/data`를 빼면 서버가 시작하지 않는다(볼륨 검사). 컨테이너를 지우고 다시 만들어도 DB는 `/srv/saju/data/saju.db`에 남는다.
6. nginx: `deploy/nginx.conf`를 `/etc/nginx/conf.d/saju.conf`로 두고 도메인·인증서를 바꾼다. 프록시 공통 설정(파일 끝 주석)은 `/etc/nginx/saju-proxy.conf`로 만든다.
   - IP별 속도 제한: API 전체 초당 10번(순간 20번), 환불 접수 분당 6번(순간 5번). IPv6는 앞 64비트로 묶어 센다.
   - 본문 상한 64KB(`client_max_body_size 64k`).
7. 백업 타이머: 5장.
8. 확인: 시작 화면, 입력 → 미리보기, 결제 화면(결제하기 꺼짐, "결제 연동을 준비하고 있어요"), 약관 3종, `/dev/mock-pg`가 404인지, `docker logs saju-web`에 `[시작 점검]` 오류가 없는지.

## 4. 업데이트와 되돌리기

- 업데이트: 새 이미지를 빌드해 `saju-web:current`로 태그한 뒤 `docker stop saju-web && docker rm saju-web` 하고 3장 5번으로 다시 띄운다. 직전에 5장의 수동 백업을 한 번 한다.
- 되돌리기: 이전 버전 태그로 다시 띄운다. 새 버전이 DB 구조를 바꿨다면 5장 복원으로 업데이트 직전 백업을 되살린다.
- 서버를 다시 켜면 시작 점검이 남아 있던 "생성 중" 주문을 모두 실패로 바꾼다. 고객은 화면 B에서 다시 시도하거나 환불 요청을 할 수 있다.

## 5. 백업과 복원 (D-030 필수 조건)

### 매시간 백업 → NCP Object Storage

- `deploy/backup-hourly.sh`가 컨테이너 안에서 `npm run db:backup`(SQLite 온라인 백업)으로 일관된 사본을 만든다. 서버를 멈추지 않는다.
- 사본을 열어 무결성 검사와 표 확인을 마친 뒤 Object Storage에 올린다. 올린 크기도 확인한다.
- 설치:
  1. NCP 콘솔에서 Object Storage 버킷을 만든다. 버킷 수명 주기 규칙으로 보관 기간을 정한다(TODO(owner): 보관 기간. 제안: 시간별 백업 7일, 그중 매일 0시 백업 90일).
  2. Object Storage 권한만 가진 API 인증키를 만든다.
  3. `/etc/saju/backup.env`(권한 600):
     ```
     BACKUP_BUCKET=<버킷 이름>
     AWS_ACCESS_KEY_ID=<NCP Access Key>
     AWS_SECRET_ACCESS_KEY=<NCP Secret Key>
     ```
     엔드포인트 기본값은 `https://kr.object.ncloudstorage.com`이다. 리전이 다르면 `OBJECT_STORAGE_ENDPOINT`로 바꾼다(NCP 콘솔의 버킷 정보에서 확인).
  4. 저장소를 `/opt/saju`에 두고 `deploy/saju-backup.service`·`deploy/saju-backup.timer`를 `/etc/systemd/system/`에 복사한다.
  5. `sudo systemctl daemon-reload && sudo systemctl enable --now saju-backup.timer`
  6. 확인: `sudo systemctl start saju-backup.service && journalctl -u saju-backup.service -n 20` → "백업 완료"가 나오고 버킷에 파일이 생기는지 본다.
- 서버에는 최근 24개만 남긴다(`/srv/saju/data/backups`).
- 매시간 백업이므로 사고가 나면 최대 1시간 분량의 주문·환불 기록을 잃을 수 있다. 잃은 결제는 PG 관리 화면의 결제 내역으로 확인해 대조한다.

### 복원

1. 복원할 백업을 고른다: `aws --endpoint-url https://kr.object.ncloudstorage.com s3 ls s3://<버킷>/saju/sqlite/`
2. `sudo -E bash -c 'set -a; . /etc/saju/backup.env; set +a; /opt/saju/deploy/restore.sh saju/sqlite/<파일 이름>'`
   - 먼저 백업 파일만 확인한다(무결성, 표 5개). 실패하면 서버를 멈추지 않고 끝난다.
   - 웹 서버를 멈추고 바꿔 넣은 뒤 다시 켠다. 원래 DB는 `/srv/saju/data/saju.db.before-restore-<시각>`으로 남는다.
3. 복원 뒤 확인:
   - `docker logs saju-web`에 `[시작 점검]` 오류가 없는지(멈춘 생성 주문 복구 건수는 나올 수 있다).
   - `docker exec saju-web npm run -s admin -- refunds list`가 동작하는지.
   - 백업 시각 이후 결제가 있었는지 PG 관리 화면에서 확인하고, 빠진 주문은 고객 문의·환불로 처리한다.
- 복원 테스트: `tests/web/store.test.ts`의 "백업과 복원"(DB를 잃은 뒤 백업으로 되살려 주문·환불·발급 기록과 발급 기록 보호 트리거를 확인). 서버에서는 설치 직후 한 번, 이후 분기마다 한 번 위 절차로 실제 복원 연습을 한다(TODO(owner): 연습 주기 확정).

## 6. 관리 스크립트 (환불 조회·처리, 멈춘 생성 복구)

- 실행: `docker exec saju-web npm run -s admin -- <명령>`
  - `refunds list [--status received]`
  - `refunds show <접수번호>`
  - `refunds process <접수번호> --result refunded|rejected [--note "메모"] [--cancelled-externally]`
  - `orders recover-stuck`
- 웹 서버와 같은 SQLite 파일을 연다.
- 처리 순서: `show`로 내용과 발급 기록을 보고 회신 이메일로 결과를 보낸 뒤 `process`를 실행한다. 처리하면 회신 이메일이 지워진다.
- `show`에 "회신 이메일이 주문 때 이메일과 달라요" 주의가 나오면, 주문 이메일을 아는 다른 사람이 먼저 접수했을 수 있다. 결과를 회신하기 전에 주문 이메일로도 본인 여부를 확인한다.
- 멈춘 생성 복구는 서버를 켤 때, 그리고 화면 6의 상태 조회 때(시작 후 10분이 지난 "생성 중" 주문)도 자동으로 일어난다.

## 7. 관리형 PostgreSQL로 옮기는 기준 (D-030)

다음 중 하나라도 해당하면 NCP Cloud DB for PostgreSQL로 옮긴다. 저장소 인터페이스(`src/store/types.ts`)에 구현을 하나 더 만들고, SQLite 백업을 읽어 옮기는 일회성 스크립트를 쓴다.

| 기준 | 값 (제안, TODO(owner) 확정) | 이유 |
| --- | --- | --- |
| 서버 증설 | 웹 서버를 2대 이상으로 늘릴 때 | SQLite 파일은 서버 한 대만 쓸 수 있다. 횟수 제한 기록도 공유해야 한다 |
| 월 판매량 | 월 3,000건 이상(하루 평균 100건) | 최대 1시간의 기록 손실이 고객 수십 명에게 영향을 준다 |
| 손실 허용 | 1시간 분량의 기록 손실을 받아들일 수 없게 될 때 | 관리형 DB는 대기 서버로 자동 전환되고 백업 시점 복원을 지원한다 |
| DB 크기 | DB 파일 5GB 이상 | 매시간 전체 사본을 올리는 비용·시간이 커진다 |
