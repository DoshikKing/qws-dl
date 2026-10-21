FROM node:22-bookworm-slim AS web
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=secret,id=build_ca \
    if [ -f /run/secrets/build_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/build_ca; fi; \
    npm ci --ignore-scripts
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-venv ffmpeg git ca-certificates tini \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY scripts ./scripts
COPY requirements-orpheus.lock ./
RUN --mount=type=secret,id=build_ca \
    if [ -f /run/secrets/build_ca ]; then \
      cp /run/secrets/build_ca /usr/local/share/ca-certificates/build-proxy.crt; \
      update-ca-certificates; \
    fi \
    && PIP_CERT=/etc/ssl/certs/ca-certificates.crt RUNTIME_DIR=/opt/runtime bash scripts/install-orpheus.sh \
    && mv /opt/runtime/orpheusdl/config /opt/runtime/config-defaults \
    && ln -s /data/orpheus-config /opt/runtime/orpheusdl/config \
    && mkdir -p /data /downloads \
    && chown -R node:node /app /opt/runtime /data /downloads
COPY --from=web --chown=node:node /app/.output ./.output
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 \
    REQUESTS_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt \
    ORPHEUS_DIR=/opt/runtime/orpheusdl PYTHON_BIN=/opt/runtime/venv/bin/python \
    DATA_DIR=/data DOWNLOAD_DIR=/downloads
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD ["node", "-e", "const b=process.env.NUXT_APP_BASE_URL||'/';fetch('http://127.0.0.1:3000'+(b.endsWith('/')?b:b+'/')+'api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
ENTRYPOINT ["/usr/bin/tini", "-g", "--", "bash", "/app/scripts/container-start.sh"]
