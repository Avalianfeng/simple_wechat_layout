FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY server ./server
COPY public ./public
COPY themes ./themes
COPY data/uploads/.gitkeep ./data/uploads/.gitkeep

ENV NODE_ENV=production
ENV PORT=3080

EXPOSE 3080

CMD ["node", "server/index.js"]
