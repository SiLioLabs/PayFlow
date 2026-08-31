# ── Stage 1: runtime ──────────────────────────────────────────────────────────
# Minimal image with tsx for runtime TypeScript execution.
FROM node:20-alpine AS runtime

WORKDIR /app

# Copy manifests and install production dependencies only.
COPY package.json package-lock.json ./
RUN npm ci --frozen-lockfile --omit=dev

# Install tsx globally before switching to non-root user.
RUN npm install -g tsx

# Create data directory for SQLite persistence (indexer writes events.db here).
# Must be done before switching to non-root user.
RUN mkdir -p /app/data

# Security: run as the built-in non-root "node" user.
USER node

# Copy all source files needed by the services.
COPY --chown=node:node keeper.ts indexer.ts metrics-server.ts ./
COPY --chown=node:node batch-optimizer.ts rpc-client.ts event-dedup.ts logger.ts ./
COPY --chown=node:node tsconfig.json ./

# All configuration is supplied via environment variables at runtime.
# See .env.example for the full list.
ENV NODE_ENV=production

# Emit unhandled rejection warnings as errors so the container exits non-zero
# on unexpected failures instead of hanging.
ENV NODE_OPTIONS=--unhandled-rejections=throw

# Health check: call the RPC getHealth endpoint.
# The container orchestrator can override this with its own probe.
HEALTHCHECK --interval=60s --timeout=10s --start-period=15s --retries=3 \
  CMD wget -qO- "${RPC_URL:-https://soroban-testnet.stellar.org}" \
      --post-data='{"jsonrpc":"2.0","id":1,"method":"getHealth"}' \
      --header='Content-Type: application/json' \
      | grep -q '"status":"healthy"' || exit 1

# Default CMD runs keeper; Compose overrides for indexer and metrics.
CMD ["tsx", "keeper.ts"]
