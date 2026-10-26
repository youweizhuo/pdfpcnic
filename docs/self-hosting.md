# Self-hosting

pdfpcnic is a static site, so any web server can host it. The container image bundles the site with nginx, and Podman
runs it as a service that starts again after the server reboots.

## The image

```sh
podman run --rm -p 8080:8080 ghcr.io/youweizhuo/pdfpcnic:1
```

Then open <http://localhost:8080>. The image is about 25 MB, for amd64 and arm64: nginx with the site, serving port
8080 as an unprivileged user. The tag `1` follows the 1.x releases; `1.0.0` pins one. With Docker,
`docker run -d --restart unless-stopped -p 8080:8080 ghcr.io/youweizhuo/pdfpcnic:1` keeps it running across reboots.

To build it yourself instead, from a release or a checkout (`podman build -t pdfpcnic .`):

```sh
podman build -t pdfpcnic https://github.com/youweizhuo/pdfpcnic.git#v1.0.0
```

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

The first start pulls the image. The last line starts your services at boot, before you log in, and keeps them
running after you log out. You don't need `systemctl enable`: the unit's `[Install]` section takes care of starting it
at boot, and `Restart=always` restarts it if nginx ever exits. To check on it, run `systemctl --user status pdfpcnic`
and `journalctl --user -u pdfpcnic`.

To run it as root instead, put the file in `/etc/containers/systemd/` and use `sudo systemctl` without `--user`. Root
needs no linger. For an image you built, set `Image=localhost/pdfpcnic` in the file and remove `AutoUpdate=registry`.

Older Podman, such as the 4.3 in Debian 12, has no Quadlet. Have Podman write the unit instead:

```sh
podman create --name pdfpcnic -p 8080:8080 --read-only ghcr.io/youweizhuo/pdfpcnic:1
podman generate systemd --new --name pdfpcnic --restart-policy=always --files
mkdir -p ~/.config/systemd/user
mv container-pdfpcnic.service ~/.config/systemd/user/
podman rm pdfpcnic
systemctl --user daemon-reload
systemctl --user enable --now container-pdfpcnic
sudo loginctl enable-linger "$USER"
```

## Update

The unit marks the image for Podman's auto-update, which pulls a newer `1` release and restarts the service:

```sh
podman auto-update                                    # now
systemctl --user enable --now podman-auto-update.timer  # every day
```

For an image you built, build it again from the new release, run `systemctl --user restart pdfpcnic`, and clear out the
old one with `podman image prune -f`. Either way, a talk in progress carries on with the version it loaded, and the new
version arrives the next time the page loads.

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
