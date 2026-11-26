# Stage 1: Build React 19 PWA
FROM node:26-alpine AS web-builder
WORKDIR /web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# Stage 2: Build Rust Axum API binary with BuildKit cargo cache
FROM rust:1-trixie AS rust-builder
WORKDIR /build
COPY Cargo.toml Cargo.lock* ./
COPY crates ./crates
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/build/target \
    cargo build --release --bin career-os-api \
    && mkdir -p /out \
    && cp /build/target/release/career-os-api /out/career-os-api

# Stage 3: Minimal Debian 13 Trixie runtime
FROM debian:trixie-slim
WORKDIR /app

# hadolint ignore=DL3008
RUN apt-get update \
    && apt-get upgrade -y --no-install-recommends \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 --no-create-home --shell /usr/sbin/nologin app

COPY --from=rust-builder --chown=app:app /out/career-os-api /app/career-os-api
COPY --from=web-builder --chown=app:app /web/dist /app/static

USER app
ENV STATIC_DIR=/app/static
ENV CAREER_OS_BIND=0.0.0.0:8080

EXPOSE 8080
ENTRYPOINT ["/app/career-os-api"]
