# SPDX-License-Identifier: MIT
"""D3: install and tests in transient systemd units as atrium-build.

The command list is fixed here. Callers choose only an entry name; there are
no caller-supplied commands, paths or environment. The working directory and
writable paths are always the live checkout's.
"""
import json
import os
import pwd
import signal
import subprocess
import sys
import time

from . import config, policy, workspace

SYSTEMD_RUN = "/usr/bin/systemd-run"
SYSTEMCTL = "/usr/bin/systemctl"
STATE = os.path.join(config.RUN_STATE_DIR, "build-run.json")
TOOL_ENV = {"PATH": "/usr/bin:/bin", "LANG": "C.UTF-8"}

PNPM = "/usr/local/bin/pnpm"
NODE = "/usr/local/bin/node"

INSTALL = (900, [PNPM, "install", "--frozen-lockfile",
                 "--store-dir", config.BUILD_STORE,
                 "--package-import-method", "copy"])

# The install check (D3: "checked by inode"): runs as atrium-build. Link
# count 1 everywhere means no file is shared with PROD's tree or root's store;
# .modules.yaml must name the build store.
VERIFY_INSTALL = (120, ["/bin/bash", "-c", r"""
set -euo pipefail
grep -q '"storeDir": "/var/lib/atrium-build/pnpm-store/' node_modules/.modules.yaml \
  || { echo "install check: storeDir is not the build store"; exit 1; }
shared=$( { find node_modules packages/*/node_modules apps/*/node_modules tools/*/node_modules \
  -xdev -type f -links +1 -print 2>/dev/null || true; } | head -5)
if [[ -n "$shared" ]]; then echo "install check: hard-linked package files:"; echo "$shared"; exit 1; fi
n=$( { find node_modules/.pnpm -xdev -type f 2>/dev/null || true; } | wc -l)
(( n > 0 )) || { echo "install check: no package files"; exit 1; }
echo "install check: $n package files, each with a single link; store is the build store"
"""])

# The test list, in order (from atrium-deploy as of 2026-10-14; behaviors added 2026-10-30). Each entry's
# first value is its RuntimeMaxSec; the per-file server timeouts stay inside.
TESTS = [
    ("protocol", 300, [PNPM, "--filter", "@atrium/protocol", "test"]),
    ("som", 300, [PNPM, "--filter", "@atrium/som", "test"]),
    ("server", 2400, ["/bin/bash", "-c", r"""
set -euo pipefail
for f in packages/server/test/*.test.js; do
  echo; echo "--- $f ---"
  timeout --signal=TERM --kill-after=10s 180s node --test "$f"
done
"""]),
    ("client", 200, ["/bin/bash", "-c",
                     "cd packages/client && exec timeout --signal=TERM --kill-after=10s 180s "
                     "node --test --test-force-exit tests/*.test.js"]),
    ("renderer-three", 300, [PNPM, "--filter", "@atrium/renderer-three", "test"]),
    ("interaction", 300, [PNPM, "--filter", "@atrium/interaction", "test"]),
    # Host round 2026-10-30 (scripting-4b-2 round 5's S4): the behaviour adapter,
    # runner and rule (packages/behaviors), 132 tests at ab02239b.
    ("behaviors", 300, [PNPM, "--filter", "@atrium/behaviors", "test"]),
    ("apps-client", 300, ["/bin/bash", "-c", "cd apps/client && exec node --test tests/*.test.js"]),
]
TEST_NAMES = [t[0] for t in TESTS]


class BuildRunError(Exception):
    pass


# ---------------------------------------------------------------- state (S10)

def _write_state(st):
    os.makedirs(config.RUN_STATE_DIR, mode=0o700, exist_ok=True)
    os.chmod(config.RUN_STATE_DIR, 0o700)
    tmp = STATE + ".tmp"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
    with os.fdopen(fd, "w") as f:
        json.dump(st, f)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, STATE)


def read_state():
    try:
        fd = os.open(STATE, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    except FileNotFoundError:
        return {"stamp": None, "units": []}
    with os.fdopen(fd) as f:
        return json.load(f)


def begin():
    stamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
    _write_state({"stamp": stamp, "units": []})
    return stamp


def _record_unit(kind):
    st = read_state()
    if not st.get("stamp"):
        raise BuildRunError("no build run begun (atrium-build-run begin)")
    n = len(st["units"]) + 1
    unit = f"atrium-build-{st['stamp']}-{n}-{kind}.service"
    st["units"].append(unit)
    _write_state(st)  # recorded before launch
    return unit


# ---------------------------------------------------------------- running

def _rw_paths(repo):
    return [config.BUILD_HOME] + workspace.node_modules_paths(repo)


def systemd_run_argv(unit, props, env, cmd):
    argv = [SYSTEMD_RUN, "--quiet", "--wait", "--pipe", "--collect", "--service-type=exec",
            f"--unit={unit}"]
    for p in props:
        argv += ["--property", p]
    argv += policy.env_args(env)
    argv += ["--", *cmd]
    return argv


def run_unit(unit, props, env, cmd, out=None):
    """Run one transient unit, copying its output; return its exit status.
    systemd-run's own status is returned (never a pipe consumer's): the
    equivalent of PIPESTATUS[0] (review M10)."""
    out = out or sys.stdout.buffer
    argv = systemd_run_argv(unit, props, env, cmd)
    try:
        p = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                             stderr=subprocess.STDOUT, env=dict(TOOL_ENV), close_fds=True)
    except OSError as e:
        print(f"atrium-build-run: cannot start systemd-run: {e}", file=sys.stderr)
        return 127

    def on_signal(signum, frame):
        stop_unit(unit)
        raise SystemExit(128 + signum)

    old = {s: signal.signal(s, on_signal) for s in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP)}
    try:
        for chunk in iter(lambda: p.stdout.read1(65536), b""):
            out.write(chunk)
            out.flush()
        rc = p.wait()
    finally:
        for s, h in old.items():
            signal.signal(s, h)
    return rc


def run_entry(name, repo=config.DEV_CHECKOUT):
    if name == "install":
        sec, cmd = INSTALL
        kind = "install"
    elif name == "verify-install":
        sec, cmd = VERIFY_INSTALL
        kind = "test"
    elif name.startswith("test-") and name[5:] in TEST_NAMES:
        _, sec, cmd = next(t for t in TESTS if t[0] == name[5:])
        kind = "test"
    else:
        raise BuildRunError(f"unknown entry {name!r}")
    pwd.getpwnam(config.BUILD_USER)  # refuse early if the user is missing
    props = policy.build_properties(kind, repo, _rw_paths(repo), sec)
    unit = _record_unit(name)
    print(f"=== {name} ({unit}) ===", flush=True)
    rc = run_unit(unit, props, policy.BUILD_ENV, cmd)
    if rc != 0:
        print(f"atrium-build-run: {name} failed with status {rc}", flush=True)
    return rc


# ---------------------------------------------------------------- stopping (S10)

def _show(unit):
    p = subprocess.run([SYSTEMCTL, "show", "-p", "LoadState,ActiveState,ControlGroup", unit],
                       capture_output=True, text=True, env=dict(TOOL_ENV))
    d = {}
    for line in p.stdout.splitlines():
        k, _, v = line.partition("=")
        d[k] = v
    return d


def _cgroup_pids(cg):
    if not cg:
        return []
    pids = []
    for base in ("/sys/fs/cgroup", "/sys/fs/cgroup/unified", "/sys/fs/cgroup/systemd"):
        try:
            with open(base + cg + "/cgroup.procs") as f:
                pids += [int(x) for x in f.read().split()]
        except (FileNotFoundError, NotADirectoryError, PermissionError):
            continue
    return pids


def stop_unit(unit):
    subprocess.run([SYSTEMCTL, "stop", unit], capture_output=True, env=dict(TOOL_ENV))


def uid_processes(user):
    uid = pwd.getpwnam(user).pw_uid
    out = []
    for d in os.listdir("/proc"):
        if not d.isdigit():
            continue
        try:
            st = os.stat(f"/proc/{d}")
        except FileNotFoundError:
            continue
        if st.st_uid == uid:
            try:
                with open(f"/proc/{d}/stat") as f:
                    state = f.read().rsplit(")", 1)[1].split()[0]
            except (FileNotFoundError, IndexError):
                continue
            if state != "Z":
                out.append(int(d))
    return out


def stop_recorded(wait=15):
    """Stop every recorded unit by exact name, verify each is inactive or
    failed with an empty cgroup, sweep with the wildcard, and verify no
    process of the build user remains. Returns a list of problems."""
    st = read_state()
    problems = []
    for unit in st.get("units", []):
        stop_unit(unit)
    deadline = time.time() + wait
    for unit in st.get("units", []):
        while True:
            d = _show(unit)
            gone = d.get("LoadState") == "not-found" or d.get("ActiveState") in ("inactive", "failed")
            if gone and not _cgroup_pids(d.get("ControlGroup", "")):
                break
            if time.time() > deadline:
                problems.append(f"{unit}: {d.get('ActiveState')} with processes {_cgroup_pids(d.get('ControlGroup', ''))}")
                break
            time.sleep(0.5)
    subprocess.run([SYSTEMCTL, "stop", "atrium-build-*"], capture_output=True, env=dict(TOOL_ENV))
    try:
        while uid_processes(config.BUILD_USER) and time.time() < deadline:
            time.sleep(0.5)
        left = uid_processes(config.BUILD_USER)
        if left:
            problems.append(f"processes of {config.BUILD_USER} remain: {left}")
    except KeyError:
        pass
    return problems


def main(argv):
    if os.geteuid() != 0:
        print("atrium-build-run: root only", file=sys.stderr)
        return 2
    if len(argv) != 1:
        print("usage: atrium-build-run begin|install|verify-install|test-<name>|list-tests|stop-recorded",
              file=sys.stderr)
        return 2
    a = argv[0]
    try:
        if a == "begin":
            print(begin())
            return 0
        if a == "list-tests":
            print("\n".join(TEST_NAMES))
            return 0
        if a == "stop-recorded":
            probs = stop_recorded()
            for p in probs:
                print(f"atrium-build-run: {p}", file=sys.stderr)
            return 1 if probs else 0
        return run_entry(a)
    except (BuildRunError, workspace.WorkspaceRefused, KeyError) as e:
        print(f"atrium-build-run: REFUSING: {e}", file=sys.stderr)
        return 2
    except Exception as e:  # noqa: BLE001 - any refusal fails the deploy
        print(f"atrium-build-run: REFUSING: {type(e).__name__}: {e}", file=sys.stderr)
        return 2
