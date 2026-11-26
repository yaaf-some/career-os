# syntax=docker/dockerfile:1.7

FROM node:26-alpine

WORKDIR /app

RUN apk upgrade --no-cache \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
  && addgroup -S -g 10001 scanner \
  && adduser -S -u 10001 -G scanner scanner

COPY --chown=scanner:scanner scanner/package.json ./
COPY --chown=scanner:scanner scanner/src ./src

USER scanner

ENV NODE_ENV=production
ENV PORT=8081

EXPOSE 8081
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8081/healthz').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "src/server.mjs"]
