FROM mcr.microsoft.com/playwright:v1.59.1-jammy

WORKDIR /app/scraper

COPY scraper/package*.json ./
RUN npm ci --no-audit --no-fund

COPY scraper ./
COPY data/ksic /app/data/ksic

ENV NODE_ENV=production
CMD ["npm", "run", "worker:aws", "--", "--once"]
