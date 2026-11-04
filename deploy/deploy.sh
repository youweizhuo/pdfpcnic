#!/bin/sh
# Deploys pdfpcnic's deck server on this machine, then checks it. Run it again to update: the decks stay.
#
#   deploy/deploy.sh https://pdfpcnic.youwei.xyz
#
# Public port (the Cloudflare tunnel points here): the site, and decks to read by their token.
# Upload port (on every network this machine is on, with no password): uploads decks, and can't change or delete any.
#
# Settings, as environment variables:
#   IMAGE        the image to run; by default it's built from this checkout
#   VIEW_PORT    the public port, on 127.0.0.1 only (28613)
#   UPLOAD_PORT  the upload port (28614)
set -eu

public_url=${1:-}
view_port=${VIEW_PORT:-28613}
upload_port=${UPLOAD_PORT:-28614}
name=pdfpcnic
volume=pdfpcnic-decks

if command -v podman >/dev/null 2>&1; then engine=podman
elif command -v docker >/dev/null 2>&1; then engine=docker
else echo "Install Podman or Docker first." >&2; exit 1
fi

here=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
if [ -n "${IMAGE:-}" ]; then
  image=$IMAGE
  "$engine" pull "$image"
else
  image=localhost/pdfpcnic
  echo "Building the image from $here…"
  "$engine" build -t "$image" -f "$here/Containerfile" "$here"
fi

echo "Starting the container with $engine…"
"$engine" rm -f "$name" >/dev/null 2>&1 || true
"$engine" volume create "$volume" >/dev/null
"$engine" run -d --name "$name" --restart=always \
  -p "127.0.0.1:$view_port:8080" -p "$upload_port:8081" \
  --read-only --tmpfs /tmp --cap-drop=ALL --security-opt no-new-privileges \
  -v "$volume:/data" "$image" >/dev/null

if [ -n "$public_url" ]; then
  "$engine" exec "$name" sh -c 'printf "%s\n" "$1" > /data/public-url' sh "$public_url"
fi

# With Podman, nothing brings a container back after a reboot unless this is on.
if [ "$engine" = podman ] && command -v systemctl >/dev/null 2>&1; then
  systemctl --user enable podman-restart.service >/dev/null 2>&1 ||
    echo "Warning: couldn't enable podman-restart.service, so the container may not return after a reboot."
  if [ "$(loginctl show-user "$(id -un)" --property=Linger --value 2>/dev/null)" != yes ]; then
    echo "Warning: run 'sudo loginctl enable-linger $(id -un)' so it also starts before you log in."
  fi
fi

view=http://127.0.0.1:$view_port
upload=http://127.0.0.1:$upload_port
failed=0
code() { curl -s -o /dev/null -m 15 -w '%{http_code}' "$@" || true; }
expect() { # what, the answers that pass, the answer
  case " $2 " in
    *" $3 "*) echo "  ok    $1" ;;
    *) echo "  FAIL  $1: answered $3, expected $2"; failed=1 ;;
  esac
}

echo "Checking it…"
i=0
until [ "$(code "$view/")" = 200 ] || [ $i -ge 30 ]; do i=$((i + 1)); sleep 1; done
expect "the site answers" 200 "$(code "$view/")"
expect "the upload page answers" 200 "$(code "$upload/")"

# A deck that's removed afterwards, the only way anything is removed.
check=$(mktemp)
printf '%%PDF-check' > "$check"
token=zzzzz2
"$engine" exec "$name" rm -rf "/data/decks/$token"
expect "a deck uploads" 201 "$(code -T "$check" "$upload/decks/$token/check.pdf")"
expect "it reads on the public port" 200 "$(code "$view/decks/$token/check.pdf")"
expect "uploading over it is refused" 409 "$(code -T "$check" "$upload/decks/$token/check.pdf")"
expect "deleting on the upload port is refused" 403 "$(code -X DELETE "$upload/decks/$token/check.pdf")"
expect "uploading on the public port is refused" "403 404" "$(code -T "$check" "$view/decks/$token/new.pdf")"
expect "deleting on the public port is refused" 403 "$(code -X DELETE "$view/decks/$token/check.pdf")"
expect "the public port doesn't list decks" 404 "$(code "$view/decks/")"
if [ -n "$public_url" ]; then
  public=$(code "${public_url%/}/decks/$token/check.pdf")
  if [ "$public" = 200 ]; then
    expect "through the tunnel: a deck reads" 200 "$public"
    expect "through the tunnel: uploading is refused" "403 404" "$(code -T "$check" "${public_url%/}/decks/$token/new.pdf")"
    expect "through the tunnel: deleting is refused" 403 "$(code -X DELETE "${public_url%/}/decks/$token/check.pdf")"
    expect "through the tunnel: the upload page isn't there" "404" "$(code "${public_url%/}/public-url")"
  else
    echo "  skip  through the tunnel: $public_url answered $public. Point the tunnel at 127.0.0.1:$view_port, then run this again."
  fi
fi
rm -f "$check"
"$engine" exec "$name" rm -rf "/data/decks/$token"

if [ "$failed" != 0 ]; then
  echo "Some checks failed: see above." >&2
  exit 1
fi

cat <<DONE

Deployed.
  Tunnel target:  http://127.0.0.1:$view_port
  Upload page:    http://<this machine's private address>:$upload_port/
  Remove a deck:  $engine exec $name rm -r /data/decks/<token>

Warning: the upload port is open on every network this machine is on, with no password.
Anyone who reaches it can upload files that get public links. Keep it off the internet with your firewall.
DONE
