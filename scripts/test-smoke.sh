#!/usr/bin/env bash
# Mirror of the CI smoke pipeline. Each step fails loudly via `set -e`;
# `pipefail` catches mid-pipe failures; `nounset` flags missing env vars.
set -euo pipefail

bun run build
bun link
bun --cwd=tests/smoke/fixture install
bun test tests/smoke.test.ts
