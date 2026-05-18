# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Database provider: "sqlite" (default) or "postgresql"
ARG DB_PROVIDER=sqlite
ENV DB_PROVIDER=${DB_PROVIDER}

# Native build deps for modules that may compile from source (e.g., better-sqlite3 on arm64)
RUN apk add --no-cache python3 make g++

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies
RUN npm ci && npm cache clean --force

# Copy prisma schema and all migration variants
COPY prisma ./prisma/

# Configure database provider and install correct migrations
RUN sh prisma/setup-db.sh

# Generate Prisma Client
RUN npx prisma generate

# Copy source code
COPY src ./src

# Build TypeScript
RUN npx tsc

# Production stage
FROM node:20-alpine

# Database provider: "sqlite" (default) or "postgresql"
ARG DB_PROVIDER=sqlite
ENV DB_PROVIDER=${DB_PROVIDER}

# Install runtime packages and create non-root user
RUN apk add --no-cache openssl su-exec && \
    addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN apk add --no-cache --virtual .build-deps python3 make g++ && \
    npm ci --omit=dev && \
    npm cache clean --force && \
    apk del .build-deps

# Copy prisma schema and all migration variants for runtime and hydration template
COPY prisma ./prisma/
# Configure provider + install correct migrations in the runtime prisma dir
RUN sh prisma/setup-db.sh
# Create the hydration template from the configured prisma dir
RUN cp -R prisma prisma_template

# Copy built application from builder
COPY --from=builder /app/dist ./dist

# Copy the generated Prisma Client from builder to maintain the same structure
COPY --from=builder /app/src/generated ./dist/generated

# Create necessary directories (ownership will be set in entrypoint)
RUN mkdir -p /app/uploads /app/prisma

# Copy and set permissions for entrypoint script
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

# REMOVED: USER nodejs (We must stay root to fix permissions in entrypoint)

EXPOSE 8000

ENTRYPOINT ["./docker-entrypoint.sh"]
