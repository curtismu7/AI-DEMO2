# Always-on promptfoo sidecar for banking step-narration eval.
# Build context: demo_api_server/promptfoo/
# Stays idle in core compose; run eval via: ./run-docker.sh promptfoo
FROM node:22-alpine

RUN npm install -g promptfoo@0.121.19 --no-audit --no-fund \
  && npm cache clean --force

WORKDIR /app
COPY step-narration.config.yaml ./promptfoo/step-narration.config.yaml

ENV OPENAI_API_KEY=not-needed
ENV OPENAI_API_BASE_URL=http://host.docker.internal:8090/v1

# Keep the container up; eval is triggered on demand (exec / run-docker.sh promptfoo).
CMD ["tail", "-f", "/dev/null"]
