FROM node:22-alpine

# Links this package to the repo on push. Without it GHCR refuses the push with
# "denied: permission_denied: write_package" — identical to the error you get
# when the package's "Manage Actions access" list lacks this repo. BOTH are
# required; one without the other fails the same way. Single-stage build, so
# this is the final stage.
LABEL org.opencontainers.image.source=https://github.com/curtismu7/AI-DEMO2

WORKDIR /app

# Lockfiles are gitignored repo-wide, so install (not `npm ci`) to build
# reliably from a fresh checkout.
COPY package*.json ./
RUN npm install

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

EXPOSE 8095

CMD ["npm", "start"]
