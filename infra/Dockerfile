# syntax=docker/dockerfile:1
# All targets use the root workspace and its committed dependency lock.
FROM node:24-bookworm-slim AS workspace
WORKDIR /app
COPY . .
RUN npm ci

FROM workspace AS web-build
RUN npm run build

FROM nginx:1.28-alpine AS web
COPY --from=web-build /app/apps/web/dist /usr/share/nginx/html
COPY infra/nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY infra/nginx/api-proxy.conf /etc/nginx/snippets/api-proxy.conf

# Keep the existing TypeScript execution mode. The same image runs the
# existing Drizzle Kit migration, so its tooling is intentionally retained.
FROM workspace AS server
ENV NODE_ENV=production
USER node
ENTRYPOINT ["node", "--experimental-strip-types", "scripts/container-start.mjs"]
CMD ["api"]
