ARG GIT_SHA=unknown
FROM python:3.11-slim

# Half of what CI needs to push this image to GHCR: this links the package to
# the repo on push. The other half is NOT in this repo — the package's
# "Manage Actions access" list must also contain AI-DEMO2 with the Write role
# (UI only, starts empty). Either one missing gives the same
# "denied: permission_denied: write_package". See demo_llm_proxy/Dockerfile.
#
# Must sit in the FINAL stage: a LABEL applies only to the stage it is in, and
# no compose service sets `target:`, so the last stage is what gets built.
LABEL org.opencontainers.image.source=https://github.com/curtismu7/AI-DEMO2
ENV GIT_SHA=$GIT_SHA

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt && guardrails configure --disable-metrics --disable-remote-inferencing --token ""

COPY src/ ./src/

EXPOSE 8893

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD python3 -c "import urllib.request; urllib.request.urlopen('http://localhost:8893/health')" || exit 1

CMD ["python3", "-m", "uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8893"]
