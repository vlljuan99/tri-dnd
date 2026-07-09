# syntax=docker/dockerfile:1.7

# 1. Build del cliente (Vite)
FROM node:20-alpine AS client-build
WORKDIR /app/client
COPY client/package.json client/package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY client/ ./
RUN npm run build

# 2. Dependencias del servidor (better-sqlite3 necesita compilar en alpine)
FROM node:20-alpine AS server-deps
WORKDIR /app/server
RUN apk add --no-cache python3 make g++
COPY server/package.json server/package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

# 3. Runtime — un solo contenedor sirviendo API + build estático del cliente
FROM node:20-alpine AS runner
RUN apk add --no-cache tzdata
ENV NODE_ENV=production
ENV TZ=Europe/Madrid
WORKDIR /app
COPY --from=server-deps /app/server/node_modules ./server/node_modules
COPY server/ ./server/
COPY --from=client-build /app/client/dist ./client/dist

RUN mkdir -p /app/server/data/uploads
VOLUME ["/app/server/data"]

WORKDIR /app/server
EXPOSE 4000
CMD ["node", "src/index.js"]
