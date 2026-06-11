# Copyright 2026 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#      http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

# Container image for the superdemo frontend, deployed to Cloud Run by
# deploy/deploy-superdemo-app.sh. Builds the Vite SPA, then serves it with Caddy.
# Caddy also reverse-proxies /api/* to the backend service (set via $BACKEND_HOST),
# so the browser only ever talks to a single origin — the production twin of the
# Vite dev-server proxy, and the reason no CORS configuration is needed.

# ── Stage 1: build the SPA ────────────────────────────────────────────
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ── Stage 2: serve with Caddy ─────────────────────────────────────────
FROM caddy:2-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv
