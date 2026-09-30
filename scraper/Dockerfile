FROM mcr.microsoft.com/playwright:v1.59.1-jammy AS dependencies

WORKDIR /app/scraper

RUN apt-get update && apt-get install -y --no-install-recommends build-essential
COPY scraper/package*.json ./
RUN npm config set strict-ssl false && npm_config_nodedir=/usr npm ci --no-audit --no-fund

FROM mcr.microsoft.com/playwright:v1.59.1-jammy

WORKDIR /app/scraper

COPY --from=dependencies /app/scraper/node_modules ./node_modules
COPY scraper ./
COPY data/ksic /app/data/ksic

# 운영 진입점이 아닌 진단·로컬 파일럿은 command override로도 실행할 수 없게 이미지에서 제외한다.
RUN rm -f scripts/cli-quality-audit-readonly.ts scripts/cli-quality-pilot.ts

# RDS 서버 인증서 검증(PGSSL_REJECT_UNAUTHORIZED=true) — frontend/Dockerfile 과 같은 공개 CA 번들.
# 현재 운영 worker 이미지(r0b-51921a7-rds-ca-20260923)도 이 레이어를 갖고 있다.
COPY infra/aws/rds-ca/ap-northeast-2-bundle.pem /opt/mcm/rds-ca/ap-northeast-2-bundle.pem
ENV NODE_EXTRA_CA_CERTS=/opt/mcm/rds-ca/ap-northeast-2-bundle.pem

ENV NODE_ENV=production
CMD ["npm", "run", "worker:aws", "--", "--once"]
