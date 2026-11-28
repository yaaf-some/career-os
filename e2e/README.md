# End-to-end tests

Runs the real API, scanner and built web app against synthetic data: mock AI, a
temporary database, no Google, no real tokens. It never touches ports 8080 or 8787.

```bash
(cd web && npm ci && npm run build)
cd e2e && npm ci && npm run install-browser   # once
npm test                                      # E2E_PORT=18101 npm test for another port
```

To click around by hand: `e2e/run-local.sh 18100`, then `e2e/seed.sh 18100` in
another terminal and open <http://127.0.0.1:18100>.

Screenshots go to `e2e/artifacts/` (ignored by Git).
