#!/usr/bin/env bash
# scripting-4d-1 round 5 — R25, R26, R27 against the REAL server and scripts of a harness root, run as root.
#   R25: a dangling database symlink at first boot: a server through the alias, then a second through the alias and
#        one on the real path, must refuse; the scripts through either spelling must refuse.
#   R26: no <lock db>-journal while a holder holds; and THE CROSS-USER CRASH: a root export holding the lock
#        (paused by ATRIUM_TEST_LOCK_SIGNAL) in a 1777 directory, kill -9, then the service user (nobody) starts the
#        server, which must start.
#   R27: a SIGTERM'd server ends BY THE SIGNAL (what systemd records as a clean stop), and the lock is free after.
# Prints PASS/FAIL per expectation; exit 1 on any FAIL. Against round 4's code every one of R25/R26/R27 must FAIL.
#   probe_r5.sh <harness root>        (needs runuser and the user nobody)
set -u
ROOT=${1:-/tmp/atrium-harness}; WT=$ROOT/wt; IDX=$WT/packages/server/src/index.js; S=$WT/packages/server/scripts
FX=$WT/tests/fixtures/space.gltf; T=/tmp/pr5; FAILS=0; PORT=39700
ok()  { echo "  PASS  $1"; }
bad() { echo "  FAIL  $1   (saw: $2)"; FAILS=$((FAILS + 1)); }
srv() { # srv <db path> <log> [user] : start a real server in the background; sets PID (not in a subshell, so PORT advances)
  local db=$1 log=$2 user=${3:-}; PORT=$((PORT + 1))
  if [ -n "$user" ]; then runuser -u "$user" -- env PORT=$PORT ATRIUM_DB_PATH="$db" WORLD_PATH="$FX" node "$IDX" > "$log" 2>&1 &
  else PORT=$PORT ATRIUM_DB_PATH="$db" WORLD_PATH="$FX" node "$IDX" > "$log" 2>&1 & fi
  PID=$!; disown $PID 2>/dev/null
}
stopall() { pkill -9 -f "node $IDX" 2>/dev/null; sleep 0.5; }
up()  { for _ in $(seq 1 60); do grep -q 'listening on' "$1" 2>/dev/null && return 0; grep -q 'refuses to start\|Error' "$1" 2>/dev/null && return 1; sleep 0.25; done; return 1; }
gone() { for _ in $(seq 1 40); do kill -0 "$1" 2>/dev/null || return 0; sleep 0.25; done; return 1; }
rm -rf $T; mkdir -p $T; chmod 755 $T
echo "code under test: $(git -C "$WT" rev-parse --short HEAD)"

echo "== R25: a dangling symlink at first boot"
D=$T/r25; mkdir -p $D; ln -s $D/real.db $D/alias.db
srv $D/alias.db $D/A.log; A=$PID; up $D/A.log || echo "   (server A did not start: $(tail -2 $D/A.log))"
[ -e $D/real.db ] && ok "R25 server A, started through the dangling alias, created the database" || bad "R25 server A created the database" "$(ls $D)"
srv $D/alias.db $D/B.log; up $D/B.log; rb=$?
srv $D/real.db $D/C.log; up $D/C.log; rc=$?
[ $rb -ne 0 ] && ok "R25 a second server through the alias refuses" || bad "R25 a second server through the alias refuses" "$(grep -o 'listening on [^ ]*' $D/B.log)"
[ $rc -ne 0 ] && ok "R25 a server on the real path refuses" || bad "R25 a server on the real path refuses" "$(grep -o 'listening on [^ ]*' $D/C.log)"
for p in alias real; do out=$(node $S/behaviors-export.mjs $D/$p.db $D/e-$p.json 2>&1); r=$?
  [ $r -ne 0 ] && [ ! -e $D/e-$p.json ] && ok "R25 export through $p.db refuses" || bad "R25 export through $p.db refuses" "exit $r: $out"; done
echo "   lock files: $(ls $D | grep lock.db$ | tr '\n' ' ')"
stopall

echo "== R26: no journal file while held"
D=$T/r26; mkdir -p $D
srv $D/a.db $D/A.log; A=$PID; up $D/A.log
[ ! -e $D/a.db.lock.db-journal ] && ok "R26 no a.db.lock.db-journal while the server holds the lock" || bad "R26 no journal file while held" "$(ls -la $D | grep journal)"
stopall
[ ! -e $D/a.db.lock.db-journal ] && ok "R26 ... nor after kill -9 of the server" || bad "R26 no journal after kill -9" "$(ls -la $D | grep journal)"

echo "== R26: the cross-user crash (a root export kill -9'd in a 1777 directory, then the service user's server)"
D=$T/r26x; mkdir -p $D; chmod 1777 $D
srv $D/a.db $D/seed.log nobody; up $D/seed.log; stopall; chmod 640 $D/a.db   # nobody's database, 0640
rm -f $D/a.db.lock.db $D/a.db.lock.db-journal $D/a.db.lock.json   # the root holder makes the lock files itself (the review's case)
rm -f $D/sig $D/sig.release
ATRIUM_TEST_LOCK_SIGNAL=$D/sig node $S/behaviors-export.mjs $D/a.db $D/e.json > $D/export.log 2>&1 & H=$!
for _ in $(seq 1 40); do [ -e $D/sig ] && break; sleep 0.25; done
[ -e $D/sig ] && echo "   root export $H holds the lock; files: $(ls -la $D | grep lock | awk '{print $3":"$9}' | tr '\n' ' ')" || echo "   (the export never signalled: $(cat $D/export.log))"
kill -9 $H; wait $H 2>/dev/null
echo "   after kill -9: $(ls -la $D | grep lock | awk '{print $1, $3":"$9}' | tr '\n' ' ')"
srv $D/a.db $D/B.log nobody; if up $D/B.log; then ok "R26 the service user's server starts after the root holder's crash"; else bad "R26 the service user's server starts after the root holder's crash" "$(grep -o 'refuses to start.*\|disk I/O error' $D/B.log | head -1)"; fi

echo "== R27: SIGTERM ends the server by the signal"
stopall
# distinguish 'killed by SIGTERM' from 'exit(143)': a node parent sees signal vs code
D=$T/r27; mkdir -p $D
res=$(node -e '
  const { spawn } = require("child_process"); const c = spawn(process.execPath, [process.argv[1]], { env: { ...process.env, PORT: "39799", ATRIUM_DB_PATH: process.argv[2], WORLD_PATH: process.argv[3] }, stdio: ["ignore", "pipe", "pipe"] })
  let out = ""; c.stdout.on("data", d => { out += d; if (out.includes("listening on")) c.kill("SIGTERM") }); c.stderr.on("data", d => out += d)
  c.on("exit", (code, signal) => console.log(JSON.stringify({ code, signal })))' "$IDX" $D/a.db "$FX")
echo "   SIGTERM'd server exit: $res"
[ "$res" = '{"code":null,"signal":"SIGTERM"}' ] && ok "R27 a SIGTERM'd server ends by the signal (code null, signal SIGTERM)" || bad "R27 ends by the signal" "$res"
out=$(node $S/behaviors-export.mjs $D/a.db $D/e.json 2>&1); [ $? -eq 0 ] && ok "R27 ... and the lock is free afterwards (export runs)" || bad "R27 the lock is free afterwards" "$out"

stopall
echo; [ $FAILS -eq 0 ] && { echo "FAILS: none"; exit 0; } || { echo "FAILS: $FAILS"; exit 1; }
