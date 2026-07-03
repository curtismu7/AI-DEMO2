# Playwright base image ships Chromium + all OS deps preinstalled, so the
# headless "ungoverned agent" runs without a desktop. Pin to a version whose
# bundled browsers match the playwright npm package below.
FROM mcr.microsoft.com/playwright:v1.49.0-jammy

WORKDIR /app

# Install only the playwright client (browsers are already in the base image).
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY agent.js ./

# One-shot: run the transfer and exit. `docker compose run` / a K8s Job drives it.
CMD ["node", "agent.js"]
