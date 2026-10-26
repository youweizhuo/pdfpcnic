# Self-hosting

pdfpcnic is a static site, so any web server can host it. The container image bundles the site with nginx, and Podman
runs it as a service that starts again after the server reboots.

## Build the image

```sh
podman build -t pdfpcnic https://github.com/youweizhuo/pdfpcnic.git#main
```

Use a release tag such as `#v1.0.0` in place of `#main` to pin a version, or run `podman build -t pdfpcnic .` in a
checkout. The image is about 25 MB: nginx with the site, serving port 8080 as an unprivileged user. Try it:

```sh
podman run --rm -p 8080:8080 pdfpcnic
```

Then open <http://localhost:8080>. With Docker, the build is `docker build -f Containerfile -t pdfpcnic .`, and
`docker run -d --restart unless-stopped -p 8080:8080 pdfpcnic` keeps it running across reboots.

## Run it as a service

Podman 4.4 and later run containers as systemd services through Quadlet, from a unit file:
[`deploy/pdfpcnic.container`](../deploy/pdfpcnic.container). As your own user (rootless):

```sh
mkdir -p ~/.config/containers/systemd
curl -o ~/.config/containers/systemd/pdfpcnic.container \
  https://raw.githubusercontent.com/youweizhuo/pdfpcnic/main/deploy/pdfpcnic.container
systemctl --user daemon-reload
systemctl --user start pdfpcnic
sudo loginctl enable-linger "$USER"
```

The last line starts your services at boot, before you log in, and keeps them running after you log out. You don't
need `systemctl enable`: the unit's `[Install]` section takes care of starting it at boot, and `Restart=always`
restarts it if nginx ever exits. To check on it, run `systemctl --user status pdfpcnic` and
`journalctl --user -u pdfpcnic`.

To run it as root instead, build the image with `sudo podman build …`, put the file in `/etc/containers/systemd/`, and
use `sudo systemctl` without `--user`. Root needs no linger.

Older Podman, such as the 4.3 in Debian 12, has no Quadlet. Have Podman write the unit instead:

```sh
podman create --name pdfpcnic -p 8080:8080 --read-only pdfpcnic
podman generate systemd --new --name pdfpcnic --restart-policy=always --files
mkdir -p ~/.config/systemd/user
mv container-pdfpcnic.service ~/.config/systemd/user/
podman rm pdfpcnic
systemctl --user daemon-reload
systemctl --user enable --now container-pdfpcnic
sudo loginctl enable-linger "$USER"
```

## Update

```sh
podman build -t pdfpcnic https://github.com/youweizhuo/pdfpcnic.git#main
systemctl --user restart pdfpcnic
podman image prune -f
```

A talk in progress carries on with the version it loaded, and the new version arrives the next time the page loads.

## HTTPS

Chrome and Edge move the audience window to the projector and make it fullscreen only on a secure page: one served
over `https://`, or from `localhost`. Over plain `http://` from another machine, everything else works, but you place
the audience window yourself. So put the container behind your HTTPS reverse proxy. With
[Caddy](https://caddyserver.com/), which gets the certificate itself:

```
slides.example.com {
	reverse_proxy 127.0.0.1:8080
}
```

With nginx, add `location / { proxy_pass http://127.0.0.1:8080; }` to the HTTPS server block. Then publish the port to
the proxy alone: set `PublishPort=127.0.0.1:8080:8080` in the unit file.

A path such as `https://example.com/slides/` works too, because the site's links are all relative. Keep the trailing
slash. With nginx, use `location /slides/ { proxy_pass http://127.0.0.1:8080/; }`.

## Without a container

Run `npm ci && npm run build`, then serve `dist/` with any web server. Two things matter:

- Serve `.mjs` files as JavaScript (`text/javascript`). Browsers refuse a module worker served as anything else, and
  pdf.js's worker is one.
- Files under `assets/` have content hashes in their names, so they can be cached for good.
  [`deploy/nginx.conf`](../deploy/nginx.conf) does both, and serves gzipped copies made at build time.

## What the server sees

Only requests for the site's own files, which nginx logs to the journal. The browser reads your PDF and notes; they
are never sent to the server.
