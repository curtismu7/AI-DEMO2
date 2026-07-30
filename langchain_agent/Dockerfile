# Multi-stage Dockerfile for LangChain MCP OAuth Agent

# Build stage
FROM python:3.13-slim as builder

# Set working directory
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install Python dependencies
COPY langchain_agent/requirements.txt .
RUN pip install --no-cache-dir --user -r requirements.txt \
    && PATH="/root/.local/bin:$PATH" guardrails configure --disable-metrics --disable-remote-inferencing --token ""

# Production stage
ARG GIT_SHA=unknown
FROM python:3.13-slim
ENV GIT_SHA=$GIT_SHA

# Create non-root user
RUN groupadd -r appuser && useradd -r -g appuser appuser

# Set working directory
WORKDIR /app

# Install runtime dependencies (bash required by scripts/startup.sh shebang)
RUN apt-get update && apt-get install -y \
    bash \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy Python packages from builder
COPY --from=builder /root/.local /home/appuser/.local
# Copy the guardrails-ai config generated in the builder stage; without it,
# guardrails-ai's Validator base class raises ValueError at construction time.
COPY --from=builder /root/.guardrailsrc /home/appuser/.guardrailsrc

# Copy application code
COPY langchain_agent/src/ ./src/
# .codegraph/demo-codegraph.db is built by setup:fresh / scripts/build-codegraph.py.
# Image bake still uses /app/codegraph.db; compose overrides to demo-codegraph.db
# on the live-repo mount so the host CodeGraph CLI (codegraph.db) cannot collide.
# Copy it into the image; if it doesn't exist in the build context the COPY
# below would fail, so we first touch a placeholder via the builder stage and
# then let a host-side docker compose volume override it at runtime.
# The agent handles a missing/empty db gracefully (returns [] for all queries).
RUN touch /app/codegraph.db
# Prefer a pre-built index from the build context when present
# (host .codegraph/codegraph.db copied to langchain_agent/codegraph.db by
# setup:fresh / se-update-code.sh). A zero-byte placeholder makes Code Explorer
# return 503 "index not available" until Refresh index succeeds.
COPY langchain_agent/codegraph.db* /tmp/codegraph-build/
RUN if [ -f /tmp/codegraph-build/codegraph.db ] && [ -s /tmp/codegraph-build/codegraph.db ]; then \
      cp /tmp/codegraph-build/codegraph.db /app/codegraph.db; \
      echo "CodeGraph DB baked: $(wc -c < /app/codegraph.db) bytes"; \
    else \
      echo "WARNING: langchain_agent/codegraph.db missing/empty — Code Explorer will 503 until Refresh index"; \
    fi && rm -rf /tmp/codegraph-build
ENV CODEGRAPH_DB_PATH=/app/codegraph.db
# Always ship the current indexer (with --out) so Refresh does not depend on a
# stale copy under repo-src/scripts from an older image stage.
COPY scripts/build-codegraph.py /app/indexer/build-codegraph.py
ENV CODEGRAPH_INDEXER=/app/indexer/build-codegraph.py
COPY langchain_agent/scripts/ ./scripts/
# Code Explorer: the indexed repo source subset, staged by
# `build-codegraph.py --stage-src langchain_agent/repo-src` (run in setup:fresh /
# pre-image build). The agent's grep/read_file tools read from here.
COPY langchain_agent/repo-src/ ./repo-src/
ENV REPO_SRC_ROOT=/app/repo-src
COPY langchain_agent/.env.example ./

# Create necessary directories
RUN mkdir -p logs data config visualizations /app/indexer && \
    chown -R appuser:appuser /app && \
    chown appuser:appuser /home/appuser/.guardrailsrc

# Switch to non-root user
USER appuser

# Add local Python packages to PATH
ENV PATH=/home/appuser/.local/bin:$PATH
ENV PYTHONPATH=/app/src:$PYTHONPATH

# Expose ports
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8080/health || exit 1

# Default command
CMD ["python", "-m", "src.main"]