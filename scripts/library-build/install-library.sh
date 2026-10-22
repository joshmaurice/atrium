#!/bin/bash
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
#
# install-library.sh — install a built starter library (step 3b, H2).
#
# Run as ROOT, from a copy fetched from a pinned, reviewed commit and checked
# against its known sha256 — NEVER from the build account's checkout:
#
#   bash /root/lib-install/install-library.sh /var/tmp/library-<date>
#
# Everything in the staging directory is untrusted data written by an
# unprivileged account. This script:
#   1. checks the library tree is root-owned 0755 and not symlinks (creates it
#      that way on first run);
#   2. copies the staging directory into a fresh root-only directory and works
#      only on that copy from then on; refuses any symlink, device, unexpected
#      directory, or file the catalog doesn't name;
#   3. for each file the catalog names: checks its path pattern and sha256;
#      installs it if missing; if already present, its sha256 must match, or it
#      STOPS (never skips silently);
#   4. re-hashes every installed file;
#   5. keeps the checked catalog as $WORK/catalog-<sha12>.json and prints its
#      sha256 and the URLs to check after the Caddy step.
#
# Options (defaults are the host's): --target DIR (/srv/atrium-library),
# --work DIR (/root/lib-install). Exit codes: 0 ok, 1 refused, 64 usage.

set -euo pipefail
umask 022
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
export LC_ALL=C
unset PYTHONPATH PYTHONHOME PYTHONSTARTUP BASH_ENV ENV CDPATH GLOBIGNORE
cd /

die() { echo "install-library: REFUSED: $*" >&2; exit 1; }
usage() { echo "usage: install-library.sh [--target DIR] [--work DIR] STAGING_DIR" >&2; exit 64; }

TARGET=/srv/atrium-library
WORK=/root/lib-install
STAGING=
while [ $# -gt 0 ]; do
  case "$1" in
    --target) [ $# -ge 2 ] || usage; TARGET=$2; shift 2 ;;
    --work)   [ $# -ge 2 ] || usage; WORK=$2; shift 2 ;;
    --*)      usage ;;
    *)        [ -z "$STAGING" ] || usage; STAGING=$1; shift ;;
  esac
done
[ -n "$STAGING" ] || usage
for p in "$TARGET" "$WORK" "$STAGING"; do
  case "$p" in /*) ;; *) die "paths must be absolute: $p" ;; esac
  case "/$p/" in */../*|*/./*) die "no . or .. in paths: $p" ;; esac
done

[ "$(id -u)" = 0 ] || die "must run as root"

# --- 1. the library tree --------------------------------------------------
root_dir() {   # $1 path, $2 mode: create if missing, else insist root-owned with that mode
  local d=$1 mode=$2
  [ -L "$d" ] && die "$d is a symlink"
  if [ ! -e "$d" ]; then install -d -m "$mode" -o root -g root -- "$d"; fi
  [ -d "$d" ] || die "$d is not a directory"
  local got; got=$(stat -c '%u:%g %a' -- "$d")
  [ "$got" = "0:0 $mode" ] || die "$d must be root:root mode $mode (is $got)"
}
root_dir "$TARGET" 755
for sub in models skies thumbs; do root_dir "$TARGET/$sub" 755; done
root_dir "$WORK" 700

# --- 2. a private copy of the staging directory ---------------------------
[ -L "$STAGING" ] && die "staging $STAGING is a symlink"
[ -d "$STAGING" ] || die "staging $STAGING is not a directory"
PRIV=$(mktemp -d -- "$WORK/stage.XXXXXXXX")
LIST="$PRIV.list"
cleanup() { rm -rf -- "$PRIV" "$LIST"; }
trap cleanup EXIT
cp -R --no-dereference -- "$STAGING/." "$PRIV/"

odd=$(find "$PRIV" -mindepth 1 ! -type f ! -type d -printf '%P\n' -quit)
[ -z "$odd" ] || die "staging holds something that is not a file or directory: $odd"
while IFS= read -r d; do
  case "$d" in models|skies|thumbs) ;; *) die "unexpected directory in staging: $d" ;; esac
done < <(find "$PRIV" -mindepth 1 -type d -printf '%P\n')
[ -f "$PRIV/catalog.json" ] || die "staging has no catalog.json"

# The catalog is read with the standard json module only (python3 -I: no
# site-packages, no environment, no script directory on the path). Each line
# out is "<relative path> <sha256>", every path already matched to Z1's
# pattern for its kind, its name hash tied to its sha256.
python3 -I - "$PRIV/catalog.json" > "$LIST" <<'PY'
import json, re, sys
PATTERNS = {
    'model': re.compile(r'/assets/library/models/[A-Za-z0-9_]{1,64}-[0-9a-f]{12}\.glb'),
    'sky':   re.compile(r'/assets/library/skies/[A-Za-z0-9_]{1,64}-[0-9a-f]{12}\.jpg'),
    'thumb': re.compile(r'/assets/library/thumbs/[A-Za-z0-9_]{1,64}-[0-9a-f]{12}\.webp'),
}
SHA = re.compile(r'[0-9a-f]{64}')
PREFIX = '/assets/library/'
def fail(msg):
    print('catalog: ' + msg, file=sys.stderr); sys.exit(1)
with open(sys.argv[1], 'rb') as f:
    raw = f.read(512 * 1024 + 1)
if len(raw) > 512 * 1024: fail('larger than 512 KiB')
try: cat = json.loads(raw.decode('utf-8'))
except Exception as e: fail('not JSON: %s' % e)
if not isinstance(cat, dict) or cat.get('version') != 1: fail('version must be 1')
out, seen = [], set()
def add(kind, url, sha, where):
    if not isinstance(url, str) or not PATTERNS[kind].fullmatch(url): fail('%s: bad %s path %r' % (where, kind, url))
    if not isinstance(sha, str) or not SHA.fullmatch(sha): fail('%s: bad sha256' % where)
    if url[url.rindex('-') + 1:url.rindex('.')] != sha[:12]: fail('%s: name hash differs from sha256' % where)
    if url in seen: fail('duplicate path %s' % url)
    seen.add(url); out.append('%s %s' % (url[len(PREFIX):], sha))
for key, kind in (('models', 'model'), ('skies', 'sky')):
    items = cat.get(key, [])
    if not isinstance(items, list): fail('%s is not a list' % key)
    for i, e in enumerate(items):
        if not isinstance(e, dict): fail('%s[%d] is not an object' % (key, i))
        add(kind, e.get('url'), e.get('sha256'), '%s[%d]' % (key, i))
        add('thumb', e.get('thumbnail'), e.get('thumbnailSha256'), '%s[%d].thumbnail' % (key, i))
if not out: fail('names no files')
print('\n'.join(out))
PY

# Every staged file must be named by the catalog, and vice versa.
named=$(cut -d' ' -f1 < "$LIST" | sort)
staged=$(find "$PRIV" -type f ! -path "$PRIV/catalog.json" -printf '%P\n' | sort)
extra=$(comm -13 <(printf '%s\n' "$named") <(printf '%s\n' "$staged"))
[ -z "$extra" ] || die "staging holds files the catalog does not name: $extra"
missing=$(comm -23 <(printf '%s\n' "$named") <(printf '%s\n' "$staged"))
[ -z "$missing" ] || die "the catalog names files staging does not hold: $missing"

hash_of() { sha256sum -- "$1" | cut -d' ' -f1; }

# --- 3. check, then install or match ---------------------------------------
new=0; present=0
while read -r rel sha; do
  src="$PRIV/$rel"; dst="$TARGET/$rel"
  [ -f "$src" ] && [ ! -L "$src" ] || die "not a regular file: $rel"
  [ "$(hash_of "$src")" = "$sha" ] || die "sha256 differs from the catalog: $rel"
  [ -L "$dst" ] && die "destination is a symlink: $dst"
  if [ -e "$dst" ]; then
    [ -f "$dst" ] || die "destination is not a regular file: $dst"
    [ "$(hash_of "$dst")" = "$sha" ] || die "$dst already exists with DIFFERENT content (expected $sha); nothing past this point was installed"
    present=$((present + 1))
  else
    install -m 0644 -o root -g root -T -- "$src" "$dst"
    new=$((new + 1))
  fi
done < "$LIST"

# --- 4. re-hash what is installed ------------------------------------------
while read -r rel sha; do
  dst="$TARGET/$rel"
  [ -f "$dst" ] && [ ! -L "$dst" ] || die "after install, not a regular file: $dst"
  [ "$(hash_of "$dst")" = "$sha" ] || die "after install, sha256 differs: $dst"
done < "$LIST"

# --- 5. keep the checked catalog, report ------------------------------------
csha=$(hash_of "$PRIV/catalog.json")
kept="$WORK/catalog-${csha:0:12}.json"
if [ -e "$kept" ] || [ -L "$kept" ]; then
  [ ! -L "$kept" ] && [ "$(hash_of "$kept")" = "$csha" ] || die "$kept exists with different content"
else
  install -m 0644 -o root -g root -T -- "$PRIV/catalog.json" "$kept"
fi

echo "URLs to check after the Caddy step (expect 200 and Access-Control-Allow-Origin: *):"
cut -d' ' -f1 < "$LIST" | sed 's|^|  /assets/library/|'
echo "catalog: $kept"
echo "catalog sha256: $csha"
echo "OK $((new + present)) files ($new new, $present already present)"
