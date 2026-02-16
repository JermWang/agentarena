FROM node:20-slim

WORKDIR /app

# Install OpenSSL for Prisma
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

# Copy workspace root files
COPY package.json package-lock.json ./
COPY packages/server/package.json packages/server/

# Install dependencies
RUN npm ci --workspace=packages/server

# Copy server source
COPY packages/server/ packages/server/

# Generate Prisma client
RUN npx prisma generate --schema=packages/server/prisma/schema.prisma

# Build TypeScript
RUN npm run build --workspace=packages/server

EXPOSE 3001

CMD ["node", "packages/server/dist/index.js"]
