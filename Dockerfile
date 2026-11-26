# syntax=docker/dockerfile:1

# Base images are pinned by tag + digest for reproducible builds; Dependabot (docker ecosystem)
# bumps both together. Builds run natively per-arch (no QEMU) in CI/release.

# Stage 1: Build React 19 PWA on the build platform (static assets are arch-independent)
FROM --platform=$BUILDPLATFORM node:26.9.0-alpine3.23@sha256:9dac39bfd053b458593c44a099d2667994c8fa9e1a8c10bc7ff2f3d97b62412d AS web-builder
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

# Stage 2: Shared Rust toolchain + cargo-chef base (Debian 13 Trixie, slim)
FROM lukemathwalker/cargo-chef:0.1.78-rust-1.100.0-slim-trixie@sha256:4d92a0744e1fc09016839c7658af38a00157c8d542a1684b32ce60f9a364fd31 AS chef
WORKDIR /build
ENV CARGO_TERM_COLOR=never \
    CARGO_INCREMENTAL=0

# Stage 3: Compute dependency recipe (changes only when manifests change)
FROM chef AS planner
COPY Cargo.toml Cargo.lock ./
COPY crates ./crates
RUN cargo chef prepare --recipe-path recipe.json

# Stage 4: Pre-compile & cache dependencies, then build the stripped release binary.
# Swagger UI assets are vendored (utoipa-swagger-ui `vendored` feature): no network fetch in build.rs.
FROM chef AS rust-builder
COPY --from=planner /build/recipe.json recipe.json
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    cargo chef cook --release --locked --recipe-path recipe.json --bin career-os-api
COPY Cargo.toml Cargo.lock ./
COPY crates ./crates
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    cargo build --release --locked --bin career-os-api \
    && mkdir -p /rootfs/var/lib/career-os

# Stage 5: Minimal Distroless Debian 13 runtime (glibc + libgcc + CA certs + tzdata;
# no shell, no package manager, non-root UID/GID 65532)
FROM gcr.io/distroless/cc-debian13:nonroot@sha256:29ee70762214fe8190cea04ef1c0a84a8365879e047ce8f911ae5a5ab2355fa2

LABEL org.opencontainers.image.title="career-os-app" \
      org.opencontainers.image.description="career-os API + PWA (Axum, SQLite WAL, React 19)" \
      org.opencontainers.image.source="https://github.com/yaaf-some/career-os" \
      org.opencontainers.image.licenses="MIT"

WORKDIR /app

# Binary and static assets stay root-owned (read-only to the runtime user);
# only the SQLite data directory is writable by nonroot.
COPY --from=rust-builder /build/target/release/career-os-api /app/career-os-api
COPY --from=web-builder /web/dist /app/static
COPY --from=rust-builder --chown=65532:65532 /rootfs/var/lib/career-os /var/lib/career-os

USER 65532:65532
ENV STATIC_DIR=/app/static \
    CAREER_OS_BIND=0.0.0.0:8080 \
    DATABASE_URL="sqlite:///var/lib/career-os/career-os.db?mode=rwc"

VOLUME ["/var/lib/career-os"]
EXPOSE 8080
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD ["/app/career-os-api", "--healthcheck"]
ENTRYPOINT ["/app/career-os-api"]
