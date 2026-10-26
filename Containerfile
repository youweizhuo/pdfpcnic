# pdfpcnic's site, served by nginx as an unprivileged user on port 8080.
#
#   podman build -t pdfpcnic .
#   podman run -d --name pdfpcnic -p 8080:8080 pdfpcnic
#
# docs/self-hosting.md sets it up as a service that starts with the server.

# The build's output is the same on every platform, so it runs on the builder's own.
FROM --platform=$BUILDPLATFORM docker.io/library/node:24-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
# Gzipped copies for nginx's gzip_static: compressed once here, not per request.
RUN npm run build \
 && find dist -type f ! -name '*.pdf' -size +1k -exec gzip -9 -k {} +

FROM docker.io/library/nginx:stable-alpine-slim
COPY deploy/nginx.conf /etc/nginx/nginx.conf
COPY --from=build /src/dist /usr/share/nginx/html
USER 101
EXPOSE 8080
ENTRYPOINT ["nginx", "-g", "daemon off;"]
