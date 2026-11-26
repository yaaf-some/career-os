FROM node:22-alpine

WORKDIR /app

RUN addgroup -S scanner && adduser -S -G scanner scanner

COPY scanner/package*.json ./
RUN npm ci --omit=dev

COPY scanner/ ./
RUN chown -R scanner:scanner /app

USER scanner

ENV NODE_ENV=production
ENV PORT=8081

EXPOSE 8081
CMD ["node", "src/server.mjs"]
