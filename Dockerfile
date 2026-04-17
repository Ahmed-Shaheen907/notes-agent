# ── Build stage ────────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files first so Docker can cache the npm install layer.
# If you only change src/ files, npm install won't re-run on the next build.
COPY package*.json ./
RUN npm ci

# Copy source and compile TypeScript → JavaScript
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# ── Runtime stage ──────────────────────────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app

# Only install production dependencies in the runtime image to keep it small
COPY package*.json ./
RUN npm ci --omit=dev

# Copy the compiled output from the build stage
COPY --from=builder /app/dist ./dist

# The SQLite database file will live at /app/notes.db.
# Mount a host volume here so data persists across container restarts.
VOLUME ["/app"]

# Pass API keys via environment variables at runtime:
#   docker run -e ANTHROPIC_API_KEY=... notes-agent
ENV ANTHROPIC_API_KEY=""
ENV OPENAI_API_KEY=""
ENV DEFAULT_USER="default"

# Run the compiled CLI
CMD ["node", "dist/index.js"]
