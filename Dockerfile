# ── Stage 1: Install dependencies ──────────────────────────────────────────────
FROM oven/bun:1.2-alpine AS deps

WORKDIR /app

# Copy package files first for better layer caching
COPY package.json bun.lock* ./

# Install production + dev dependencies (needed for build)
RUN bun install --frozen-lockfile


# ── Stage 2: Build ──────────────────────────────────────────────────────────────
FROM oven/bun:1.2-alpine AS builder

WORKDIR /app

# Copy deps from previous stage
COPY --from=deps /app/node_modules ./node_modules

# Copy source files
COPY . .

# Build the project (compiles TypeScript → JS, or bundles with Bun)
RUN bun build ./src/index.ts \
      --target=bun \
      --outdir=./dist \
      --minify


# ── Stage 3: Production image ───────────────────────────────────────────────────
FROM oven/bun:1.2-alpine AS runner

WORKDIR /app

# Set NODE_ENV for production optimizations
ENV NODE_ENV=production

# Create a non-root user for security
RUN addgroup --system --gid 1001 appgroup && \
    adduser  --system --uid 1001 --ingroup appgroup appuser

# Copy only what's needed for runtime
COPY --from=builder --chown=appuser:appgroup /app/dist ./dist
COPY --from=builder --chown=appuser:appgroup /app/package.json ./package.json

# If you have runtime-only dependencies, install them here
# (skip if everything is bundled in dist/)
# COPY --from=deps /app/node_modules ./node_modules

# Switch to non-root user
USER appuser

# Railway injects PORT at runtime; default to 3000 locally
ENV PORT=3000
EXPOSE ${PORT}

# Health check — Railway uses this to decide when your service is ready
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:${PORT}/health || exit 1

# Start the built app
CMD ["bun", "run", "dist/index.js"]