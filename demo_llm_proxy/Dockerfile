FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --production

COPY router.js .

EXPOSE 8090
ENV LLM_PROXY_PORT=8090

CMD ["npm", "start"]
