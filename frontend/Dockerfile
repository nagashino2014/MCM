FROM node:22-alpine AS deps
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm config set strict-ssl false && npm ci --no-audit --no-fund --foreground-scripts

FROM node:22-alpine AS builder
WORKDIR /app/frontend
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/frontend/node_modules ./node_modules
COPY frontend ./
COPY scraper ../scraper
RUN npm run build && node scripts/build-batch.mjs

FROM node:22-alpine AS runner
WORKDIR /app/frontend
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=builder /app/frontend/.next ./.next
COPY --from=builder /app/frontend/public ./public
COPY --from=builder /app/frontend/package*.json ./
# next start 는 실행 시 next.config.mjs 를 다시 읽는다 — 빌드에 박히지 않는 실행 설정(미들웨어 본문 한도
# middlewareClientMaxBodySize 등)은 이 파일이 없으면 기본값으로 돈다(2026-09-22: 10MB 초과 업로드 실패 실측).
COPY --from=builder /app/frontend/next.config.mjs ./
COPY --from=builder /app/frontend/node_modules ./node_modules
EXPOSE 3000
CMD ["npm", "run", "start"]
