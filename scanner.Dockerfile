FROM node:22-alpine

WORKDIR /app

RUN apk upgrade --no-cache \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
  && addgroup -S scanner && adduser -S -G scanner scanner

COPY --chown=scanner:scanner scanner/package.json ./
COPY --chown=scanner:scanner scanner/src ./src

USER scanner

ENV NODE_ENV=production
ENV PORT=8081

EXPOSE 8081
CMD ["node", "src/server.mjs"]
