# Contributing & Repository Workflow

`career-os` enforces a strict, PR-only linear workflow backed by GitHub Repository Rulesets and stack-aware CI.

## Branch & Merge Rules

1. **Never push directly to `main` and never force-push.** All changes land through feature branches and pull requests (`git push` only; add follow-up commits rather than rewriting PR history).
2. **Squash-only linear history.** PRs squash-merge into `main` once `CI Gate` is green and review threads are resolved.
3. **Auto-merge policy:**
   - Dependabot `patch` / `minor` PRs automatically enable squash auto-merge via `.github/workflows/auto-merge.yml` (still gated on `CI Gate`).
   - Owner PRs may opt in by adding the `automerge` label after review.

## Stack-Based CI/CD Pipeline

- **`ci.yml` (`CI Gate`):** Uses `dorny/paths-filter` so only modified stacks run (`rust`, `web`, `scanner`, `docker`), while `security` (`gitleaks`, `actionlint`, `zizmor`) runs on every PR. The `CI Gate` aggregator job prevents skipped path checks from stalling required status checks.
- **`release-images.yml`:** On merge to `main`, builds multi-arch (`linux/arm64`, `linux/amd64`) distroless/Alpine images, attaches SBOM + SLSA build provenance, and signs manifests with keyless Cosign OIDC before publishing to GHCR.
