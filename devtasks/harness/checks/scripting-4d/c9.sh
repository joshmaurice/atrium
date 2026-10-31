#!/usr/bin/env bash
# scripting-4d-1 §6.1 check 9 — the regression set, on the round's root against the base root.
#   1. 4c's reg4c.sh (signin-sync's 28 scripts + 4b-2's r7.py, f3.py) on the BASE root and the round's root, then regdiff.py;
#   2. 4c's c1.py–c3.py (checks 1–13) against the round's REAL server (authserver.mjs HOOKS=1 STALE_ROOT=<base>),
#      with the base's real server on :8447/:8448 for 4c check 13;
#   3. signin-sync's c.py and c4b.py against the round's real server with no hooks.
# It starts and stops every server itself: nothing may be listening on 8443/8444/8447/8448 when it starts.
# Run it with the Bash tool's run_in_background (≈ 60–90 min); results in /tmp/reg/4d/ (summary: _summary.txt).
#   HARNESS_ROOT=/tmp/atrium-harness BASE_ROOT=/tmp/ah-base devtasks/harness/checks/scripting-4d/c9.sh
set -u
R=${HARNESS_ROOT:-/tmp/atrium-harness}; BASE=${BASE_ROOT:-/tmp/ah-base}
REPO=$(cd "$(dirname "$0")/../../../.." && pwd); C=$REPO/devtasks/harness/checks
OUT=/tmp/reg/4d; mkdir -p "$OUT"
# server.mjs needs a clone with scripts/library-build installed (setup.sh's ATRIUM_REPO), not necessarily this checkout
export ATRIUM_REPO=${ATRIUM_REPO:-/home/claude/atrium}
[ -d "$ATRIUM_REPO/scripts/library-build/node_modules/sharp" ] || { echo "ATRIUM_REPO=$ATRIUM_REPO has no library-build install (run setup.sh with it)"; exit 2; }
PARTS=${PARTS:-123}   # which parts to run: 1 the regression set, 2 the 4c checks, 3 signin-sync c.py/c4b.py
say() { echo "$*" | tee -a "$OUT/_summary.txt"; }
wait_listen() { for _ in $(seq 1 100); do grep -q "listening $2" "$1" 2>/dev/null && return 0; sleep 0.3; done; return 1; }
stop() { [ -n "${1:-}" ] && kill "$1" 2>/dev/null; wait "$1" 2>/dev/null; sleep 1; }

say "check 9 on $(git -C "$R/wt" rev-parse HEAD) vs base $(git -C "$BASE/wt" rev-parse HEAD), $(date -u +%FT%TZ)"

if [[ $PARTS == *1* ]]; then
# 1. the regression set on both roots (reg4c.sh hard-codes the clone at /home/claude/atrium: run a copy pointed here)
sed "s#/home/claude/atrium#$REPO#" "$C/scripting-4c/reg4c.sh" > "$OUT/reg4c.sh"
bash "$OUT/reg4c.sh" "$BASE" base4d
bash "$OUT/reg4c.sh" "$R" r4d
python3 "$C/signin-sync/regdiff.py" /tmp/reg/base4d /tmp/reg/r4d > "$OUT/regdiff.txt" 2>&1
say "-- regression set: $(grep -c '^SAME' "$OUT/regdiff.txt") SAME, $(grep -c '^DIFF' "$OUT/regdiff.txt") DIFF (regdiff.txt)"
say "   exits base: $(grep -c 'exit 0' /tmp/reg/base4d/_index.txt) of $(grep -c ' exit ' /tmp/reg/base4d/_index.txt) zero; r4d: $(grep -c 'exit 0' /tmp/reg/r4d/_index.txt) of $(grep -c ' exit ' /tmp/reg/r4d/_index.txt) zero"
paste -d' ' <(sed -n 's/^base4d \(.*\) exit \(.*\)/\1 \2/p' /tmp/reg/base4d/_index.txt) <(sed -n 's/^r4d .* exit \(.*\)/\1/p' /tmp/reg/r4d/_index.txt) \
  | awk '{ print ($2 == $3 ? "   same exit " : "   EXIT DIFFERS ") $1 " base=" $2 " r4d=" $3 }' >> "$OUT/_summary.txt"
fi

if [[ $PARTS == *2* ]]; then
# 2. 4c's checks 1–13 on the round's real server; the base real server on :8447 for check 13
ATRIUM_AUTOSAVE_DEBOUNCE_MS=3000 STALE_ROOT=$BASE HOOKS=1 HARNESS_ROOT=$R node "$C/signin-sync/authserver.mjs" > "$OUT/auth-r.log" 2>&1 &
SA=$!
PORT_A=8447 PORT_B=8448 AUTH_DB=$BASE/auth.db HARNESS_ROOT=$BASE node "$C/signin-sync/authserver.mjs" > "$OUT/auth-base.log" 2>&1 &
SB=$!
wait_listen "$OUT/auth-r.log" 8444 && wait_listen "$OUT/auth-base.log" 8448 || say "   a server did not start"
for s in c1 c2 c3; do
  ( cd "$C/scripting-4c" && HARNESS_ROOT=$R STALE_ROOT=$BASE timeout 900 python3 $s.py ) > "$OUT/4c-$s.txt" 2>&1
  say "-- 4c $s.py exit $? : $(grep -c '^  PASS' "$OUT/4c-$s.txt") PASS, $(grep -c '^  FAIL' "$OUT/4c-$s.txt") FAIL"
  grep '^  FAIL' "$OUT/4c-$s.txt" | cut -c1-240 >> "$OUT/_summary.txt"
done
stop $SA; stop $SB
fi

if [[ $PARTS == *3* ]]; then
# 3. signin-sync c.py, then c4b.py (which hard-codes /tmp/ah), on a fresh real server with no hooks
[ -e /tmp/ah ] || ln -s "$R" /tmp/ah
HARNESS_ROOT=$R node "$C/signin-sync/authserver.mjs" > "$OUT/auth-ss.log" 2>&1 &
SS=$!
wait_listen "$OUT/auth-ss.log" 8444 || say "   the signin-sync server did not start"
( cd "$C/signin-sync" && HARNESS_ROOT=$R timeout 600 python3 c.py ) > "$OUT/ss-c.txt" 2>&1
say "-- signin-sync c.py exit $? : $(grep -c 'PASS' "$OUT/ss-c.txt") PASS, $(grep -c 'FAIL' "$OUT/ss-c.txt") FAIL"
( cd "$C/signin-sync" && HARNESS_ROOT=$R timeout 300 python3 c4b.py ) > "$OUT/ss-c4b.txt" 2>&1
say "-- signin-sync c4b.py exit $? : $(tail -1 "$OUT/ss-c4b.txt" | cut -c1-200)"
stop $SS
fi
say "check 9 done $(date -u +%FT%TZ)"
