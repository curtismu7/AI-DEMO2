ARG GIT_SHA=unknown
FROM python:3.11-slim
ENV GIT_SHA=$GIT_SHA

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY src/ ./src/

EXPOSE 8891

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD python3 -c "import socket; s=socket.socket(); s.settimeout(5); s.connect(('localhost',8891)); s.close()"

CMD ["python3", "-m", "uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8891"]
