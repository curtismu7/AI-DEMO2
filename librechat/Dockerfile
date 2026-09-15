# The upstream LibreChat image supplies the application and its supported
# Ariakit menu primitives. This narrow overlay only adds grouped model-spec
# paths (for example, "Demo Steps / Banking") to the selector, then rebuilds
# the client bundle. It leaves OAuth, MCP, and all server paths upstream.
FROM registry.librechat.ai/danny-avila/librechat-dev:latest AS builder

COPY overrides/CustomGroup.tsx /app/client/src/components/Chat/Menus/Endpoints/components/CustomGroup.tsx

# The upstream runtime image excludes frontend dev dependencies, including
# Vite. Install them only in this derived image so the changed selector source
# can be compiled into the browser bundle.
RUN npm ci --include=dev --ignore-scripts && npm run build:client

FROM registry.librechat.ai/danny-avila/librechat-dev:latest

COPY --from=builder /app/client/dist /app/client/dist
