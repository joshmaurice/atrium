#!/usr/bin/env bash
# scripting-4c check 9: signin-sync's 28-script regression set (reg_run.sh) plus 4b-2's r7.py and f3.py,
# for one harness root; outputs to /tmp/reg/<label>/. Run it for the base and for 4c, then regdiff.py.
#   reg4c.sh /tmp/ah-base base ; reg4c.sh /tmp/atrium-harness r4c ; python3 ../signin-sync/regdiff.py /tmp/reg/base /tmp/reg/r4c
ROOT=$1; LABEL=$2; OUT=/tmp/reg/$LABEL; rm -rf $OUT; mkdir -p $OUT
C=/home/claude/atrium/devtasks/harness/checks
HARNESS_ROOT=$ROOT node $ROOT/harness/server.mjs > $ROOT/server.log 2>&1 &
SRV=$!; sleep 8
run() { local dir=$1 s=$2; ( cd $C/$dir && HARNESS_ROOT=$ROOT timeout 420 python3 $s.py ) > $OUT/$dir-$s.txt 2>&1; echo "$LABEL $dir/$s exit $?" >> $OUT/_index.txt; }
for s in c1 c8; do run scripting-4b-1 $s; done
run scripting-4b-2 c4_4b1_newtext
for s in r7 f3; do run scripting-4b-2 $s; done
for s in c1 c4 c6 c7 c8b c9; do run scripting-4a $s; done
for s in c1 c1b c1c c11 c12 c13 c14 c23 c4 c5 c67 c8 c910; do run library-sky $s; done
for s in a b c d e f; do run edit-polish-3 $s; done
kill $SRV; wait $SRV 2>/dev/null; echo "$LABEL done" >> $OUT/_index.txt
