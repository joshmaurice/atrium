#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# test-release-merge.sh — local test of atrium-release-merge (Rev 3) against a
# throwaway origin (file://). Run it from this folder, as any user:
#   bash test-release-merge.sh        → expect "pass=47 fail=0"
#
# Only the paths, the file-protocol rule, the git binary (a wrapper that can
# inject a failure or a race) and atrium-host (a stub with a settable release
# state, deploy marker and legacy mode) differ from the host script.
# Cases 1–15 are Rev 2's 27 checks; E1–E10 are the second review's fault cases;
# R1–R8 are Rev 3's (S6, S7, N1, N5).
set -uo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
T=$(mktemp -d "${TMPDIR:-/tmp}/rm-test.XXXX")
trap 'rm -rf "$T"' EXIT
git() { command git -c user.name=t -c user.email=t@t -c init.defaultBranch=main -c protocol.file.allow=always "$@"; }
REAL=$(command -v git)

# The git wrapper: FAULT file "<subcommand>:<rc>" fails that subcommand once it
# is reached; RACE file is run just before a push; FD8 file records a leak.
cat > "$T/gitwrap" <<W
#!/usr/bin/env bash
[[ -e /proc/self/fd/8 ]] && echo "git \$*" >> "$T/fd8-leak"
sub=""; skip=0
for a in "\$@"; do
  if ((skip)); then skip=0; continue; fi
  case "\$a" in -C|-c) skip=1 ;; --no-pager) ;; *) sub=\$a; break ;; esac
done
if [[ -f "$T/fault" ]]; then f=\$(cat "$T/fault"); if [[ "\${f%%:*}" == "\$sub" ]]; then echo "injected \$sub failure" >&2; exit "\${f##*:}"; fi; fi
if [[ "\$sub" == push && -f "$T/race" ]]; then bash "$T/race"; rm -f "$T/race"; fi
exec $REAL "\$@"
W
# The atrium-host stub: STATE file (default COMPLETE), MARK file, LEGACY file, RECFAIL file.
cat > "$T/atrium-host" <<H
#!/usr/bin/env bash
[[ -e /proc/self/fd/8 ]] && echo "atrium-host \$*" >> "$T/fd8-leak"
case "\$*" in
  release-record) [[ -f "$T/RECFAIL" ]] && exit 1
                  printf 'STATE=%s\nREVIEWED=-\nDEV=-\n' "\$(cat "$T/STATE" 2>/dev/null || echo COMPLETE)" ;;
  "deploy-mark read") [[ -f "$T/MARK" ]] || exit 10; cat "$T/MARK" ;;
  legacy-mode) [[ -f "$T/LEGACY" ]] ;;
  *) exit 2 ;;
esac
H
chmod +x "$T/gitwrap" "$T/atrium-host"

sed -e "s#^DEV_DIR=.*#DEV_DIR=$T/dev#" \
    -e "s#^DEPLOY_LOCK=.*#DEPLOY_LOCK=$T/deploy.lock#" \
    -e "s#^ATRIUM_HOST=.*#ATRIUM_HOST=$T/atrium-host#" \
    -e 's#protocol.allow=never#protocol.allow=always#' \
    -e "s#/usr/bin/git -C#$T/gitwrap -C#" \
    "$HERE/atrium-release-merge" > "$T/rm"
grep -q "$T/gitwrap -C" "$T/rm" && grep -q "^ATRIUM_HOST=$T/atrium-host" "$T/rm" || { echo "the test could not adapt the script"; exit 1; }
chmod +x "$T/rm"; : > "$T/deploy.lock"; chmod 600 "$T/deploy.lock"

git init -q --bare "$T/origin.git"
git clone -q "$T/origin.git" "$T/work" 2>/dev/null
cd "$T/work"
mkdir -p devtasks packages && echo a > packages/a.js && echo d > devtasks/x.md
git add -A && git commit -qm base && git push -q origin main
git checkout -qb workflow/demo
echo b > packages/a.js && git commit -qam feature
REV=$(git rev-parse HEAD); git push -q origin workflow/demo
git clone -q "$T/origin.git" "$T/dev"

pass=0; fail=0
check() {
  if eval "$2"; then echo "ok   - $1"; pass=$((pass+1))
  else echo "FAIL - $1"; echo "       rc=$(cat "$T/rc") stderr: $(tr '\n' '|' < "$T/err" | cut -c1-300)"; fail=$((fail+1)); fi
}
run() { "$T/rm" "$@" >"$T/out" 2>"$T/err"; echo $? > "$T/rc"; }
rel() { sed -n 's/^RELEASE_SHA=//p' "$T/out"; }
rc() { cat "$T/rc"; }
lsr() { git ls-remote origin "refs/heads/release/${1:0:12}" | cut -f1; }
newrev() { git checkout -q -b "workflow/$1" "$(git rev-list --max-parents=0 main)"; echo "$1" > "packages/$1.js"; git add -A; git commit -qm "$1"; git push -q origin "workflow/$1"; git rev-parse HEAD; }
upload() { git checkout -q main; echo "$1" > "devtasks/$1.md"; git add -A; git commit -qm "upload $1"; git push -q origin main; }

# ── Rev 2's cases (27 checks) ────────────────────────────────────────────────
# 1. main is already an ancestor: the reviewed SHA is the release, nothing pushed
run "$REV"
check "1 no merge needed -> exit 0" '[[ $(rc) == 0 ]]'
check "1 release == reviewed" '[[ $(rel) == $REV ]]'
check "1 no release branch pushed" '[[ -z $(lsr $REV) ]]'

# 2. main gains a devtasks/ upload: a docs-only merge is made and pushed
git checkout -q main && echo r6 > devtasks/REVISION-r6.md && git add -A && git commit -qm "upload r6" && git push -q origin main
MAIN1=$(git rev-parse HEAD)
run "$REV"; R1=$(rel)
check "2 docs-only main -> exit 0" '[[ $(rc) == 0 ]]'
check "2 release is a new commit" '[[ -n $R1 && $R1 != $REV ]]'
check "2 parents are reviewed SHA and main" '[[ "$(git -C $T/dev rev-list --parents -n1 $R1)" == "$R1 $REV $MAIN1" ]]'
check "2 pushed to release/<sha12>" '[[ $(lsr $REV) == $R1 ]]'
check "2 code tree identical to reviewed (only devtasks differ)" '[[ -z "$(git -C $T/dev diff --name-only $REV $R1 | grep -v ^devtasks/)" ]]'
check "2 main fast-forwards to release" 'git -C $T/dev merge-base --is-ancestor $MAIN1 $R1'

# 3. a re-run with main unchanged reuses the release
run "$REV"
check "3 re-run reuses the same release" '[[ $(rc) == 0 && $(rel) == $R1 ]]'

# 4. main moves again (docs): merged onto the release branch, chain verified
echo pd > devtasks/passdown.md && git add -A && git commit -qm "upload passdown" && git push -q origin main
MAIN2=$(git rev-parse HEAD)
run "$REV"; R2=$(rel)
check "4 second docs upload -> new release on top" '[[ $(rc) == 0 && $R2 != $R1 && "$(git -C $T/dev rev-parse $R2^1)" == $R1 ]]'
check "4 release contains main" 'git -C $T/dev merge-base --is-ancestor $MAIN2 $R2'

# 5. main brings a code change: refused, nothing pushed
echo evil > packages/b.js && git add -A && git commit -qm "code on main" && git push -q origin main
run "$REV"
check "5 code on main -> refused (77)" '[[ $(rc) == 77 ]]'
check "5 refusal names the path" 'grep -q packages/b.js $T/err'
check "5 release branch unchanged" '[[ $(lsr $REV) == $R2 ]]'
git reset -q --hard HEAD~1 && git push -q -f origin main

# 6. a conflict in devtasks/ between the reviewed SHA and main: refused
git checkout -q workflow/demo && echo mine > devtasks/x.md && git commit -qam "worker edits docs" && REV2=$(git rev-parse HEAD) && git push -q origin workflow/demo
git checkout -q main && echo theirs > devtasks/x.md && git commit -qam "operator edits same doc" && git push -q origin main
run "$REV2"
check "6 conflict -> refused (77)" '[[ $(rc) == 77 ]] && grep -q conflict $T/err'

# 7. a tampered release branch (a non-merge commit on it): refused
git fetch -q origin && git checkout -q -b tamper "origin/release/${REV:0:12}"
echo x > packages/c.js && git add -A && git commit -qm tamper && git push -q -f origin "HEAD:refs/heads/release/${REV:0:12}"
run "$REV"
check "7 tampered release branch -> refused (77)" '[[ $(rc) == 77 ]] && grep -q "not a two-parent merge" $T/err'

# 8. a SHA that is on no origin branch, and bad arguments
run "$(printf '%040d' 0 | tr 0 a)"
check "8 unknown SHA -> refused" '[[ $(rc) == 77 ]]'
run "nothex"
check "8 bad argument -> usage (64)" '[[ $(rc) == 64 ]]'

# 9. the deploy lock is held: refused
exec 7>>"$T/deploy.lock"; flock -n 7
run "$REV"
check "9 deploy lock held -> refused" '[[ $(rc) == 77 ]] && grep -q "deployment is currently running" $T/err'
exec 7>&-

# A fresh reviewed SHA that does not contain main: branched from the first commit.
git checkout -q -b workflow/demo3 "$(git rev-list --max-parents=0 HEAD)"
echo three > packages/d.js && git add -A && git commit -qm "feature 3" && REV3=$(git rev-parse HEAD) && git push -q origin workflow/demo3
git fetch -q origin
B3="refs/heads/release/${REV3:0:12}"

# 10. a forged link whose second parent is not in main (a side commit): refused
git checkout -q -b side "$(git rev-list --max-parents=0 HEAD)"
echo side > devtasks/side.md && git add -A && git commit -qm side && SIDE=$(git rev-parse HEAD) && git push -q origin side
FT=$(git merge-tree --write-tree "$REV3" "$SIDE" | head -n1)
FORGED=$(git commit-tree "$FT" -p "$REV3" -p "$SIDE" -m forged)
git push -q -f origin "$FORGED:$B3"
run "$REV3"
check "10 forged link, second parent not in main -> refused (77)" '[[ $(rc) == 77 ]] && grep -q "not in origin/main" $T/err'

# 11. a forged link with the right parents but an extra docs file in its tree: refused
git checkout -q --detach "$REV3" && git merge -q --no-edit origin/main >/dev/null
echo forged > devtasks/forged.md && git add -A && git commit -q --amend --no-edit
git push -q -f origin "HEAD:$B3"
run "$REV3"
check "11 forged link, tree not the clean merge -> refused (77)" '[[ $(rc) == 77 ]] && grep -q "not the clean merge" $T/err'

# 12. an unrelated commit on the release branch: refused
git checkout -q --orphan stray && git rm -rqf . && echo stray > stray.txt && git add stray.txt && git commit -qm stray
git push -q -f origin "HEAD:$B3"
run "$REV3"
check "12 unrelated commit on the release branch -> refused (77)" '[[ $(rc) == 77 ]]'

# 13. a genuine release for REV3 once the branch is gone: built, pushed, verified
git push -q origin ":$B3"
run "$REV3"; R3=$(rel)
check "13 genuine release after cleanup -> exit 0" '[[ $(rc) == 0 && -n $R3 && $R3 != $REV3 ]]'
run "$REV3"
check "13 a re-run verifies its own link and reuses it" '[[ $(rc) == 0 && $(rel) == $R3 ]]'

# 14. the push is rejected by the remote: critical (70), not a plain refusal
git checkout -q -b workflow/demo4 "$(git rev-list --max-parents=0 "$REV")"
echo four > packages/e.js && git add -A && git commit -qm "feature 4" && REV4=$(git rev-parse HEAD) && git push -q origin workflow/demo4
printf '#!/bin/sh\nwhile read o n r; do case "$r" in refs/heads/release/*) echo "release pushes refused" >&2; exit 1;; esac; done\n' > "$T/origin.git/hooks/pre-receive"
chmod +x "$T/origin.git/hooks/pre-receive"
run "$REV4"
check "14 rejected push -> critical (70)" '[[ $(rc) == 70 ]] && grep -q CRITICAL $T/err'
rm -f "$T/origin.git/hooks/pre-receive"

# 15. the output names the main it merged
run "$REV4"
check "15 MAIN_AT_RELEASE printed" 'grep -q "^MAIN_AT_RELEASE=$(git rev-parse origin/main)" $T/out'

# ── the second review's fault cases (E1–E10) ─────────────────────────────────
# E1. a lease race on a NEW branch: release/<sha12> appears between the fetch and the push
R=$(newrev e1); upload u1
printf 'cd "%s" && %s push -q -f origin "%s:refs/heads/release/%s"\n' "$T/work" "$REAL" "$R" "${R:0:12}" > "$T/race"
run "$R"
check "E1 new-branch lease race -> 70, the other value kept" '[[ $(rc) == 70 && $(lsr $R) == $R ]]'

# E2. a lease race when STACKING: the branch moves between the fetch and the push
R=$(newrev e2); upload u2; run "$R"; upload u3
printf 'cd "%s" && %s push -q -f origin "%s:refs/heads/release/%s"\n' "$T/work" "$REAL" "$R" "${R:0:12}" > "$T/race"
run "$R"
check "E2 stacking lease race -> 70, not overwritten" '[[ $(rc) == 70 && $(lsr $R) == $R ]]'

# E3. M1: git diff fails -> never an empty, acceptable diff; nothing pushed
R=$(newrev e3); upload u4; echo "diff:128" > "$T/fault"; run "$R"; rm -f "$T/fault"
check "E3 failing git diff -> 77 and no push" '[[ $(rc) == 77 && -z $(lsr $R) ]]'

# E4. merge-tree fails for a reason other than a conflict (N1)
R=$(newrev e4); upload u5; echo "merge-tree:128" > "$T/fault"; run "$R"; rm -f "$T/fault"
check "E4 merge-tree error (not a conflict) -> 75, no push" '[[ $(rc) == 75 && -z $(lsr $R) ]]'

# E5. the first fetch fails -> 75
echo "fetch:1" > "$T/fault"; run "$R"; rm -f "$T/fault"
check "E5 fetch failure -> 75" '[[ $(rc) == 75 ]]'

# E6. commit-tree fails -> 75, no push
echo "commit-tree:128" > "$T/fault"; run "$R"; rm -f "$T/fault"
check "E6 commit-tree failure -> 75, no push" '[[ $(rc) == 75 && -z $(lsr $R) ]]'

# E7. a symlink under devtasks/ on main -> refused before the push (S7)
R=$(newrev e7); git checkout -q main; ln -s ../packages/a.js devtasks/link.md; git add -A; git commit -qm "symlink"; git push -q origin main
run "$R"
check "E7 symlink in devtasks/ -> 77, names it, no push" '[[ $(rc) == 77 && -z $(lsr $R) ]] && grep -q "devtasks/link.md (mode 120000)" $T/err'
git rm -q devtasks/link.md; git commit -qm "rm symlink"; git push -q origin main

# E8. main is rewound (force-pushed) after a link was built: refused, branch must be deleted by hand
R=$(newrev e8); upload u8; run "$R"
git checkout -q main; git reset -q --hard HEAD~1; git push -q -f origin main; upload u9
run "$R"
check "E8 rewound main -> 77 naming the link" '[[ $(rc) == 77 ]] && grep -q "not in origin/main" $T/err'

# E9. modify (reviewed) / delete (main) on one devtasks file -> conflict -> 77
git checkout -q -b workflow/e9 "$(git rev-list --max-parents=0 main)"; echo mine > devtasks/x.md; echo e9 > packages/e9.js; git add -A; git commit -qm e9; git push -q origin workflow/e9; R=$(git rev-parse HEAD)
git checkout -q main; git rm -q devtasks/x.md; git commit -qm "delete x"; git push -q origin main
run "$R"
check "E9 modify/delete conflict -> 77" '[[ $(rc) == 77 ]] && grep -q conflict $T/err'

# E10. a pushed release that the post-push fetch cannot read back -> 70; a re-run recovers
R=$(newrev e10); upload u10
printf 'echo "fetch:1" > "%s"\n' "$T/fault" > "$T/race"
run "$R"; rm -f "$T/fault"
check "E10 post-push fetch failure -> 70" '[[ $(rc) == 70 ]]'
P=$(lsr $R); run "$R"
check "E10 re-run verifies the landed link and reuses it" '[[ $(rc) == 0 && $(rel) == $P ]]'

# ── Rev 3 (S6, S7, N1, N5) ───────────────────────────────────────────────────
# R1. S6: the release state would refuse the deploy -> 77 before the push
R=$(newrev r1); upload u11
echo WAITING_FOR_PROD_APPROVAL > "$T/STATE"; run "$R"; rm -f "$T/STATE"
check "R1 release state refuses -> 77, names the state, no push" '[[ $(rc) == 77 && -z $(lsr $R) ]] && grep -q WAITING_FOR_PROD_APPROVAL $T/err'
# R2. S6: an interrupted deploy is recorded -> 77, no push
echo "TARGET_SHA=x" > "$T/MARK"; run "$R"; rm -f "$T/MARK"
check "R2 deploy marker present -> 77, no push" '[[ $(rc) == 77 && -z $(lsr $R) ]] && grep -q "interrupted DEV deploy" $T/err'
# R3. S6: legacy mode -> 77, no push
: > "$T/LEGACY"; run "$R"; rm -f "$T/LEGACY"
check "R3 legacy mode -> 77, no push" '[[ $(rc) == 77 && -z $(lsr $R) ]] && grep -q "legacy mode" $T/err'
# R4. S6: the record can't be read -> 77 (fail closed), no push
: > "$T/RECFAIL"; run "$R"; rm -f "$T/RECFAIL"
check "R4 unreadable release record -> 77, no push" '[[ $(rc) == 77 && -z $(lsr $R) ]]'
# R5. S6 runs only when a push is due: with nothing to push the state is not consulted
R5=$(git rev-parse main); git branch -q -f workflow/r5 "$R5"; git push -q origin workflow/r5
echo WAITING_FOR_PROD_APPROVAL > "$T/STATE"; run "$R5"; rm -f "$T/STATE"
check "R5 nothing to push -> exit 0 whatever the state (atrium-deploy decides)" '[[ $(rc) == 0 && $(rel) == $R5 ]]'
# R6. with every S6 check passing, the same SHA now builds and pushes
run "$R"
check "R6 all clear -> exit 0 and pushed" '[[ $(rc) == 0 && $(lsr $R) == $(rel) ]]'
# R7. S7: a submodule (gitlink) under devtasks/ on main -> 77, no push
R=$(newrev r7); git checkout -q main
git update-index --add --cacheinfo "160000,$(git rev-parse HEAD),devtasks/sub"; git commit -qm "gitlink"; git push -q origin main
run "$R"
check "R7 submodule in devtasks/ -> 77, names it, no push" '[[ $(rc) == 77 && -z $(lsr $R) ]] && grep -q "devtasks/sub (mode 160000)" $T/err'
git rm -q --cached devtasks/sub; git commit -qm "rm gitlink"; git push -q origin main
# R8. S7: an executable doc and a deleted doc are fine
R=$(newrev r8); git checkout -q main; echo '#!/bin/sh' > devtasks/run.sh; chmod +x devtasks/run.sh; git rm -q devtasks/u1.md; git add -A; git commit -qm "exec + delete"; git push -q origin main
run "$R"
check "R8 100755 doc and a deletion -> exit 0" '[[ $(rc) == 0 && -n $(lsr $R) ]]'
# N5: no git child and no atrium-host call saw the deploy lock's fd 8
check "N5 no child inherited fd 8" '[[ ! -s $T/fd8-leak ]]'

echo "pass=$pass fail=$fail"
