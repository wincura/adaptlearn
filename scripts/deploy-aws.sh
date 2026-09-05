#!/usr/bin/env bash
set -euo pipefail

# keys/key.txt is intentionally git-ignored and is for local development.
# Read only the E2B entry so a local deployment can pass it to CDK without
# committing it. GitHub Actions supplies the same value from its secret.
if [[ -z "${E2B_API_KEY:-}" && -r keys/key.txt ]]; then
  E2B_API_KEY="$(node -e "const fs=require('fs'); const line=fs.readFileSync('keys/key.txt','utf8').split(/\\r?\\n/).find((entry)=>/^\\s*E2B_API_KEY\\s*=/.test(entry)); if (line) process.stdout.write(line.replace(/^\\s*E2B_API_KEY\\s*=\\s*/, '').trim().replace(/^['\"]|['\"]$/g, '')); ")"
  export E2B_API_KEY
fi

if [[ "${SANDBOX_EXECUTOR:-e2b}" != "local" && -z "${E2B_API_KEY:-}" ]]; then
  echo "E2B_API_KEY is required for an E2B Lambda deployment. Set it in the environment or add E2B_API_KEY=e2b_... to keys/key.txt." >&2
  exit 1
fi

npm ci
npm run build
npm --prefix infra ci
npm --prefix infra run deploy
