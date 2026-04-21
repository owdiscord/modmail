FROM oven/bun:1.3.13-alpine

WORKDIR /app

COPY package.json bun.lock .

# Install deps
RUN bun install --frozen-lockfile

COPY ./src ./src
COPY ./migrations ./migrations
COPY tsconfig.json tsconfig.json

CMD ["bun", "src/index.js"]
