FROM gcr.io/distroless/nodejs22-debian12:nonroot

WORKDIR /app

COPY --chown=nonroot:nonroot scanner/package.json ./
COPY --chown=nonroot:nonroot scanner/src ./src

ENV NODE_ENV=production
ENV PORT=8081

EXPOSE 8081
CMD ["src/server.mjs"]
