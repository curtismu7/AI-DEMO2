FROM node:22-alpine

# Links the pushed GHCR package to this repository. Without it a package stays
# owned by whoever first pushed it with `repository: NONE`, and a repository's
# GITHUB_TOKEN — even holding `Packages: write`, which it does — is refused with
# "denied: permission_denied: write_package", because there is no repo-to-package
# association for an Actions-access grant to attach to. That is why CI could not
# push and why the per-package UI grant appeared to do nothing.
#
# CONFIRMED 2026-08-28 (#2545): the first push carrying this label flipped
# ai-demo-llm-proxy from repository: NONE to curtismu7/AI-DEMO2, which let
# build-images.yml go back to GITHUB_TOKEN and retire the classic PAT. Any
# service whose Dockerfile lacks this label will fail its push exactly as before
# — add the label, do not reach for a PAT. Check with:
#   gh api user/packages/container/<pkg> --jq .repository.full_name
LABEL org.opencontainers.image.source=https://github.com/curtismu7/AI-DEMO2

WORKDIR /app

COPY package.json ./
RUN npm install --production

COPY router.js posthogAi.js .

EXPOSE 8090
ENV LLM_PROXY_PORT=8090

# Mirrors demo_agent_service/demo_mcp_gateway healthchecks. /health returns 503
# while the model tier is degraded, so Docker shows unhealthy during real trouble
# but healthy through normal tier swaps (start-period covers cold boot).
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8090/health || exit 1

CMD ["npm", "start"]
