# Stage 1: Build React 19 PWA
FROM node:22-alpine AS web-builder
WORKDIR /web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# Stage 2: Build Rust Axum API binary
FROM rust:1.85-bookworm AS rust-builder
WORKDIR /build
COPY Cargo.toml Cargo.lock* ./
COPY crates ./crates
RUN cargo build --release --bin career-os-api

# Stage 3: Minimal distroless runtime
FROM gcr.io/distroless/cc-debian12:nonroot
WORKDIR /app

COPY --from=rust-builder /build/target/release/career-os-api /app/career-os-api
COPY --from=web-builder /web/dist /app/static

ENV STATIC_DIR=/app/static
ENV CAREER_OS_BIND=0.0.0.0:8080

EXPOSE 8080
ENTRYPOINT ["/app/career-os-api"]
