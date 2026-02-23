FROM node:20-slim

# dependências para Playwright/Chromium
RUN apt-get update && apt-get install -y \
  libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
  libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
  libgbm1 libasound2 libpangocairo-1.0-0 libpango-1.0-0 libcairo2 \
  libatspi2.0-0 libx11-6 libxext6 libxrender1 ca-certificates fonts-liberation \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
RUN npm install
RUN npx playwright install --with-deps chromium

COPY . .
EXPOSE 3000
CMD ["npm","start"]
