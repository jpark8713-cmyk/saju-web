# 사주 리포트 웹 (Next.js) 운영 이미지. 배포 절차: Docs/deploy.md
# - Node 26.13.0: 내장 SQLite(node:sqlite)를 쓴다(D-030). 개발 PC와 같은 버전이다(D-060, 26.12.1 보안 릴리스 이후).
# - PDF 생성에 헤드리스 Chromium이 필요해 앱의 playwright(1.63.0)로 Chromium과 시스템 의존성을 설치한다(D-025).
# - 리포트 글꼴(Noto Serif KR·Noto Sans KR)은 앱에 들어 있고, 시스템 한글 대체 글꼴로 fonts-noto-cjk를 더한다.
# - DB 파일은 컨테이너 밖(/data에 연결한 이름 지정 볼륨이나 서버 경로)에 둔다. 연결 없이, 또는 이름 없는 볼륨으로 띄우면
#   앱이 시작하지 않는다(DB_REQUIRE_VOLUME=true, D-031). 그래서 VOLUME 선언을 두지 않는다(선언하면 -v 없이도 이름 없는 볼륨이 붙는다).

FROM node:26.13.0-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# next start가 next.config.ts를 읽고 관리·백업 스크립트가 tsx를 쓰므로 개발 의존성도 남긴다
RUN npm run build

FROM node:26.13.0-bookworm-slim AS run
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json /app/next.config.ts /app/tsconfig.json ./
COPY --from=build /app/node_modules ./node_modules
RUN npx playwright install --with-deps chromium \
  && apt-get update \
  && apt-get install -y --no-install-recommends fonts-noto-cjk \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /data && chown node:node /data && chmod 700 /data
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/scripts ./scripts
COPY --from=build --chown=node:node /app/src ./src
ENV NODE_ENV=production \
    PORT=3000 \
    DATABASE_URL=file:/data/saju.db \
    DB_REQUIRE_VOLUME=true
USER node
EXPOSE 3000
CMD ["npx", "next", "start", "-p", "3000"]
