# python:3.12-slim (debian/glibc), NOT alpine: torch publishes no musl wheels.
FROM python:3.12-slim
ARG GIT_SHA=unknown
ENV GIT_SHA=$GIT_SHA

WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Bake the weights into the image so the pod starts offline and fast. The default
# model (ProtectAI deberta prompt-injection) is public — no token needed. To bake a
# GATED model instead (e.g. Meta Prompt-Guard), accept its licence on huggingface.co
# and pass --build-arg HF_TOKEN=hf_xxx. HF_HOME must match at runtime so the cache is found.
ARG HF_TOKEN=""
ARG PROMPTGUARD_MODEL=protectai/deberta-v3-base-prompt-injection-v2
ENV HF_HOME=/app/.hf PROMPTGUARD_MODEL=$PROMPTGUARD_MODEL
COPY server.py ./
RUN HF_TOKEN=$HF_TOKEN python -c "from transformers import pipeline; pipeline('text-classification', model='$PROMPTGUARD_MODEL')"

EXPOSE 8086
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:'+__import__('os').environ.get('PORT','8086')+'/health').status==200 else 1)"
CMD ["python", "server.py"]
