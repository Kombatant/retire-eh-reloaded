# Two stages: build the static bundle with Node, then serve it with nginx.
# The final image holds only nginx and the built files (~50 MB).

# Debian-based Node, not Alpine: the lockfile was made on glibc, and the native
# build tools (rolldown, lightningcss) can miss their musl binaries on Alpine.
FROM node:22-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .

# Shown in the sidebar footer. There is no .git inside the build, so pass it in.
ARG APP_VERSION=docker
ENV APP_VERSION=${APP_VERSION}
RUN npm run build

FROM nginx:stable-alpine
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/healthz || exit 1
