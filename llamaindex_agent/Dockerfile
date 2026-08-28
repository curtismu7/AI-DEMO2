FROM python:3.11-slim

# Links this package to the repo on push. Without it GHCR refuses the push with
# "denied: permission_denied: write_package" — identical to the error you get
# when the package's "Manage Actions access" list lacks this repo. BOTH are
# required; one without the other fails the same way. Single-stage build, so
# this is the final stage.
LABEL org.opencontainers.image.source=https://github.com/curtismu7/AI-DEMO2
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 8894
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8894"]
