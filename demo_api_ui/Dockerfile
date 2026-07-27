# Banking API UI Dockerfile
# Multi-stage build for React app

# Dev stage — hot-reload via Vite dev server (selected by docker-compose.yml `target: dev`).
# Vite listens on 4000 (vite.config.js) and reads TLS certs from /certs.
FROM node:22-alpine AS dev
WORKDIR /app
COPY demo_api_ui/package*.json ./
RUN npm install --legacy-peer-deps
COPY demo_api_ui/vite.config.js demo_api_ui/index.html ./
EXPOSE 4000
CMD ["npm", "start"]

# Build stage
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files
COPY demo_api_ui/package*.json ./

# --legacy-peer-deps required: react-table@7 doesn't declare React 19 support
RUN npm install --legacy-peer-deps

# Copy source code
COPY demo_api_ui/ .

# demoAgentService.js imports ../../../llm-timeouts.json which resolves to
# /llm-timeouts.json (3 levels above /app/src/services/). Provide it at build time.
COPY llm-timeouts.json /llm-timeouts.json

# PostHog browser SDK. vite.config.js inlines process.env.REACT_APP_* at build
# time, so these must be present HERE — the nginx production stage serves a
# static bundle and a runtime env var would never reach the browser. Unset is a
# supported no-op (posthogClient.js skips init).
ARG REACT_APP_POSTHOG_KEY=
ARG REACT_APP_POSTHOG_HOST=
ENV REACT_APP_POSTHOG_KEY=$REACT_APP_POSTHOG_KEY
ENV REACT_APP_POSTHOG_HOST=$REACT_APP_POSTHOG_HOST

# Build the app
RUN npm run build

# Production stage
ARG GIT_SHA=unknown
FROM nginx:alpine AS production
ENV GIT_SHA=$GIT_SHA

# Copy built app from builder stage
COPY --from=builder /app/build /usr/share/nginx/html

# Copy nginx configuration
COPY --from=builder /app/nginx.conf /etc/nginx/conf.d/default.conf

# Run as non-root (k8s securityContext runAsUser: 101): make the cache dir
# writable so nginx can create its *_temp subdirs at startup, and move the pid
# file to a writable path so the master process can start without root.
RUN chown -R 101:101 /var/cache/nginx \
 && sed -i -E 's#^pid\s+\S+;#pid /tmp/nginx.pid;#' /etc/nginx/nginx.conf

# Expose port
EXPOSE 4000

# Start nginx
CMD ["nginx", "-g", "daemon off;"]