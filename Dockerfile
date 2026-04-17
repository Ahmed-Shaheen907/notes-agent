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

# Copy compiled JS from build stage and the static HTML chat UI
COPY --from=builder /app/dist ./dist
COPY public/ ./public/

# Create the data directory for SQLite
RUN mkdir -p /app/data

EXPOSE 3000

ENV GEMINI_API_KEY=""
ENV OPENAI_API_KEY=""
ENV DEFAULT_USER="default"
ENV PORT="3000"

# Run the web server (not the CLI)
CMD ["node", "dist/server.js"]
