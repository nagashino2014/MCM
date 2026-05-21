FROM mcr.microsoft.com/playwright:v1.57.0-jammy

WORKDIR /app/scraper

COPY scraper/package*.json ./
RUN npm install

COPY scraper ./
COPY data/ksic /app/data/ksic

ENV NODE_ENV=production
CMD ["npm", "run", "worker:aws", "--", "--once"]
