# syntax=docker/dockerfile:1

# ---- build stage: install production deps only -------------------------------
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ---- runtime stage -----------------------------------------------------------
FROM node:20-alpine AS runtime

# dumb-init reaps zombies and forwards SIGTERM, so the server's SIGINT handler
# actually runs on `docker stop` instead of the container being SIGKILLed.
RUN apk add --no-cache dumb-init

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY public ./public
# The demo preloads this file at boot, so it has to be in the image. Copying the
# one directory rather than all of docs/ keeps the markdown out of the runtime.
COPY docs/examples ./docs/examples

# Run unprivileged. The node image ships a `node` user (uid 1000).
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get({host:'127.0.0.1',port:process.env.PORT||3000,path:'/',timeout:2500},r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "src/server.js"]
