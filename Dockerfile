#
# --- Build stage ---
#
FROM node:24-alpine AS builder

# Enable and install pnpm using Corepack, the new in-built Node tool.
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy the manifests and install all deps - this includes dev deps for the build stage.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# Copy the source and typescript config, then compile Typescript to JS with SWC.
COPY tsconfig.json ./
COPY src/ ./src/
RUN pnpm run build

#
# --- Runtime stage ----
#
FROM node:24-alpine AS runtime

# Same as above, use Corepack to enable pnpm.
RUN corepack enable && corepack prepare pnpm@latest --activate

# Install production dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod

# Bring in the compiled JS output and migrations
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./
COPY migrations/ ./migrations

CMD ["pnpm", "run", "start"]
