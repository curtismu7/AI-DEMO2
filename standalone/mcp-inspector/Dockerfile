FROM node:22-alpine AS webbuild
WORKDIR /app/web
COPY web/package.json web/package-lock.json* ./
RUN npm install
COPY web/ ./
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY server/package.json server/package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev
COPY server/ ./
COPY --from=webbuild /app/web/dist ../web/dist

EXPOSE 3900
ENV PORT=3900
CMD ["node", "index.js"]
