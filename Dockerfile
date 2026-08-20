# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS build

WORKDIR /app

ARG VITE_API_BASE_URL=/api
ARG VITE_APP_BASE_PATH=/
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
ENV VITE_APP_BASE_PATH=${VITE_APP_BASE_PATH}

COPY package.json package-lock.json ./
RUN npm ci

# Copy only inputs needed by the build/runtime. This deliberately excludes local
# node_modules, .env, data and exports even when no .dockerignore is present.
COPY index.html vite.config.mjs tsconfig.server.json ./
COPY .openai ./.openai
COPY scripts ./scripts
COPY db ./db
COPY src ./src
COPY server ./server
COPY worker ./worker

RUN npm run build:all

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    API_HOST=0.0.0.0 \
    PORT=8787 \
    SERVE_FRONTEND=true \
    SAC_FLOW_REQUIRE_API_KEY=true \
    SAC_FLOW_REPOSITORY=json \
    SAC_FLOW_DISABLE_OUTBOUND_SENDS=true \
    SAC_FLOW_DATA_FILE=/app/data/sac-flow.json

WORKDIR /app

COPY --from=build /app/package.json /app/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-api ./dist-api
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/db ./db

RUN mkdir -p /app/data && chown -R node:node /app/data

USER node
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8787/api/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

CMD ["npm", "start"]
