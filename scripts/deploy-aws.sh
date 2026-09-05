#!/usr/bin/env bash
set -euo pipefail

npm ci
npm run build
npm --prefix infra ci
npm --prefix infra run deploy
