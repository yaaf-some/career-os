# syntax=docker/dockerfile:1

# Zero-dependency Node service: no npm/npx/corepack shipped at runtime, non-root UID 10001.
# Base pinned by tag + digest; Dependabot (docker ecosystem) bumps both together.
FROM node:26.9.0-alpine3.23@sha256:9dac39bfd053b458593c44a099d2667994c8fa9e1a8c10bc7ff2f3d97b62412d

LABEL org.opencontainers.image.title="career-os-scanner" \
      org.opencontainers.image.description="career-os internal ATS/portal scanner" \
      org.opencontainers.image.source="https://github.com/yaaf-some/career-os" \
      org.opencontainers.image.licenses="MIT"

WORKDIR /app

RUN apk upgrade --no-cache \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
  && addgroup -S -g 10001 scanner \
  && adduser -S -u 10001 -G scanner scanner

COPY --chown=scanner:scanner scanner/package.json ./
COPY --chown=scanner:scanner scanner/src ./src

USER 10001:10001

ENV NODE_ENV=production
ENV PORT=8081

EXPOSE 8081
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8081/healthz').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "src/server.mjs"]
