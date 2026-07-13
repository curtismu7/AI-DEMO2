ARG GIT_SHA=unknown
FROM python:3.11-slim
ENV GIT_SHA=$GIT_SHA

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt && guardrails configure --disable-metrics --disable-remote-inferencing --token ""

COPY src/ ./src/

EXPOSE 8893

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD python3 -c "import urllib.request; urllib.request.urlopen('http://localhost:8893/health')" || exit 1

CMD ["python3", "-m", "uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8893"]
