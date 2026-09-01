# notebooklm-py REST server. Holds the host's Google session cookies via a bind
# mount, so it is never published to the host — internal compose network only.
FROM python:3.14-slim

RUN pip install --no-cache-dir 'notebooklm-py[server]==0.8.1'

# The server refuses to bind beyond loopback without this explicit opt-in.
ENV NOTEBOOKLM_SERVER_HOST=0.0.0.0 \
    NOTEBOOKLM_SERVER_PORT=8000 \
    NOTEBOOKLM_SERVER_ALLOW_EXTERNAL_BIND=1

EXPOSE 8000
CMD ["notebooklm-server"]
