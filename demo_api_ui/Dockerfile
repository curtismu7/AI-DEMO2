# Banking API UI Dockerfile
# Multi-stage build for React app

# Dev stage — hot-reload via Vite dev server (selected by docker-compose.yml `target: dev`).
# Vite listens on 4000 (vite.config.js) and reads TLS certs from /certs.
FROM node:20-alpine AS dev
WORKDIR /app
COPY package*.json ./
RUN npm install --legacy-peer-deps
COPY vite.config.js index.html ./
EXPOSE 4000
CMD ["npm", "start"]

# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# --legacy-peer-deps required: react-table@7 doesn't declare React 19 support
RUN npm install --legacy-peer-deps

# Copy source code
COPY . .

# Build the app
RUN npm run build

# Production stage
ARG GIT_SHA=unknown
FROM nginx:alpine AS production
ENV GIT_SHA=$GIT_SHA

# Copy built app from builder stage
COPY --from=builder /app/build /usr/share/nginx/html

# Copy nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Run as non-root (k8s securityContext runAsUser: 101): make the cache dir
# writable so nginx can create its *_temp subdirs at startup, and move the pid
# file to a writable path so the master process can start without root.
RUN chown -R 101:101 /var/cache/nginx \
 && sed -i -E 's#^pid\s+\S+;#pid /tmp/nginx.pid;#' /etc/nginx/nginx.conf

# Expose port
EXPOSE 4000

# Start nginx
CMD ["nginx", "-g", "daemon off;"]