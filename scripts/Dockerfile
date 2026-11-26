# ── Stage 1: runtime ──────────────────────────────────────────────────────────
# Minimal image with tsx for runtime TypeScript execution.
#
# Node 24 is required: indexer.ts imports `node:sqlite`, which only became
# flagless in the Node 24 line (Node 20 needs --experimental-sqlite and still
# lacks APIs the indexer uses).
FROM node:24-alpine AS runtime

WORKDIR /app

# Copy manifests and install production dependencies only.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Install tsx globally before switching to non-root user.
RUN npm install -g tsx

# Create the data directory for SQLite persistence (indexer writes events.db
# here) and hand it to the non-root user — a root-owned directory would make
# every write fail once we switch to USER node below.
RUN mkdir -p /app/data && chown -R node:node /app/data

# Security: run as the built-in non-root "node" user.
USER node

# Copy every runtime file (sources, migrations, fixtures, tsconfig). The set
# of files included here is defined by .dockerignore — never by an explicit
# COPY list, which silently broke the image whenever a new module was added.
COPY --chown=node:node . ./

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
