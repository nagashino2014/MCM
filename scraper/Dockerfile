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

ENV NODE_ENV=production
CMD ["npm", "run", "worker:aws", "--", "--once"]
