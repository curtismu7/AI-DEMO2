ARG GIT_SHA=unknown
FROM python:3.12-slim
ENV GIT_SHA=$GIT_SHA

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY server.py ./

EXPOSE 8083

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD python3 -c "import urllib.request; urllib.request.urlopen('http://localhost:8083/health')" || exit 1

CMD ["python3", "server.py"]
