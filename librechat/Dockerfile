FROM registry.librechat.ai/danny-avila/librechat-dev@sha256:5ce9e7c9e009557d04cfd2c0376b98e814ad3b00323394f006a3876b521bbf96

COPY patches/apply-persistent-conversation-starters.mjs /tmp/apply-persistent-conversation-starters.mjs
RUN npm ci \
    && node /tmp/apply-persistent-conversation-starters.mjs \
    && cd client \
    && npm run test:ci -- ChatView.spec.tsx --runInBand \
    && cd .. \
    && npm run build:client \
    && npm prune --omit=dev
