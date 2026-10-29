# 배포 절차 (NCP, Phase 4)

> 상태: 설정 파일과 절차를 준비했다. 이 PC에 Docker가 없어 이미지 빌드와 서버에서의 실행은 아직 확인하지 못했다(2026-10-29 다시 확인, 8-1).
> 확인한 것: `next build`, 운영 모드 실행(SQLite), 설정이 빠졌을 때 시작을 멈추는 동작, 백업·복원 스크립트(로컬 파일), 셸 스크립트 문법.
> 실제 PG 연동은 하지 않았다. 운영 환경에서는 결제하기 버튼이 꺼져 있다.

## 1. 구성

| 구성 요소 | 내용 |
| --- | --- |
| 서버 | NCP Server(Ubuntu 22.04 이상) 1대. Docker, nginx, aws CLI 설치 |
| 앱 | `Dockerfile`로 만든 이미지 1개(Node 26.7.0, 포트 3000) |
| DB | SQLite 파일 `/data/saju.db`. `/data`에 서버 경로(`/srv/saju/data`)나 이름 지정 볼륨이 연결돼 있어야 한다(D-030, D-031) |
| 백업 | 매시간 온라인 백업 → NCP Object Storage(`deploy/backup-hourly.sh`, systemd 타이머) |
| 앞단 | nginx: HTTPS 종료, IP별 속도 제한, 본문 64KB 상한, `X-Real-IP` 덮어쓰기(`deploy/nginx.conf`) |
| PDF | 이미지 안의 헤드리스 Chromium(Playwright 1.63.0)과 Noto 글꼴(D-025) |

## 2. 환경변수

| 이름 | 운영 | 설명 |
| --- | --- | --- |
| `NODE_ENV` | `production` (이미지에 고정) | 환경 파일로 `development`·`test`를 주면 서버가 시작하지 않는다(D-058). 운영 빌드인지는 빌드 때 번들에 박은 단계로 판단한다 |
| `DATABASE_URL` | `file:/data/saju.db` (이미지 기본값) | 없으면 서버가 시작하지 않는다 |
| `DB_REQUIRE_VOLUME` | `true` (이미지에 고정) | `/data`에 서버 경로나 이름 지정 볼륨이 연결되지 않았거나, 이름 없는 볼륨·메모리(tmpfs)면 서버가 시작하지 않는다 |
| `APP_ORIGIN` | **필수** | 서비스 주소(예: `https://example.com`). PDF 생성기와 결제창 복귀 주소가 이 값만 쓴다. 없으면 서버가 시작하지 않는다 |
| `REFUND_ID_SECRET` | **필수** | 환불 접수번호 HMAC 키, 32자 이상 임의 문자열. 바꾸면 같은 입력의 접수번호가 달라진다. 없으면 서버가 시작하지 않는다 |
| `TRUST_PROXY` | **필수** (`true`) | nginx가 `X-Real-IP`를 덮어쓰는 구성에서 켠다. 안 켜면 앱은 모든 요청을 한 IP로 세고, 시작할 때 경고를 남긴다 |
| `LLM_API_KEY` | 필수 | Claude API 키 |
| `LLM_MODEL` | 선택 | 비우면 `claude-sonnet-5-5`(D-021) |
| `PAYMENT_PROVIDER` | PG 계약 뒤 | `mock`은 예행 모드(`REHEARSAL_MODE=1`)에서만 쓸 수 있고, 그 밖에는 서버가 시작하지 않는다(D-058). 실제 PG 어댑터는 별도 Phase |
| `PAYMENT_METHODS_ENABLED` | 선택 | 켤 결제 수단(쉼표 구분). 기본 `kakaopay` |
| `PAYMENT_CLIENT_KEY`, `PAYMENT_SECRET_KEY` | PG 계약 뒤 | PG 키 |
| `EMAIL_PROVIDER`, `EMAIL_API_KEY`, `EMAIL_FROM` | 메일 서비스 연동 뒤 | `console`은 개발·테스트 전용이다. 운영에서는 실제 메일 어댑터가 생길 때까지 메일이 나가지 않고(발송 실패로 기록), 고객은 화면에서 PDF를 받는다 |
| `STORAGE_PROVIDER`, `STORAGE_BUCKET`, `DOWNLOAD_TOKEN_TTL_DAYS` | 쓰지 않음 | PDF는 `/data/pdf/`에 저장한다. 링크·보관 기간(30일)은 `src/config/delivery.ts`에서 바꾼다(D-033) |
| `ENABLE_FAKE_LLM` | **넣지 않는다** | 개발 서버 전용. 운영 빌드에서는 값이 무엇이든 들어 있으면 서버가 시작하지 않는다(D-058) |
| `PDF_RENDER_ORIGIN` | 비워 둔다 | PDF 생성기가 인쇄 화면을 여는 주소. 기본 `http://127.0.0.1:<PORT>`(같은 컨테이너 안, D-059) |
| `REHEARSAL_MODE` | 예행 연습 때만 `1` | 출시 전 예행 연습 서버 전용(D-058). 모든 화면 위에 "리허설 서버 — 실제 결제 아님" 배너가 나오고 `GET /api/health`가 `mode: rehearsal`을 돌려준다. 이때만 `PAYMENT_PROVIDER=mock`과 검수 전 주제를 허용한다. 실제 PG 설정(`PAYMENT_PROVIDER`가 mock이 아닌 값, `PAYMENT_CLIENT_KEY`, `PAYMENT_SECRET_KEY`)과 함께 있으면 시작하지 않는다. `1` 말고 다른 값도 시작 거부. **출시 전에 지운다** |
| `DATAGOKR_API_KEY` | 쓰지 않음 | 천문연 대조 fixture 생성용 |

**시작 거부(D-058):** 위 조건 말고도 판매 중인 주제(`enabled: true`) 가운데 검수를 마치지 않은 것(`reviewed: false`)이 있으면, 예행 모드가 아닌 운영 서버는 시작하지 않는다(`src/config/topics.ts`). 거부 이유는 `docker logs saju-web`에 `[시작 점검] 서버를 시작하지 않아요: 운영 설정 점검 실패: …`로 남는다(설정 이름과 주제 id만, 값은 남기지 않는다). 상태 확인: `curl -s https://<도메인>/api/health` → `{"status":"ok","mode":"production"}`.

비밀값은 서버의 환경 파일(`/etc/saju/app.env`, 권한 600)에만 둔다. 백업 업로드용 Object Storage 인증키는 따로 `/etc/saju/backup.env`(권한 600)에 둔다(5장). 둘 다 저장소에 넣지 않는다.

## 3. 처음 설치

1. 서버 준비: Docker, nginx, certbot, aws CLI 설치. 방화벽은 80·443만 연다(3000은 서버 안에서만).
2. 데이터 폴더: `sudo mkdir -p /srv/saju/data && sudo chown 1000:1000 /srv/saju/data && sudo chmod 700 /srv/saju/data`
   - 이미지의 실행 사용자 `node`가 uid 1000이다.
   - **권한 700은 필수다.** DB와 백업에 개인정보가 들어 있어 서버의 다른 사용자가 읽으면 안 된다. 폴더 권한이 700이 아니면(그룹·다른 사용자 권한이 있으면) 서버가 시작하지 않는다. 백업 스크립트도 매번 700으로 다시 맞춘다.
3. 이미지 빌드: `docker build -t saju-web:<버전> . && docker tag saju-web:<버전> saju-web:current`
4. 환경 파일 작성: 2장의 운영 필수 값.
5. 실행:
   ```bash
   docker run -d --name saju-web --restart unless-stopped \
     --env-file /etc/saju/app.env \
     -v /srv/saju/data:/data \
     -p 127.0.0.1:3000:3000 saju-web:current
   ```
   - `-v /srv/saju/data:/data`를 빼거나, 이름 없는 볼륨(`-v /data`)이나 `--tmpfs /data`로 띄우면 서버가 시작하지 않는다. 시작 점검이 컨테이너의 마운트 목록으로 확인한다.
   - 이 문서는 서버 경로(`/srv/saju/data`)를 쓴다. 백업 스크립트가 이 경로를 읽기 때문이다. 이름 지정 볼륨(`-v saju-data:/data`)도 시작은 되지만, 그때는 `DATA_DIR`을 그 볼륨의 서버 쪽 경로로 바꿔야 한다.
   - 컨테이너를 지우고 다시 만들어도 DB는 `/srv/saju/data/saju.db`에 남는다.
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

### 백업 보호 (필수, D-031)

백업에는 개인정보가 그대로 들어 있다. 주문·환불 이메일, 생성 전 출생 정보, 리포트(표지의 이름·생년월일 표기 포함)다. 아래 네 가지를 모두 켜야 한다. 백업 스크립트는 올리기 전에 버킷의 버전 관리(`Enabled`), 저장 암호화 설정, 공개 권한 없음(ACL에 AllUsers·AuthenticatedUsers 없음)을 확인하고, 하나라도 아니면 올리지 않고 실패로 끝난다. NCP가 이 확인 API 중 하나를 지원하지 않으면 백업이 계속 실패하므로, 설치 직후 수동 실행으로 확인한다.

| 항목 | 설정 |
| --- | --- |
| 비공개 버킷 | 버킷과 객체의 공개 접근을 끈다. 접근은 백업용 API 인증키로만 한다 |
| 저장 암호화 | 버킷의 서버 측 암호화(SSE)를 켠다 |
| 삭제 방지 | 버킷의 버전 관리를 켜고, 지원되면 객체 잠금도 켠다. 백업용 인증키에는 버전 삭제 권한(`DeleteObjectVersion`)을 주지 않는다(버전 관리만으로는 탈취된 키로 이전 버전까지 지울 수 있다). 7일 보관 정리는 수명 주기 규칙이 한다 |
| 서버 데이터 폴더 권한 700 | `/srv/saju/data`와 `backups/`는 700, 백업 사본은 600(백업 스크립트가 매번 맞춘다) |

- 보관 기간: **7일**. 수명 주기 규칙으로 7일이 지난 객체(이전 버전 포함)를 지운다. 백업이 모두 개인정보가 든 전체 사본이라, 오래 보관하는 사본(예: 매일 0시 백업 90일)은 두지 않는다.
- TODO(owner): 백업 보관 기간(7일)을 개인정보 처리방침에 적는다.
- 백업용 인증키에는 이 버킷의 읽기·쓰기 권한만 준다(다른 서비스·버킷 권한 없음). 임시 이름을 지우는 객체 삭제(`DeleteObject`)는 필요하고, 버전 삭제(`DeleteObjectVersion`)는 주지 않는다.
- 업로드는 임시 이름(`saju/sqlite/.incoming/<파일 이름>.part`)으로 먼저 올리고, 크기와 SHA-256(다시 내려받아 계산)이 서버 사본과 같을 때만 정상 이름으로 복사한다. 정상 이름 객체에는 `sha256` 메타데이터가 붙는다. 확인에 실패하면 임시 이름만 남고(7일 수명 주기가 지운다) 스크립트는 실패로 끝난다.
- TODO(owner): 버킷 정책(Bucket Policy)에 공개 허용(`Principal: *` 등)이 없는지 NCP 콘솔에서 확인한다. 백업 스크립트는 ACL만 확인하고 버킷 정책은 확인하지 않는다.

### 보관 기간 정리 (D-033)

- 매시간 백업 스크립트가 **백업보다 먼저** `npm run db:purge`를 돌린다. 리포트가 완성된 날부터 30일이 지난 주문의 PDF(`/data/pdf/<주문번호>.pdf`)·리포트·이메일 주소·다운로드 링크를 지운다. 완성되지 않은 주문(결제 전·생성 실패 등)은 주문일부터 30일이 지나면 이메일 주소를 지운다. 주문 기록(번호·금액·결제 승인·상태)과 발급 기록은 남긴다.
- 환불된 주문의 이메일은 관리 스크립트로 환불 처리할 때 바로 지운다. 환불 요청 기록은 회신(처리) 뒤 회신 이메일과 고객이 적은 상세 내용을 지우고, 접수번호·주문번호·사유·처리 결과·일시만 남긴다.
- nginx는 다운로드 경로(`/api/download/`)의 접근 로그를 끄고, 오류 로그도 심각한 오류(crit)만 남긴다. 그 밖의 경로 오류 로그에는 토큰이 없다.
- 서버가 PDF를 쓰다 멈춰 남은 임시 파일(`/data/pdf/<주문번호>.pdf.<hex>.part`)은 한 시간이 지나면 같은 정리에서 지운다(D-036).
- 정리가 실패해도 백업은 계속한다. 실패는 건수·오류 종류만 로그에 남긴다(주문번호·이메일 없음).
- 지운 내용도 그 전에 만든 백업에는 최대 7일 남는다. TODO(owner): 이 사실을 개인정보 처리방침에 적는다.
- PDF 파일은 Object Storage 백업에 들어가지 않는다(DB만 올린다). 복원 뒤 PDF가 없으면 처음 받을 때 리포트로 다시 만든다.

### 매시간 백업 → NCP Object Storage

- `deploy/backup-hourly.sh`가 컨테이너 안에서 `npm run db:backup`(SQLite 온라인 백업)으로 일관된 사본을 만든다. 서버를 멈추지 않는다.
- 사본을 열어 무결성 검사와 표 확인을 마친 뒤 Object Storage에 올린다. 올린 크기도 확인한다.
- 설치:
  1. NCP 콘솔에서 Object Storage 버킷을 만들고 위 "백업 보호" 네 가지를 켠다. 수명 주기 규칙으로 7일 보관을 건다.
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
- 서버에는 최근 24개만 남긴다(`/srv/saju/data/backups`). 정리는 업로드 전에 하므로 업로드가 계속 실패해도 쌓이지 않는다. 실패하면 `journalctl -u saju-backup.service`에 남는다.
- 데이터 폴더(`/srv/saju/data`)는 앱 사용자 소유라, 백업·복원 스크립트(root)는 그 안의 파일을 직접 만들거나 권한·소유자를 바꾸지 않는다. 정리(`npm run db:prune`)·백업·업로드할 파일 읽기는 컨테이너 안에서 앱 사용자 권한으로 한다. 앱이 뚫려 심볼릭 링크를 심어도 서버(호스트) 파일을 건드리지 못하게 하려는 것이다.
- 정리 기준은 파일 이름의 시각이다(백업 사본은 최근 24개, 복원 때 남긴 원래 DB는 7일). 옮긴 파일은 수정 시각이 옛날 그대로일 수 있어 수정 시각은 쓰지 않는다.
- 배포 파일(`deploy/*`)은 git으로 내려받아 쓴다(`.gitattributes`가 줄 끝을 LF로 고정). 윈도에서 작업한 파일을 그대로 복사하면 줄 끝이 CRLF라 bash가 읽지 못할 수 있다.
- 매시간 백업이므로 사고가 나면 최대 1시간 분량의 주문·환불 기록을 잃을 수 있다. 잃은 결제는 PG 관리 화면의 결제 내역으로 확인해 대조한다.

### 복원

1. 복원할 백업을 고른다: `aws --endpoint-url https://kr.object.ncloudstorage.com s3 ls s3://<버킷>/saju/sqlite/`
2. root로 `bash -c 'set -a; . /etc/saju/backup.env; set +a; /opt/saju/deploy/restore.sh saju/sqlite/<파일 이름>'`
   - 서버에 있는 사본으로 복원하려면 `restore.sh --local /srv/saju/data/backups/<파일 이름>`. 파일을 복사해서 쓰고 원본은 지우지 않는다.
     - 링크를 모두 푼 실제 경로가 데이터 폴더(`/srv/saju/data`) 안이거나 root 전용 가져오기 폴더(`/var/lib/saju/import`, 권한 700) 안일 때만 받는다. 링크가 그 밖을 가리키면 거부한다.
     - 데이터 폴더 안 파일은 root가 직접 읽지 않고, 일회용 컨테이너 안에서 앱 사용자 권한으로 꺼낸다(네트워크 없음, 읽기 전용 연결).
     - 다른 곳에 있는 백업은 가져오기 폴더에 복사한 뒤 지정한다. 5GiB(`MAX_RESTORE_BYTES`)보다 큰 파일은 받지 않는다.
   - 파일 이름은 `saju-<시각>.db` 형식만 받는다.
   - 받은 사본은 root만 쓰는 준비 폴더(`/var/lib/saju/restore`, 권한 711)에 두고, 컨테이너에는 그 파일 하나만 읽기 전용으로 연결한다. 끝나면 지운다.
   - 먼저 백업 파일만 확인한다(무결성, 표 5개). 실패하면 서버를 멈추지 않고 끝난다.
   - 웹 서버를 멈추고 바꿔 넣는다. 백업을 임시 파일에 복사해 다시 검증한 뒤에만 교체하고, 도중에 실패하면 원래 DB를 그대로(또는 제자리로 되돌려) 둔다. 성공하든 실패하든 끝나면 서버를 다시 켠다.
   - 원래 DB는 `/srv/saju/data/saju.db.before-restore-<시각>`(와 짝 맞는 `-wal`·`-shm`)으로 남는다. 복원을 되돌리려면 서버를 멈추고 이 파일들을 `saju.db`(와 `-wal`·`-shm`)로 다시 바꾼 뒤 켠다. 7일이 지나면 백업 스크립트가 지운다(전체 백업과 같은 보관 기간).
   - 끝날 때 DB 파일이 없으면(바꿔 넣기와 되돌리기가 모두 실패한 경우) 서버를 켜지 않고 실패로 끝난다. 그대로 켜면 빈 DB가 새로 만들어지기 때문이다. 안내에 따라 `.before-restore-*` 파일을 되돌린 뒤 `docker start saju-web` 한다.
   - 복원에 쓴 준비 사본(`/var/lib/saju/restore/restore-<번호>-<파일 이름>`)은 성공하든 실패하든 끝날 때 지운다. 스크립트가 강제 종료(`kill -9`·정전)되면 남을 수 있으니, 이 폴더에 `restore-*` 파일이 있으면 지운다(개인정보가 들어 있다).
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

## 8. 예행 연습 (2026-10-29 개정: 이 PC 로컬 리허설 → NCP 짧은 확인)

출시 전에 운영과 같은 이미지로 한 번 돌려 본다. 무거운 확인(이미지 빌드, 시작 거부, 목 결제, PDF, 백업·복원)은 이 PC에서 먼저 하고, NCP에서는 이 PC에서 못 보는 것(nginx, 방화벽, 인증서·도메인, 실제 네트워크)만 짧게 본다. 예행 서버는 `REHEARSAL_MODE=1`(D-058)로 띄운다.

### 8-1. 이 PC의 Docker 상태 (2026-10-29 확인)

- **설치돼 있지 않다.** 이 터미널(Git Bash·PowerShell)에서 `docker` 명령이 없고, `C:\Program Files\Docker`도 없으며, 설치 프로그램 목록에도 Docker Desktop이 없다. WSL도 설치돼 있지 않다(`wsl -l -v` → "설치되어 있지 않습니다").
- **설치하려면(내가 할 일):**
  1. 관리자 PowerShell에서 `wsl --install` → 재부팅.
  2. Docker Desktop(Windows)을 설치하고 WSL 2 백엔드를 고른다. 실행 후 Claude Code 터미널을 새로 열어 `docker --version`, `docker info`가 되는지 확인한다.
  3. **메모리:** 이 PC는 15.7GB 중 85%를 이미 쓰고 있다(남은 약 2.4GB). Docker(WSL 2)는 기본으로 메모리의 절반까지 쓸 수 있어 다른 작업이 느려질 수 있다. `%UserProfile%\.wslconfig`에 `[wsl2]`·`memory=4GB`·`swap=4GB`를 넣어 상한을 둔다. 빌드할 때는 다른 큰 프로그램을 닫는다.
- 설치가 끝나면 8-2를 Claude Code가 차례로 진행하고, 빌드·실행 중 메모리 사용량(`docker stats`)과 이미지 크기(`docker images`)를 함께 보고한다.

### 8-2. 이 PC 로컬 리허설 (Docker 설치 뒤)

| 순서 | 확인 | 방법(Claude Code가 실행) |
| --- | --- | --- |
| 1 | 운영 이미지 빌드, 이미지 크기, 빌드 중 메모리 | `docker build -t saju-web:rehearsal .`, `docker images saju-web`, 빌드 중 `docker stats --no-stream` |
| 2 | 운영 모드 시작 거부 6가지 | 같은 이미지로 `docker run --rm`에 환경변수만 바꿔 띄우고 `[시작 점검] 서버를 시작하지 않아요`와 종료 코드 1을 본다(NODE_ENV=development·test, ENABLE_FAKE_LLM, 예행 모드 없는 목 결제, 검수 전 주제, 예행 모드 + 실제 PG 키) |
| 3 | 예행 모드 + 목 결제로 뜨기 | `-e REHEARSAL_MODE=1 -e PAYMENT_PROVIDER=mock`, `/api/health`가 `rehearsal`, 모든 화면 위 배너 |
| 4 | 결제 → 생성 → 컨테이너 안 PDF | 목 결제(성공) 1번. **실제 Claude API를 1번 부른다(약 $0.25), 부르기 전에 알린다.** PDF가 컨테이너 안 Chromium으로 만들어지는지, 한글 글꼴이 맞는지, 쪽수 |
| 5 | DB 백업·복원 | 컨테이너 안에서 `npm run db:backup` → 사본 무결성, 다른 폴더로 `npm run db:restore` 뒤 주문이 보이는지(Object Storage 업로드는 8-3에서) |
| 6 | 정리 | 컨테이너·임시 볼륨 삭제, 이미지는 8-4에서 쓸지 정할 때까지 둔다 |

이 PC는 리눅스가 아니라서 `deploy/*.sh`(systemd 타이머, 심볼릭 링크 검사)와 nginx는 여기서 보지 않는다.

### 8-3. NCP 짧은 확인

이 PC에서 못 보는 것만 본다. 서버는 짧게 쓰고 반납할 수 있게 시간 요금제로 만든다.

| 순서 | 내가 NCP 콘솔·내 PC에서 할 일 | Claude Code가 안내할 일(명령·확인) |
| --- | --- | --- |
| 1 | 결제 수단 등록, 예산 알림 설정 | 비용표(8-5) 다시 확인 |
| 2 | VPC·Subnet(공인), ACG: **80은 전체 허용**(https로 넘기기와 인증서 발급만 함), **443은 내 공인 IP만**, 22는 내 IP만(2-16) | ACG 규칙 확인 |
| 3 | 서버 만들기(Ubuntu 22.04 이상, 8-4의 사양), 인증키(.pem)는 내 PC에 보관, 공인 IP 할당 | 접속 명령과 첫 업데이트, Docker·nginx·certbot·aws CLI 설치 |
| 4 | 도메인을 정했으면 DNS A 레코드를 공인 IP로(8-6) | 인증서 발급(8-6) |
| 5 | | 이미지 올리기(8-4: 이 PC에서 만든 이미지를 파일로 옮기거나 서버에서 빌드), `/srv/saju/data`(700) |
| 6 | Claude API 키·`REFUND_ID_SECRET`을 서버의 `/etc/saju/app.env`(600)에 직접 입력(대화창에 붙이지 않음) | `app.env` 나머지: `APP_ORIGIN`, `TRUST_PROXY=true`, `REHEARSAL_MODE=1`, `PAYMENT_PROVIDER=mock`. `ENABLE_FAKE_LLM`·PG 키는 넣지 않는다 |
| 7 | | `docker run`(3장 5번), nginx(3장 6번)와 기본 인증(2-16), `nginx -t` |
| 8 | Object Storage 버킷·보호·7일 수명 주기(5장, 2-14), Object Storage 권한만 가진 API 인증키 | `backup.env`(600) 직접 입력 안내, 백업 타이머, 수동 백업 1회가 버킷에 올라가는지 |
| 9 | 다른 망(휴대폰 데이터)에서 막히는지, 비밀번호로 열리는지 | `curl /api/health`가 `rehearsal`, 배너, 목 결제 1번으로 PDF까지(실제 Claude API 1번, 알리고 진행), `docker logs`에 시작 거부 없음, 2-15 점검 항목 |
| 10 | 끝나면 서버를 계속 쓸지 정하고, 안 쓰면 서버·공인 IP·버킷 반납 | 출시로 넘어갈 때 2-17(REHEARSAL_MODE 제거) |

### 8-4. 서버 사양: 이미지를 어디서 빌드하나

| 방식 | 서버 사양 | 장단점 |
| --- | --- | --- |
| **이 PC에서 빌드 → 파일로 옮김(권장)** `docker save saju-web:<버전> \| gzip > saju.tar.gz` → `scp` → 서버에서 `gunzip -c saju.tar.gz \| docker load` | **2vCPU·4GB면 충분할 것으로 본다**(실행만: Node 앱 + PDF 1건 생성 때 Chromium). 8GB → 4GB로 줄면 월 약 1.3만~1.6만 원 덜 든다(8-5 표 기준, 확인 정도는 그 표와 같다) | 레지스트리가 필요 없다. 이미지 파일이 커서 올릴 때마다 시간이 걸린다(크기는 8-2에서 잰다. Chromium·개발 의존성까지 들어 있어 압축 전 수 GB로 추정, 확인 못 함) |
| 이 PC에서 빌드 → 레지스트리 | 위와 같음 | NCP Container Registry(저장 공간은 Object Storage 요금, 확인 못 함)나 Docker Hub 비공개 저장소. 계정·인증 관리가 하나 더 생긴다. 서버가 여러 대가 되면 이쪽이 편하다 |
| 서버에서 빌드(지금 3장 절차) | 2vCPU·8GB 권장(`next build` + Chromium 설치를 서버에서 함께) | 옮길 파일이 없다. 사양이 커야 한다 |

- 이 PC(Windows, x86-64)의 Docker가 만드는 이미지는 linux/amd64라 NCP 서버(x86-64)에서 그대로 돈다.
- 4GB 서버에서도 스왑 2GB를 만들어 둔다(PDF가 겹칠 때 대비).

### 8-5. 월 비용 추정 (VAT 별도)

공식 요금 페이지는 요금 숫자를 화면에서 따로 불러와, 이번에 자동으로 읽을 수 있었던 공식 숫자는 2vCPU 서버 예시 하나뿐이다. 나머지는 확인 정도를 함께 적었다. **서버를 만들기 전에 콘솔 요금 계산기로 다시 확인한다.**

| 항목 | 금액(월) | 확인 정도 | 출처 |
| --- | --- | --- | --- |
| 서버 2vCPU(High CPU 4GB) | 약 69,000~72,000원 | 공식 예시 1건 + 리셀러 표 | 공식 서버 요금 안내의 MSSQL 예시 "2vCPU 서버 69,000원(서버)"<sup>①</sup>, 리셀러 표 High CPU 2vCPU·4GB 69,120원(50GB)·72,000원(100GB)<sup>②</sup> |
| 서버 2vCPU(Standard 8GB) | 약 85,000~88,000원 | 리셀러 표만(공식 확인 못 함) | 리셀러 표 Standard 2vCPU·8GB 85,120원(50GB)·88,000원(100GB)<sup>②</sup> |
| 공인 IP 1개 | 약 4,000원 | 검색 결과의 공식 요금 페이지 문구(시간 5.6원, 30일 4,032원). 리전 표기는 확인 못 함 | <sup>③</sup> |
| Object Storage(백업, 1GB 미만) | 100원 미만 | 검색 결과 기준 GB-월 28원(확인 못 함). 요청 수 요금은 매시간 업로드 기준 월 수백 건이라 거의 0 | <sup>④</sup> |
| 아웃바운드 트래픽 | 예행 규모에서는 거의 0 | 공식 표에 구간(20GB 이하 등)은 있지만 금액은 확인 못 함 | <sup>①</sup> |
| 도메인·인증서 | 인증서 0원(Let's Encrypt). 도메인은 1-1에서 정하면 별도 | | |
| **합계 추정** | **약 7.5만~9.5만 원(VAT 별도)** | 서버 요금이 대부분 | |

- 예행 연습만이면 시간 요금제로 쓰다 끝나면 반납하는 편이 싸다. 서버를 정지하면 일부 서버 타입은 기본 디스크 요금만 내지만, 공인 IP·추가 디스크는 정지 중에도 청구된다<sup>①</sup>. 정지 할인 대상 타입은 세대마다 달라 확인 못 했다. 다 쓴 서버·공인 IP·버킷은 반납·삭제한다.
- 예행 중 리포트를 만들면 Claude API 비용이 따로 든다(건당 약 $0.25, D-057 측정).

출처:
1. ① NCP 공식 Server 요금 안내: https://www.ncloud.com/product/compute/server (2026-10-29 확인, 요금 숫자는 화면에서 불러와 대부분 읽지 못함)
2. ② 엔클라우드24(NCP 리셀러) 서버 요금표: https://www.ncloud24.com/index.php/navercloud/server (게시 시점 확인 못 함)
3. ③ NCP 공식 요금 페이지 검색 결과 문구: https://www.ncloud.com/charge/region/de (페이지에서 직접 읽지는 못함)
4. ④ Object Storage 요금 검색 결과(공식 가이드·블로그): https://guide.ncloud-docs.com/docs/storage-storage-6-1

### 8-6. 인증서 발급 방식

예행 서버는 443을 내 IP로만 열어 두므로, 인증서를 발급·갱신할 때 Let's Encrypt가 80번으로 들어올 수 있어야 한다.

| 방식 | 언제 | 방법 | 주의 |
| --- | --- | --- | --- |
| **실제 도메인 + Let's Encrypt HTTP-01(권장)** | 도메인을 정했을 때(1-1) | ACG에서 80을 전체 허용(nginx 80 블록은 https로 넘기기와 `/.well-known/acme-challenge/`만), `sudo certbot --nginx -d <도메인>`, 자동 갱신 `sudo certbot renew --dry-run` 확인 | 80을 내 IP로만 열면 발급·자동 갱신이 실패한다 |
| 실제 도메인 + DNS-01 | 80을 열고 싶지 않을 때 | `certbot certonly --manual --preferred-challenges dns`로 TXT 레코드를 직접 넣는다 | 수동 방식은 자동 갱신이 안 된다(90일). 예행처럼 짧게 쓸 때만 |
| 임시 주소(`<IP>.sslip.io` 등) + HTTP-01 | 도메인을 아직 못 정했을 때 | 위 권장 방식과 같다 | Let's Encrypt 발급 한도를 다른 사용자와 나눠 써 실패할 수 있다(확인 못 함). 운영에는 쓰지 않는다 |
| 자체 서명 인증서 | 도메인 없이 나 혼자 잠깐 볼 때 | `openssl`로 만들어 nginx에 지정 | 브라우저 경고가 뜬다. PDF 생성은 서버 안 주소(아래)로 하므로 영향이 없다. PG 결제창 복귀 등 외부 연동에는 쓸 수 없다 |

### 8-7. PDF 생성 주소 (D-059)

- PDF 생성기(서버 안 Chromium)는 공개 주소(`APP_ORIGIN`)가 아니라 같은 컨테이너 안 주소 `http://127.0.0.1:3000`으로 인쇄 화면을 연다(`PDF_RENDER_ORIGIN`으로 바꿀 수 있다). 메일의 다운로드 링크와 결제창 복귀 주소는 그대로 `APP_ORIGIN`을 쓴다.
- 그래서 nginx 기본 인증·ACG에 서버 자신의 공인 IP를 넣을 필요가 없고, 인증서 종류와도 상관없다.

### 8-8. 예행 주의 사항

- **목 결제창에서 "결제 성공 후 풀이 생성 실패"를 고르지 않는다.** 운영 빌드에서는 강제 실패가 꺼져 있어, 이 선택지를 골라도 실패 대신 실제 Claude API를 불러 리포트를 만든다(비용 발생, 실패 화면은 재현되지 않는다, D-058 리뷰 LOW). 실패 화면은 개발 PC의 화면 테스트로 확인한다.
- 예행 중 만든 리포트는 실제 Claude API를 쓴다(건당 약 $0.25). 필요한 최소 횟수만, 부르기 전에 알리고 만든다.
- 예행 서버는 접근 제한(2-16)을 건 상태로만 띄운다. 배너가 보이고 `/api/health`가 `rehearsal`인지 매번 확인한다.
- 출시로 넘어갈 때는 `REHEARSAL_MODE`·`PAYMENT_PROVIDER=mock`을 지우고(2-17), 판매 주제의 `reviewed`가 모두 `true`여야 운영 서버가 뜬다(D-058).
