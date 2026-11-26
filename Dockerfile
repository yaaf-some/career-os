# syntax=docker/dockerfile:1.7

# Stage 1: Build React 19 PWA on host build platform (arch-independent static assets)
FROM --platform=$BUILDPLATFORM node:26-alpine AS web-builder
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

# Stage 2: Shared Rust + cargo-chef base (Debian 13 Trixie)
FROM lukemathwalker/cargo-chef:0.1.78-rust-slim-trixie AS chef
WORKDIR /build

# Stage 3: Compute dependency recipe (changes only when Cargo.toml / Cargo.lock change)
FROM chef AS planner
COPY Cargo.toml Cargo.lock ./
COPY crates ./crates
RUN cargo chef prepare --recipe-path recipe.json

# Stage 4: Pre-compile & cache dependencies, then build stripped release binary
FROM chef AS rust-builder
COPY --from=planner /build/recipe.json recipe.json
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    cargo chef cook --release --recipe-path recipe.json
COPY Cargo.toml Cargo.lock ./
COPY crates ./crates
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    cargo build --release --locked --bin career-os-api

# Stage 5: Minimal Distroless Debian 13 runtime (no shell, no apt, non-root UID 65532)
FROM gcr.io/distroless/cc-debian13:nonroot
WORKDIR /app

COPY --from=rust-builder --chown=65532:65532 /build/target/release/career-os-api /app/career-os-api
COPY --from=web-builder --chown=65532:65532 /web/dist /app/static

USER nonroot:nonroot
ENV STATIC_DIR=/app/static
ENV CAREER_OS_BIND=0.0.0.0:8080

EXPOSE 8080
ENTRYPOINT ["/app/career-os-api"]
