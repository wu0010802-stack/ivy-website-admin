# base image 以 multi-arch index digest 釘版（2026-11-12 讀自 Docker Hub）；tag 留給人看。
# 更新：Dependabot（.github/dependabot.yml）每週一會開 PR 換同 tag 的新 digest；換 tag 時重新讀 digest 後兩個一起改。
FROM node:22-alpine@sha256:1314fb30ec37592d5845e5a160d522c0e680972aa534549940b8d73bde88481a AS build
WORKDIR /src
ENV NUXT_WEBSITE_ENV=production NUXT_PUBLIC_CONTENT_MODE=live NUXT_PUBLIC_INDEXING_ENABLED=false
COPY web/package.json web/package-lock.json ./web/
RUN cd web && npm ci
COPY admin/package.json admin/package-lock.json ./admin/
COPY admin/vendor ./admin/vendor
RUN cd admin && npm ci
COPY contracts ./contracts
COPY admin ./admin
RUN cd admin && VITE_WEBSITE_ASSET_BASE= npm run build
COPY web ./web
RUN cp -R admin/dist web/public/admin && cd web && npm run build

FROM node:22-alpine@sha256:1314fb30ec37592d5845e5a160d522c0e680972aa534549940b8d73bde88481a
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 NUXT_ADMIN_DIST_DIR=/app/.output/public/admin
COPY --from=build --chown=node:node /src/web/.output ./.output
USER node
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
