FROM mcr.microsoft.com/playwright:v1.59.1-jammy

WORKDIR /app/scraper

COPY scraper/package*.json ./
RUN npm ci --no-audit --no-fund

COPY scraper ./
COPY data/ksic /app/data/ksic

# 운영 진입점이 아닌 진단·로컬 파일럿은 command override로도 실행할 수 없게 이미지에서 제외한다.
RUN rm -f scripts/cli-quality-audit-readonly.ts scripts/cli-quality-pilot.ts

ENV NODE_ENV=production
CMD ["npm", "run", "worker:aws", "--", "--once"]
