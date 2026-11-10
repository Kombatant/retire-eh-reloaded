#!/bin/sh
# Run by the nginx image's entrypoint before nginx starts. The Yahoo Finance
# proxy in nginx.conf resolves its host per request, which needs a `resolver`;
# use the container's own DNS servers (Docker's 127.0.0.11 on a Compose
# network, the host's on the default bridge). /tmp is writable even when the
# container's filesystem is read-only.
set -eu
servers=$(awk '/^nameserver/ { ip = $2; if (ip ~ /:/) ip = "[" ip "]"; printf "%s ", ip }' /etc/resolv.conf)
if [ -n "$servers" ]; then
  echo "resolver $servers valid=300s;" > /tmp/nginx-resolver.conf
else
  echo "$0: no nameserver in /etc/resolv.conf; Yahoo Finance quotes will not work" >&2
fi
