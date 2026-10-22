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
# Everything in the staging directory, catalog.json included, is untrusted:
# the build account wrote it. The work is done by the Python below, through
# file descriptors, so nothing can be swapped between a check and a use:
#
#   1. the staging directory and every directory above it: not symlinks; the
#      ancestors root-owned, the staging tree owned by the build account;
#   2. catalog.json: a regular file, one link, at most 512 KiB, strict JSON
#      (no NaN or Infinity, no duplicate keys), every field checked against
#      Z1; the catalog that is kept (and uploaded) is rebuilt from the checked
#      fields only;
#   3. the staging tree holds exactly catalog.json, models/, skies/, thumbs/
#      and the files the catalog names; anything else is refused;
#   4. pass 1: every named file is opened O_NOFOLLOW, must be a regular file
#      with one link, owned by the build account, under its size cap (and all
#      together under 1 GiB); it is copied into a root-only directory while
#      being hashed, and its sha256 must match;
#   5. pass 2: every destination is checked: absent, or a regular file with
#      the same sha256; anything else stops the run — before anything is
#      installed;
#   6. pass 3: missing files are installed (temporary name, then rename),
#      root:root 0644; pass 4 re-hashes every installed file.
#
# Options (defaults are the host's): --target DIR (/srv/atrium-library),
# --work DIR (/root/lib-install), --owner USER (atrium-build).
# Exit codes: 0 ok, 1 refused, 64 usage.

set -euo pipefail
umask 077
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
export LC_ALL=C.UTF-8
unset PYTHONPATH PYTHONHOME PYTHONSTARTUP PYTHONSAFEPATH BASH_ENV ENV CDPATH GLOBIGNORE
cd /

if [ "$(id -u)" != 0 ]; then
  echo "install-library: REFUSED: must run as root" >&2
  exit 1
fi

exec /usr/bin/python3 -I -S - "$@" <<'PY'
import hashlib, json, math, os, pwd, re, shutil, stat, sys

def fail(msg):
    print('install-library: REFUSED: ' + msg, file=sys.stderr)
    sys.exit(1)

def usage():
    print('usage: install-library.sh [--target DIR] [--work DIR] [--owner USER] STAGING_DIR', file=sys.stderr)
    sys.exit(64)

# --- arguments ---------------------------------------------------------------
target, work, owner, staging = '/srv/atrium-library', '/root/lib-install', 'atrium-build', None
argv = sys.argv[1:]
while argv:
    a = argv.pop(0)
    if a in ('--target', '--work', '--owner'):
        if not argv: usage()
        v = argv.pop(0)
        if a == '--target': target = v
        elif a == '--work': work = v
        else: owner = v
    elif a.startswith('--'): usage()
    elif staging is None: staging = a
    else: usage()
if staging is None: usage()

def clean(path):
    if not path.startswith('/'): fail('paths must be absolute: %r' % path)
    stripped = path.rstrip('/')
    if not stripped: fail('a path may not be /')
    parts = stripped.split('/')[1:]
    for p in parts:
        if p in ('', '.', '..'): fail('no empty, . or .. components in paths: %r' % path)
    return stripped
target, work, staging = clean(target), clean(work), clean(staging)

if os.geteuid() != 0: fail('must run as root')
try: owner_uid = pwd.getpwnam(owner).pw_uid
except KeyError: fail('no such user: %s' % owner)

CAPS = {'model': 25 << 20, 'sky': 16 << 20, 'thumb': 1 << 20}
TOTAL_CAP = 1 << 30
CATALOG_CAP = 512 << 10
RO = os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC | os.O_NONBLOCK
DIR = os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC | os.O_DIRECTORY

# --- directories -------------------------------------------------------------
def check_ancestors(path):
    """Every directory above `path`: a real directory owned by root."""
    parts = path.split('/')[1:-1]
    cur = ''
    for p in parts:
        cur += '/' + p
        st = os.lstat(cur)
        if stat.S_ISLNK(st.st_mode): fail('%s is a symlink' % cur)
        if not stat.S_ISDIR(st.st_mode): fail('%s is not a directory' % cur)
        if st.st_uid != 0: fail('%s is not owned by root' % cur)

def open_dir(name, dir_fd=None, what=None):
    try:
        return os.open(name, DIR, dir_fd=dir_fd)
    except OSError as e:
        fail('%s is a symlink, missing, or not a directory (%s)' % (what or name, e.strerror))

def root_dir(name, mode, dir_fd=None, what=None):
    """Create if missing; otherwise it must be root:root with exactly `mode`."""
    what = what or name
    created = False
    try:
        st = os.stat(name, dir_fd=dir_fd, follow_symlinks=False)
        if stat.S_ISLNK(st.st_mode): fail('%s is a symlink' % what)
    except FileNotFoundError:
        os.mkdir(name, 0o700, dir_fd=dir_fd)
        created = True
    fd = open_dir(name, dir_fd, what)
    if created:                      # only a directory this run made is set up
        os.fchown(fd, 0, 0)
        os.fchmod(fd, mode)
    st = os.fstat(fd)
    if (st.st_uid, st.st_gid, stat.S_IMODE(st.st_mode)) != (0, 0, mode):
        fail('%s must be root:root mode %o (is %d:%d %o)' % (what, mode, st.st_uid, st.st_gid, stat.S_IMODE(st.st_mode)))
    return fd

check_ancestors(target)
tfd = root_dir(target, 0o755)
tsub = {s: root_dir(s, 0o755, tfd, target + '/' + s) for s in ('models', 'skies', 'thumbs')}
check_ancestors(work)
wfd = root_dir(work, 0o700)

check_ancestors(staging)
sfd = open_dir(staging, None, 'staging ' + staging)
sst = os.fstat(sfd)
if sst.st_uid != owner_uid: fail('staging %s is not owned by %s' % (staging, owner))

# --- reading untrusted files ---------------------------------------------------
def read_regular(dfd, name, cap, where):
    try:
        lst = os.stat(name, dir_fd=dfd, follow_symlinks=False)
    except FileNotFoundError:
        fail('missing: %s' % where)
    if not stat.S_ISREG(lst.st_mode): fail('not a regular file: %s' % where)
    try:
        fd = os.open(name, RO, dir_fd=dfd)
    except OSError as e:
        fail('cannot open %s (%s)' % (where, e.strerror))
    try:
        st = os.fstat(fd)
        if (st.st_dev, st.st_ino) != (lst.st_dev, lst.st_ino) or not stat.S_ISREG(st.st_mode): fail('changed while being read: %s' % where)
        if st.st_nlink != 1: fail('has %d hard links: %s' % (st.st_nlink, where))
        if st.st_uid != owner_uid: fail('not owned by %s: %s' % (owner, where))
        if st.st_size > cap: fail('%s is %d bytes, over its cap of %d' % (where, st.st_size, cap))
        chunks, total = [], 0
        while True:
            b = os.read(fd, 1 << 20)
            if not b: break
            total += len(b)
            if total > cap: fail('%s grew past its cap of %d' % (where, cap))
            chunks.append(b)
        return b''.join(chunks)
    finally:
        os.close(fd)

# --- the catalog -------------------------------------------------------------------
def no_constants(name): fail('catalog: %s is not allowed' % name)
def no_dupes(pairs):
    d = {}
    for k, v in pairs:
        if k in d: fail('catalog: duplicate key %r' % k)
        d[k] = v
    return d

raw = read_regular(sfd, 'catalog.json', CATALOG_CAP, 'catalog.json')
try:
    cat = json.loads(raw.decode('utf-8'), parse_constant=no_constants, object_pairs_hook=no_dupes)
except (UnicodeDecodeError, ValueError) as e:
    fail('catalog is not strict JSON: %s' % e)

PATTERN = {
    'model': re.compile(r'/assets/library/models/([A-Za-z0-9_]{1,64})-([0-9a-f]{12})\.glb'),
    'sky':   re.compile(r'/assets/library/skies/([A-Za-z0-9_]{1,64})-([0-9a-f]{12})\.jpg'),
    'thumb': re.compile(r'/assets/library/thumbs/([A-Za-z0-9_]{1,64})-([0-9a-f]{12})\.webp'),
}
SUBDIR = {'model': 'models', 'sky': 'skies', 'thumb': 'thumbs'}
SHA = re.compile(r'[0-9a-f]{64}')
ID = re.compile(r'[A-Za-z0-9_]{1,64}')
NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9 ()'.,&-]{0,47}")
CATEGORY = re.compile(r'[A-Z][A-Za-z ]{0,23}')
AUTHOR = re.compile(r'[^\x00-\x1f\x7f<>]{1,100}')
CREDIT, CREDIT_URL, GENERATOR = 'Models and skies from Poly Haven (CC0)', 'https://polyhaven.com', 'atrium-library-build/1'

def is_int(v, lo, hi): return type(v) is int and lo <= v <= hi
def is_num(v, lo, hi): return type(v) in (int, float) and math.isfinite(v) and lo <= v <= hi
def keys_exactly(obj, keys, where):
    if type(obj) is not dict: fail('catalog: %s is not an object' % where)
    if set(obj) != set(keys): fail('catalog: %s must have exactly the keys %s' % (where, ', '.join(sorted(keys))))

files = []      # (kind, filename, sha256)
def path_field(kind, url, sha, entry_id, where):
    if type(url) is not str: fail('catalog: %s: bad %s path' % (where, kind))
    m = PATTERN[kind].fullmatch(url)
    if not m: fail('catalog: %s: bad %s path %r' % (where, kind, url))
    if type(sha) is not str or not SHA.fullmatch(sha): fail('catalog: %s: bad sha256' % where)
    if m.group(1) != entry_id: fail('catalog: %s: path id differs from the entry id' % where)
    if m.group(2) != sha[:12]: fail('catalog: %s: name hash differs from sha256' % where)
    files.append((kind, url.rsplit('/', 1)[1], sha))

def common(e, where):
    if type(e['id']) is not str or not ID.fullmatch(e['id']): fail('catalog: %s: bad id' % where)
    if type(e['name']) is not str or not NAME.fullmatch(e['name']): fail('catalog: %s: bad name' % where)
    if e['license'] != 'CC0-1.0': fail('catalog: %s: license must be CC0-1.0' % where)
    if type(e['authors']) is not list or not 1 <= len(e['authors']) <= 10 or not all(type(a) is str and AUTHOR.fullmatch(a) for a in e['authors']):
        fail('catalog: %s: bad authors' % where)
    if e['source'] != 'https://polyhaven.com/a/' + e['id']: fail('catalog: %s: bad source' % where)

MODEL_KEYS = ['id', 'name', 'category', 'url', 'sha256', 'bounds', 'bytes', 'vertices', 'textureBytes', 'thumbnail', 'thumbnailSha256', 'license', 'authors', 'source']
SKY_KEYS = ['id', 'name', 'url', 'sha256', 'width', 'height', 'bytes', 'thumbnail', 'thumbnailSha256', 'license', 'authors', 'source']

keys_exactly(cat, ['version', 'credit', 'creditUrl', 'generator', 'models', 'skies'], 'the top level')
if not is_int(cat['version'], 1, 1): fail('catalog: version must be the integer 1')
if (cat['credit'], cat['creditUrl'], cat['generator']) != (CREDIT, CREDIT_URL, GENERATOR): fail('catalog: credit, creditUrl or generator differs')
if type(cat['models']) is not list or type(cat['skies']) is not list: fail('catalog: models and skies must be lists')
if len(cat['models']) > 200 or len(cat['skies']) > 50: fail('catalog: too many entries')
canon = {'version': 1, 'credit': CREDIT, 'creditUrl': CREDIT_URL, 'generator': GENERATOR, 'models': [], 'skies': []}
seen = set()
for i, e in enumerate(cat['models']):
    where = 'models[%d]' % i
    keys_exactly(e, MODEL_KEYS, where)
    common(e, where)
    if ('model', e['id']) in seen: fail('catalog: duplicate model id %s' % e['id'])
    seen.add(('model', e['id']))
    if type(e['category']) is not str or not CATEGORY.fullmatch(e['category']): fail('catalog: %s: bad category' % where)
    if type(e['bounds']) is not list or len(e['bounds']) != 3 or not all(is_num(n, 0.001, 1000) for n in e['bounds']): fail('catalog: %s: bad bounds' % where)
    if not is_int(e['bytes'], 1, CAPS['model']): fail('catalog: %s: bad bytes' % where)
    if not is_int(e['vertices'], 0, 500000): fail('catalog: %s: bad vertices' % where)
    if not is_int(e['textureBytes'], 0, 64 << 20): fail('catalog: %s: bad textureBytes' % where)
    path_field('model', e['url'], e['sha256'], e['id'], where)
    path_field('thumb', e['thumbnail'], e['thumbnailSha256'], e['id'], where + '.thumbnail')
    canon['models'].append({k: e[k] for k in MODEL_KEYS})
for i, e in enumerate(cat['skies']):
    where = 'skies[%d]' % i
    keys_exactly(e, SKY_KEYS, where)
    common(e, where)
    if ('sky', e['id']) in seen: fail('catalog: duplicate sky id %s' % e['id'])
    seen.add(('sky', e['id']))
    if not (is_int(e['width'], 4096, 4096) and is_int(e['height'], 2048, 2048)): fail('catalog: %s: a sky must be 4096 x 2048' % where)
    if not is_int(e['bytes'], 1, CAPS['sky']): fail('catalog: %s: bad bytes' % where)
    path_field('sky', e['url'], e['sha256'], e['id'], where)
    path_field('thumb', e['thumbnail'], e['thumbnailSha256'], e['id'], where + '.thumbnail')
    canon['skies'].append({k: e[k] for k in SKY_KEYS})
if not files: fail('catalog: names no files')
names_by_sub = {'models': set(), 'skies': set(), 'thumbs': set()}
for kind, name, sha in files:
    sub = SUBDIR[kind]
    if name in names_by_sub[sub]: fail('catalog: duplicate file %s/%s' % (sub, name))
    names_by_sub[sub].add(name)

# --- the staging tree holds exactly what the catalog names ----------------------------
top = set(os.listdir(sfd))
extra = top - {'catalog.json', 'models', 'skies', 'thumbs'}
if extra: fail('staging holds something unexpected at its top: %r' % sorted(extra)[:5])
sub_fd = {}
for sub, wanted in names_by_sub.items():
    if sub not in top:
        if wanted: fail('staging has no %s/' % sub)
        continue
    fd = open_dir(sub, sfd, 'staging ' + sub + '/')
    if os.fstat(fd).st_uid != owner_uid: fail('staging %s/ is not owned by %s' % (sub, owner))
    present = set(os.listdir(fd))
    if present - wanted: fail('staging holds files the catalog does not name: %r' % sorted('%s/%s' % (sub, n) for n in present - wanted)[:5])
    if wanted - present: fail('the catalog names files staging does not hold: %r' % sorted('%s/%s' % (sub, n) for n in wanted - present)[:5])
    sub_fd[sub] = fd

# --- pass 1: copy every named file into a root-only directory, hashing it -------
import tempfile
priv = tempfile.mkdtemp(prefix='stage.', dir=work)
try:
    pfd = open_dir(priv)
    total = 0
    for kind, name, sha in files:
        sub = SUBDIR[kind]
        data = read_regular(sub_fd[sub], name, CAPS[kind], sub + '/' + name)
        total += len(data)
        if total > TOTAL_CAP: fail('staging is larger than %d bytes in all' % TOTAL_CAP)
        if hashlib.sha256(data).hexdigest() != sha: fail('sha256 differs from the catalog: %s/%s' % (sub, name))
        out = os.open(sub + '-' + name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600, dir_fd=pfd)
        try: os.write(out, data)
        finally: os.close(out)
        del data

    # --- pass 2: every destination, before anything is installed --------------------
    def hash_installed(sub, name):
        fd = os.open(name, RO, dir_fd=tsub[sub])
        try:
            st = os.fstat(fd)
            if not stat.S_ISREG(st.st_mode) or st.st_nlink != 1: return None
            h = hashlib.sha256()
            while True:
                b = os.read(fd, 1 << 20)
                if not b: break
                h.update(b)
            return h.hexdigest()
        finally:
            os.close(fd)

    to_install, present_count = [], 0
    for kind, name, sha in files:
        sub = SUBDIR[kind]
        dst = '%s/%s/%s' % (target, sub, name)
        try:
            st = os.stat(name, dir_fd=tsub[sub], follow_symlinks=False)
        except FileNotFoundError:
            to_install.append((sub, name, sha)); continue
        if not stat.S_ISREG(st.st_mode): fail('destination is not a regular file: %s' % dst)
        if hash_installed(sub, name) != sha:
            fail('%s already exists with DIFFERENT content (expected %s); nothing was installed' % (dst, sha))
        present_count += 1
    for sub, name, sha in to_install:
        tmp = '.tmp-' + name
        try:
            os.stat(tmp, dir_fd=tsub[sub], follow_symlinks=False)
            fail('a leftover %s/%s/%s exists (an interrupted run?); remove it and run again' % (target, sub, tmp))
        except FileNotFoundError:
            pass

    # --- pass 3: install ------------------------------------------------------------
    for sub, name, sha in to_install:
        src = os.open(sub + '-' + name, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=pfd)
        try:
            data = b''
            while True:
                b = os.read(src, 1 << 20)
                if not b: break
                data += b
        finally:
            os.close(src)
        if hashlib.sha256(data).hexdigest() != sha: fail('private copy changed: %s/%s' % (sub, name))
        tmp = '.tmp-' + name
        out = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, 0o644, dir_fd=tsub[sub])
        try:
            os.write(out, data)
            os.fchown(out, 0, 0)
            os.fchmod(out, 0o644)
            os.fsync(out)
        finally:
            os.close(out)
        os.rename(tmp, name, src_dir_fd=tsub[sub], dst_dir_fd=tsub[sub])

    # --- pass 4: re-hash what is installed ---------------------------------------
    for kind, name, sha in files:
        sub = SUBDIR[kind]
        st = os.stat(name, dir_fd=tsub[sub], follow_symlinks=False)
        if not stat.S_ISREG(st.st_mode) or (st.st_uid, st.st_gid, stat.S_IMODE(st.st_mode)) != (0, 0, 0o644):
            fail('after install, %s/%s/%s is not a root:root 0644 file' % (target, sub, name))
        if hash_installed(sub, name) != sha: fail('after install, sha256 differs: %s/%s/%s' % (target, sub, name))
finally:
    shutil.rmtree(priv, ignore_errors=True)

# --- the checked catalog, rebuilt from checked fields only -----------------------------
text = (json.dumps(canon, indent=2, ensure_ascii=False) + '\n').encode('utf-8')
csha = hashlib.sha256(text).hexdigest()
kept_name = 'catalog-%s.json' % csha[:12]
try:
    fd = os.open(kept_name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, 0o644, dir_fd=wfd)
    try:
        os.write(fd, text); os.fchmod(fd, 0o644); os.fsync(fd)
    finally:
        os.close(fd)
except FileExistsError:
    fd = os.open(kept_name, RO, dir_fd=wfd)
    try:
        st = os.fstat(fd)
        same = stat.S_ISREG(st.st_mode) and os.read(fd, len(text) + 1) == text
    finally:
        os.close(fd)
    if not same: fail('%s/%s exists with different content' % (work, kept_name))

print('URLs to check after the Caddy step (expect 200 and Access-Control-Allow-Origin: *):')
for kind, name, sha in files:
    print('  /assets/library/%s/%s' % (SUBDIR[kind], name))
print('catalog: %s/%s' % (work, kept_name))
print('catalog sha256: %s' % csha)
print('OK %d files (%d new, %d already present)' % (len(files), len(to_install), present_count))
PY
