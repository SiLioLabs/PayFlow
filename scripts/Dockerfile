# ── Stage 1: build ────────────────────────────────────────────────────────────
# Compile keeper.ts to dist/keeper.js inside a full Node image so we have
# access to the TypeScript compiler without shipping it in the final image.
FROM node:20-alpine AS builder

WORKDIR /build

# Copy manifests first so Docker can cache the npm install layer independently
# of source changes.
COPY package.json package-lock.json ./

# Install all dependencies (including devDependencies for tsc).
# --frozen-lockfile ensures reproducible installs.
RUN npm ci --frozen-lockfile

# Copy source files needed for the keeper build.
COPY tsconfig.json tsconfig.build.json ./
COPY keeper.ts ./

# Compile. Output lands in /build/dist/keeper.js
RUN npm run build

# ── Stage 2: runtime ──────────────────────────────────────────────────────────
# Minimal image: only the compiled JS and production dependencies.
FROM node:20-alpine AS runtime

# Security: run as the built-in non-root "node" user.
USER node

WORKDIR /app

# Copy manifests and install production dependencies only.
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --frozen-lockfile --omit=dev

# Copy the compiled output from the builder stage.
COPY --chown=node:node --from=builder /build/dist ./dist

# All configuration is supplied via environment variables at runtime.
# See .env.example for the full list.
ENV NODE_ENV=production

# Emit unhandled rejection warnings as errors so the container exits non-zero
# on unexpected failures instead of hanging.
ENV NODE_OPTIONS=--unhandled-rejections=throw

# Health check: call the RPC getHealth endpoint.
# Requires HEALTH_CHECK_URL to be set (or falls back to RPC_URL/getHealth).
# The container orchestrator can override this with its own probe.
HEALTHCHECK --interval=60s --timeout=10s --start-period=15s --retries=3 \
  CMD wget -qO- "${RPC_URL:-https://soroban-testnet.stellar.org}" \
      --post-data='{"jsonrpc":"2.0","id":1,"method":"getHealth"}' \
      --header='Content-Type: application/json' \
      | grep -q '"status":"healthy"' || exit 1

CMD ["node", "dist/keeper.js"]
