
FROM oven/bun:1.3.6

WORKDIR /app


COPY package.json bun.lock ./
COPY backend/package.json backend/
COPY db/package.json db/

RUN bun install --frozen-lockfile --ignore-scripts

COPY db/prisma.config.ts db/tsconfig.json db/
COPY db/prisma db/prisma
COPY db/src db/src
COPY backend/tsconfig.json backend/
COPY backend/src backend/src

RUN cd db && DATABASE_URL="postgresql://build:build@localhost:5432/build" bunx prisma generate

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["sh", "-c", "cd /app/db && bunx prisma migrate deploy && cd /app/backend && bun run src/index.ts"]
