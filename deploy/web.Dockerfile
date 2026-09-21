FROM node:22-alpine AS build
WORKDIR /src
ENV NUXT_WEBSITE_ENV=production NUXT_PUBLIC_CONTENT_MODE=live NUXT_PUBLIC_INDEXING_ENABLED=false
COPY web/package.json web/package-lock.json ./web/
RUN cd web && npm ci
COPY admin/package.json admin/package-lock.json ./admin/
RUN cd admin && npm ci
COPY contracts ./contracts
COPY admin ./admin
RUN cd admin && VITE_WEBSITE_ASSET_BASE= npm run build
COPY web ./web
RUN cp -R admin/dist web/public/admin && cd web && npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 NUXT_ADMIN_DIST_DIR=/app/.output/public/admin
COPY --from=build --chown=node:node /src/web/.output ./.output
USER node
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
