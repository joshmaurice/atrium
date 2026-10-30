"""atrium-kanban-guard: mechanical checks on Atrium Kanban task creation.

Enforces the task-creation contract from the 2026-09-24 stabilization work, on
the boards in GUARDED_BOARDS only:

  - Release/gate stages use exact titles "<Stage> — <sha8>" and carry the full
    lowercase 40-char SHA in the body exactly once. The guard canonicalizes the
    title and sets idempotency_key = "atrium:<stage>:<sha>" (one live task per
    stage per SHA).
  - Deployer tasks request exactly one atrium_deploy action and never ask the
    deployer to create tasks. Worker tasks (GLM/Nemotron/DeepSeek) may not mention
    atrium_deploy or be titled as a MAIN merge/push.
  - Human-gate unblocks, and MAIN/PROD task creation, require a
    'HUMAN APPROVAL: "<exact words>"' comment on the gate task.
  - Tasks without max_runtime_seconds get a cap; stage tasks, gates,
    finalizers and sentinels get max_retries=1 (set after creation, since the
    kanban_create tool cannot pass it).
  - v1.2.0 (host round 2026-10-30, signin-sync passdown §4.3): a card created on a
    guarded board WITHOUT a parent (anything but a "Kickoff — <slug>" card) is created
    blocked, so the dispatcher can never claim it before its parents are linked; the
    first kanban_link that gives it a parent releases it to todo. And the argument
    KEYS (never values) of every kanban_create / kanban_complete are logged, to find
    where bodies, runtime caps and summaries are being dropped.
  - v1.1.4: sentinel auto-link only for review/revision gates; a human gate may not be
    linked as a sentinel's parent; blocked "acceptance"/"approval" gates must use the
    canonical titles; notes on own-card scope for block/complete, and on the
    deployer's deferred atrium_deploy tool.
  - v1.1.3: a caller's max_runtime_seconds below the default is raised to the default
    (the orchestrator passed "90" meaning minutes; it was read as 90 seconds).
  - v1.1.2: branch from fresh origin/main; gates told what the sentinel child is;
    "merge origin/main into <branch>" is no longer mistaken for a MAIN push.
  - Every task body gets plain operating notes (cap, kanban_show use, truncation
    markers, where git work must happen, capability blocks). v1.1.1 corrected the
    git note: uncommitted work in a scratch folder or /tmp is lost when the task's
    container is discarded, and the shared checkout is on main and dirty.
  - kanban_show results drop the duplicated startup context (worker_context)
    and heartbeat events; a fast model kept misreading that blob's
    "[truncated ...]" markers as missing instructions and re-fetching forever.
  - When the orchestrator creates a gate or DEV finalizer, the workflow's open
    sentinel is linked to it (and unblocked into todo if it had blocked itself),
    so the sentinel never waits on only-finished parents and re-launches.

Blocks return a message telling the agent exactly what to fix. Internal errors
are logged and fail open (the host-side release gates still apply).
Log: $HERMES_HOME/logs/atrium-kanban-guard.log
"""
import json
import os
import re
import time

GUARDED_BOARDS = {"atrium"} | {
    b.strip() for b in os.environ.get("ATRIUM_GUARD_EXTRA_BOARDS", "").split(",") if b.strip()}
ORCH, DEPLOYER = "atrium-orchestrator", "atrium-deployer"
ATRIUM_PROFILES = {ORCH, DEPLOYER, "atrium-glm", "atrium-nemotron", "atrium-deepseek"}
FOOTER_MARK = "Operating notes for this task (added automatically; your instructions above are complete):"
OLD_FOOTER_MARKS = ("[atrium-kanban-guard]",)  # v1.0.0/1.0.1 footer; never add a second footer
APPROVAL_PREFIX = "HUMAN APPROVAL:"
NO_PARENT_NOTE = ("- This card was created without a parent, so the guard created it blocked: nothing "
                  "runs it until a parent is linked. Linking its parent with kanban_link releases it.")
_KICKOFF = re.compile(r"^\s*kickoff\b", re.I)

# stage: (canonical title, required assignee, atrium_deploy action, cap minutes, human gate)
STAGES = {
    "publish":       ("Publish workflow", DEPLOYER, "publish", 10, False),
    "dev-deploy":    ("DEV deploy", DEPLOYER, "dev", 45, False),
    "dev-finalize":  ("DEV finalizer", ORCH, None, 10, False),
    "dev-accept":    ("Awaiting DEV acceptance / main merge approval", ORCH, None, 10, True),
    "main":          ("MAIN push", DEPLOYER, "main", 10, False),
    "prod-approval": ("Awaiting PROD approval", ORCH, None, 10, True),
    "prod-deploy":   ("PROD deploy", DEPLOYER, "prod", 30, False),
}
APPROVAL_GATE_FOR = {"main": "dev-accept", "prod-deploy": "prod-approval"}
_STAGE_RES = [
    (stage, re.compile(r"^\s*" + r"\s+".join(map(re.escape, spec[0].split()))
                       + r"\s*[—–-]\s*(?P<sha8>[0-9a-fA-F]{8})\s*$", re.I))
    for stage, spec in STAGES.items()]
_SHA40 = re.compile(r"(?<![0-9A-Za-z])[0-9a-fA-F]{40}(?![0-9A-Za-z])")
_ACTION = re.compile(r"""action\s*[=:]\s*["']?(publish|dev|main|prod)\b""", re.I)


def _templates(human=None):
    rows = []
    for stage, (title, who, action, _, is_human) in STAGES.items():
        if human is None or is_human == human:
            extra = f', action="{action}"' if action else (", initial_status=\"blocked\"" if is_human else "")
            rows.append(f'"{title} — <sha8>" ({who}{extra})')
    return "; ".join(rows)


def _log(entry):
    try:
        home = os.environ.get("HERMES_HOME") or os.path.expanduser("~/.hermes")
        path = os.path.join(home, "logs", "atrium-kanban-guard.log")
        os.makedirs(os.path.dirname(path), exist_ok=True)
        entry = {"ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
                 "profile": os.environ.get("HERMES_PROFILE", ""), **entry}
        with open(path, "a") as f:
            f.write(json.dumps(entry) + "\n")
    except Exception:
        pass


def _board(args):
    raw = str(args.get("board") or "").strip()
    try:
        from hermes_cli import kanban_db as kb
        return kb._normalize_board_slug(raw) if raw else kb.get_current_board()
    except Exception:
        return raw or None


def _connect(board):
    from hermes_cli import kanban_db_connect as kbc
    return kbc.connect_closing(board=board)


def _match_stage(title):
    for stage, rx in _STAGE_RES:
        m = rx.match(title or "")
        if m:
            return stage, m.group("sha8").lower()
    return None, None


def _is_review_gate(assignee, title):
    """Orchestrator review/revision gates (not human gates or admin tasks mentioning a gate)."""
    low = (title or "").lower()
    return (assignee == ORCH and _match_stage(title)[0] is None
            and bool(re.search(r"\b(review|revision)\s+gate\b|^\s*gate\b", low)))


def _is_short_orch(assignee, title):
    t = (title or "").lower()
    return assignee == ORCH and any(k in t for k in ("gate", "sentinel", "finaliz"))


def _default_cap_min(assignee, title):
    if assignee == ORCH:
        return 10 if _is_short_orch(assignee, title) else 30
    if assignee in ("atrium-glm", "atrium-nemotron"):
        return 45
    if assignee == "atrium-deepseek":
        return 90
    return 30


def _cap_arg(args):
    """The caller's max_runtime_seconds as a positive int, or None if absent/invalid."""
    try:
        v = int(str(args.get("max_runtime_seconds")).strip())
        return v if v > 0 else None
    except (TypeError, ValueError):
        return None


def _with_footer(body, cap_min, finalizer=False, assignee="", no_parent=False):
    """Append plain-prose operating notes. v1.0.2: no bracketed tag or separator,
    which a fast model misread as a truncation marker and then kept re-fetching."""
    if FOOTER_MARK in body or any(m in body for m in OLD_FOOTER_MARKS):
        return body
    lines = [FOOTER_MARK,
             f"- Runtime cap: {cap_min} minutes.",
             "- Your task card, its comments, and your parents' handoffs are already in your startup "
             "context. Call kanban_show only for something that is not, such as a parent's full "
             "handoff, and never more than once for the same task. The task shown when no id is "
             "given is this task.",
             "- A \"[truncated, N chars omitted]\" marker means that field was shortened for length. "
             "It does not mean your instructions are missing.",
             "- Git: the shared checkout /workspace/atrium stays on main and holds unrelated changes, "
             "so never edit or commit there. Do workflow-branch work in the persistent worktree "
             "/workspace/wt/<name>, where <name> is the branch without its workflow/ prefix (create it "
             "with git -C /workspace/atrium worktree prune, then git -C /workspace/atrium worktree add "
             "/workspace/wt/<name> <branch>). Reviewers never use that worktree: review in your own "
             "detached one at /workspace/wt/review-<your task id> (git -C /workspace/atrium worktree add --detach "
             "/workspace/wt/review-<your task id> <sha>). Never delete a worktree or run git worktree remove. "
             "Your scratch folder and /tmp are discarded when the task "
             "ends, so anything left uncommitted there is lost. Review with read-only commands "
             "(git show <sha>). Start any new workflow branch from a freshly fetched origin/main "
             "(git -C /workspace/atrium fetch origin main), never from the shared checkout's local "
             "main, which is stale. Workflow commits exist only locally until published, so never "
             "fetch workflow/* branches from GitHub.",
             "- If this task needs access, credentials, or a tool you do not have, call kanban_block "
             "with kind=\"capability\" immediately, saying what is missing. Do not search for "
             "workarounds or repeat a failing call."]
    lines.append("- kanban_block and kanban_complete without a task_id act on this task. You cannot "
                 "complete, block or archive other cards; you can only comment on them.")
    if assignee == DEPLOYER:
        lines.append("- atrium_deploy is a deferred tool: find it with tool_search (query \"atrium_deploy\") "
                     "and load it before concluding it is unavailable. It is never a shell command.")
    if assignee == ORCH:
        lines.append("- A child task titled \"... sentinel\" is the workflow's completion notifier, "
                     "linked to gates and finalizers on purpose. It is not work left by an earlier run.")
    if no_parent:
        lines.append(NO_PARENT_NOTE)
    if finalizer:
        lines.append("- Verify only from the parent task's handoff (deployed SHA, health results). "
                     "Do not probe host services, files, or logs from the sandbox; if the handoff "
                     "lacks the evidence, block with kind=\"capability\".")
    return (body.rstrip() + "\n\n" if body.strip() else "") + "\n".join(lines)


def _approval(board, gate_ids_created):
    """First gate id that has a HUMAN APPROVAL comment newer than the gate, else None."""
    with _connect(board) as conn:
        for gid, created in gate_ids_created:
            row = conn.execute(
                "SELECT 1 FROM task_comments WHERE task_id = ? AND body LIKE ? AND created_at >= ? LIMIT 1",
                (gid, APPROVAL_PREFIX + "%", created)).fetchone()
            if row:
                return gid
    return None


def _approval_instruction(gid):
    return (f'Record the user\'s exact words on gate {gid} first: kanban_comment(task_id="{gid}", '
            f'body=\'{APPROVAL_PREFIX} "<their exact message>" (<channel>, <UTC time>)\'), then retry. '
            f'Never paraphrase or infer approval.')


def _block(tool, args, msg):
    _log({"event": "block", "tool": tool, "title": str(args.get("title") or args.get("task_id") or "")[:120],
          "assignee": args.get("assignee"), "reason": msg})
    return {"action": "block", "message": "atrium-kanban-guard: " + msg}


def _parents(args):
    """The parent ids a kanban_create call passes: a list, or a comma/space separated string."""
    raw = args.get("parents")
    if raw is None:
        raw = args.get("parent")
    if isinstance(raw, str):
        raw = re.split(r"[\s,]+", raw)
    if not isinstance(raw, (list, tuple)):
        return []
    return [str(p).strip() for p in raw if str(p or "").strip()]


def _needs_parent_hold(args):
    """v1.2.0: True when this create has no parent and isn't a kickoff (the only root card)."""
    return not _parents(args) and not _KICKOFF.match(str(args.get("title") or ""))


def _hold_mods(args, mods):
    """v1.2.0: create a parentless card blocked. A card the caller already creates blocked
    (a human gate) keeps that and is never released by a link."""
    if not _needs_parent_hold(args):
        return mods
    if str(args.get("initial_status") or "") != "blocked":
        mods["initial_status"] = "blocked"
    _log({"event": "no_parent_hold", "title": str(args.get("title") or "")[:120],
          "assignee": args.get("assignee"),
          "caller_blocked": str(args.get("initial_status") or "") == "blocked"})
    return mods


def _arg_keys_log(tool_name, args):
    """v1.2.0 diagnostics: which argument KEYS arrived (never their values), plus sizes."""
    _log({"event": "args", "tool": tool_name, "keys": sorted(str(k) for k in args),
          "body_chars": len(str(args.get("body") or "")),
          "summary_chars": len(str(args.get("summary") or "")),
          "result_chars": len(str(args.get("result") or "")),
          "parents": len(_parents(args)),
          "max_runtime_seconds": _cap_arg(args)})


def _check_create(board, args):
    title = str(args.get("title") or "")
    body = str(args.get("body") or "")
    if "/workspace/wt-" in body:
        return _block("kanban_create", args, "the body uses the old worktree path /workspace/wt-<name>. Worktrees live at /workspace/wt/<name>; a new branch is created with git -C /workspace/atrium worktree add -b workflow/<name> /workspace/wt/<name> <base_main_sha>.")
    assignee = str(args.get("assignee") or "").strip()
    B = lambda msg: _block("kanban_create", args, msg)  # noqa: E731

    if assignee and assignee not in ATRIUM_PROFILES:
        return B(f"assignee '{assignee}' is not an Atrium profile; use one of {sorted(ATRIUM_PROFILES)}.")

    stage, sha8 = _match_stage(title)
    low = title.lower()
    if stage is None:
        if low.lstrip().startswith("awaiting") or (
                assignee == ORCH and str(args.get("initial_status") or "") == "blocked"
                and re.search(r"accept|approv", low)):
            return B("human-gate titles must be exactly one of: " + _templates(human=True))
        if assignee == DEPLOYER:
            return B("atrium-deployer tasks must use one stage title: " + _templates(human=False))
        if assignee == ORCH and "finaliz" in low:
            return B('finalizer titles must be exactly "DEV finalizer — <sha8>".')
        # Content heuristics apply to worker profiles only: the orchestrator legitimately
        # describes later MAIN/deploy steps in kickoff and gate bodies.
        worker = assignee in ATRIUM_PROFILES - {ORCH, DEPLOYER}
        into_main = (re.search(r"\b(?:to|into|onto)\s+(?:origin/)?main\b", low)
                     or re.search(r"\bmain\s+(?:merge|push)", low) or "refs/heads/main" in low)
        if worker and into_main and re.search(r"\b(merge|push)", low):
            return B('MAIN transitions must be "MAIN push — <sha8>" tasks assigned to atrium-deployer '
                     '(atrium_deploy action="main"); never a raw git push.')
        if worker and "atrium_deploy" in body:
            return B("only atrium-deployer stage tasks may call atrium_deploy: " + _templates(human=False))
        given = _cap_arg(args)
        cap_s = max(given or 0, _default_cap_min(assignee, title) * 60)
        if given and given < cap_s:
            _log({"event": "cap_raised", "title": title[:120], "given": given, "set": cap_s})
        mods = {"body": _with_footer(body, cap_s // 60, assignee=assignee,
                                     no_parent=_needs_parent_hold(args)),
                "max_runtime_seconds": cap_s}
        mods = _hold_mods(args, mods)
        _log({"event": "modify", "title": title[:120], "assignee": assignee, "keys": sorted(mods)})
        return {"action": "modify", "args": mods}

    canon, want, action, stage_cap, human = STAGES[stage]
    if assignee != want:
        return B(f'"{canon} — <sha8>" tasks must be assigned to {want} (got "{assignee or "(none)"}").')
    shas = set(_SHA40.findall(body))
    if any(s != s.lower() for s in shas if s.lower().startswith(sha8)):
        return B("write the SHA in lowercase.")
    matching = sorted({s for s in shas if s.startswith(sha8)})
    if len(matching) != 1:
        return B(f"the body must contain the full lowercase 40-character SHA starting with {sha8} "
                 f"exactly once (found {len(matching)} distinct).")
    sha = matching[0]
    if human and str(args.get("initial_status") or "") != "blocked":
        return B('human-gate tasks must be created with initial_status="blocked" (put the reason in the body).')
    if action:
        found = {a.lower() for a in _ACTION.findall(body)}
        if found != {action}:
            return B(f'the body must request exactly one deploy action: atrium_deploy(action="{action}", '
                     f'sha="{sha}") (found: {sorted(found) or "none"}). One privileged action per task.')
        if "kanban_create" in body:
            return B("atrium-deployer cannot create tasks; create downstream tasks yourself with "
                     "parents=[<this deployer task id>].")
        if action == "publish" and not re.search(r"workflow/[A-Za-z0-9._/-]+", body):
            return B("publish tasks must name the exact workflow/<branch> to publish.")
    if stage in APPROVAL_GATE_FOR:
        gate_title = f"{STAGES[APPROVAL_GATE_FOR[stage]][0]} — {sha8}"
        with _connect(board) as conn:
            gates = [(r[0], r[1]) for r in conn.execute(
                "SELECT id, created_at FROM tasks WHERE title = ? AND status != 'archived' "
                "ORDER BY created_at DESC", (gate_title,)).fetchall()]
        if not gates:
            return B(f'no open "{gate_title}" gate task exists; the human gate must exist, and be '
                     f'approved, before this task is created.')
        if not _approval(board, gates):
            return B(f'no {APPROVAL_PREFIX} comment on "{gate_title}". ' + _approval_instruction(gates[0][0]))

    given = _cap_arg(args)
    cap_s = max(given or 0, stage_cap * 60)
    if given and given < cap_s:
        _log({"event": "cap_raised", "stage": stage, "given": given, "set": cap_s})
    mods = {"title": f"{canon} — {sha8}", "idempotency_key": f"atrium:{stage}:{sha}",
            "body": _with_footer(body, cap_s // 60, finalizer=(stage == "dev-finalize"), assignee=assignee,
                                 no_parent=_needs_parent_hold(args)),
            "max_runtime_seconds": cap_s}
    mods = _hold_mods(args, mods)
    _log({"event": "modify", "stage": stage, "sha": sha, "assignee": assignee, "keys": sorted(mods)})
    return {"action": "modify", "args": mods}


def _operator_block_reason(board, tid):
    """The task's most recent block reason if it contains OPERATOR BLOCK, else None."""
    import json as _j
    with _connect(board) as conn:
        r = conn.execute("SELECT payload FROM task_events WHERE task_id = ? AND kind = 'blocked' "
                         "ORDER BY id DESC LIMIT 1", (tid,)).fetchone()
    if not r or not r[0]:
        return None
    try:
        reason = str((_j.loads(r[0]) or {}).get("reason") or "")
    except Exception:
        reason = str(r[0])
    return reason if "OPERATOR BLOCK" in reason.upper() else None


def _check_unblock(board, args):
    tid = str(args.get("task_id") or "").strip()
    if not tid:
        return None
    op_reason = _operator_block_reason(board, tid)
    if op_reason is not None:
        return _block("kanban_unblock", args, f"{tid} was blocked by the operator ({op_reason[:80]!r}). Only the user can release it: tell them and wait.")
    with _connect(board) as conn:
        row = conn.execute("SELECT title, created_at FROM tasks WHERE id = ?", (tid,)).fetchone()
    if not row:
        return None
    stage, _ = _match_stage(row[0])
    if stage is None or not STAGES[stage][4]:
        return None
    if _approval(board, [(tid, row[1])]):
        _log({"event": "allow_unblock", "task_id": tid})
        return None
    return _block("kanban_unblock", args, f"{tid} is a human gate. " + _approval_instruction(tid))


def _check_link(board, args):
    parent, child = str(args.get("parent_id") or ""), str(args.get("child_id") or "")
    if not parent or not child:
        return None
    with _connect(board) as conn:
        rows = {r[0]: r[1] for r in conn.execute(
            "SELECT id, title FROM tasks WHERE id IN (?, ?)", (parent, child)).fetchall()}
    ptitle, ctitle = rows.get(parent, ""), rows.get(child, "")
    pstage, _ = _match_stage(ptitle)
    if "sentinel" in ctitle.lower() and pstage and STAGES[pstage][4]:
        return _block("kanban_link", args, f"{parent} is a human gate; a sentinel must not wait on it (it "
                      "would only fire after the human acts). Link the DEV finalizer as the sentinel's parent.")
    return None


def _deploy_target(tool_name, args):
    """True if this call runs atrium_deploy, directly or through the deferred-tool wrapper."""
    if tool_name == "atrium_deploy":
        return True
    if tool_name == "tool_call" and isinstance(args, dict):
        return any(args.get(k) == "atrium_deploy" for k in ("name", "tool", "tool_name"))
    return False


def _check_deploy_once(tool_name, args):
    """Allow one atrium_deploy call per kanban task; refuse any later one."""
    tid = os.environ.get("HERMES_KANBAN_TASK", "").strip()
    if not tid:
        return None
    home = os.environ.get("HERMES_HOME") or os.path.expanduser("~/.hermes")
    state = os.path.join(home, "atrium-kanban-guard-state")
    marker = os.path.join(state, f"deploy-{tid}")
    if os.path.exists(marker):
        try:
            first = open(marker).read().strip()
        except Exception:
            first = "earlier in this task"
        return _block("atrium_deploy", {"task_id": tid},
                      f"atrium_deploy was already called once in {tid} ({first}). A deploy task makes exactly "
                      f"one call: its result is earlier in this conversation. Report it "
                      f"and complete, or if you can't find it, block with kind='needs_input' quoting this message. Never call it again.")
    os.makedirs(state, exist_ok=True)
    with open(marker, "w") as f:
        f.write(time.strftime("%Y-%m-%dT%H:%M:%S%z") + " via " + str(tool_name))
    _log({"event": "allow_deploy", "task_id": tid, "tool": tool_name})
    return None


def pre_tool_call(tool_name=None, args=None, **kwargs):
    if _deploy_target(tool_name, args):
        try:
            return _check_deploy_once(tool_name, args)
        except Exception as exc:  # fail open; the host release state machine still applies
            _log({"event": "error", "tool": tool_name, "error": repr(exc)})
            return None
    if tool_name not in ("kanban_create", "kanban_unblock", "kanban_link", "kanban_complete"):
        return None
    args = args if isinstance(args, dict) else {}
    try:
        board = _board(args)
        if board not in GUARDED_BOARDS:
            return None
        if tool_name in ("kanban_create", "kanban_complete"):
            _arg_keys_log(tool_name, args)
        if tool_name == "kanban_complete":
            return None   # v1.2.0: logged only, never changed
        if tool_name == "kanban_create":
            return _check_create(board, args)
        if tool_name == "kanban_link":
            return _check_link(board, args)
        return _check_unblock(board, args)
    except Exception as exc:  # fail open; host-side release gates still apply
        _log({"event": "error", "tool": tool_name, "error": repr(exc)})
        return None


def post_tool_call(tool_name=None, args=None, result=None, **kwargs):
    if tool_name == "kanban_link":
        try:
            args = args if isinstance(args, dict) else {}
            board = _board(args)
            if board in GUARDED_BOARDS:
                _release_held(board, str(args.get("child_id") or "").strip())
        except Exception as exc:
            _log({"event": "error", "tool": "post_kanban_link", "error": repr(exc)})
        return None
    if tool_name != "kanban_create":
        return None
    try:
        args = args if isinstance(args, dict) else {}
        board = _board(args)
        if board not in GUARDED_BOARDS:
            return None
        data = json.loads(result) if isinstance(result, str) else result
        tid = data.get("task_id") if isinstance(data, dict) else None
        if not tid:
            return None
        title, assignee = str(args.get("title") or ""), str(args.get("assignee") or "")
        try:
            _link_sentinel(board, tid, title, assignee)
        except Exception as exc:
            _log({"event": "error", "tool": "sentinel_link", "error": repr(exc)})
        if _match_stage(title)[0] is None and not _is_short_orch(assignee, title):
            return None
        from hermes_cli import kanban_db_connect as kbc
        with _connect(board) as conn:
            with kbc.write_txn(conn):
                n = conn.execute("UPDATE tasks SET max_retries = 1 WHERE id = ? AND max_retries IS NULL",
                                 (tid,)).rowcount
        _log({"event": "max_retries", "task_id": tid, "updated": n})
    except Exception as exc:
        _log({"event": "error", "tool": "post_kanban_create", "error": repr(exc)})
    return None


def _is_gate_title(title):
    """A human gate or an operator gate: never released by a link (they stay blocked)."""
    stage, _ = _match_stage(title)
    return bool(stage and STAGES[stage][4]) or "OPERATOR BLOCK" in (title or "").upper()


def _release_held(board, child):
    """v1.2.0: a card this guard created blocked for want of a parent goes to todo once it
    has one. Released only when ALL hold: it was created blocked with no parents; its body
    carries NO_PARENT_NOTE (so the guard, not the caller, made it blocked); it is still
    blocked with no later block event and no run; it now has a parent; it isn't a gate."""
    if not child:
        return
    from hermes_cli import kanban_db as kb
    with _connect(board) as conn:
        row = conn.execute("SELECT title, status, body FROM tasks WHERE id = ?", (child,)).fetchone()
        if not row or row[1] != "blocked" or _is_gate_title(row[0]) or NO_PARENT_NOTE not in str(row[2] or ""):
            return
        if not conn.execute("SELECT 1 FROM task_links WHERE child_id = ? LIMIT 1", (child,)).fetchone():
            return
        events = conn.execute("SELECT kind, payload FROM task_events WHERE task_id = ? ORDER BY id",
                              (child,)).fetchall()
        kinds = [e[0] for e in events]
        try:
            created = json.loads(events[0][1] or "{}") if events and events[0][0] == "created" else {}
        except Exception:
            created = {}
        if created.get("status") != "blocked" or created.get("parents"):
            return
        if "blocked" in kinds or "claimed" in kinds or "unblocked" in kinds:
            return   # someone blocked it since, it has run, or it was released already
        released = bool(kb.unblock_task(conn, child))
    _log({"event": "no_parent_released", "task_id": child, "released": released})


def _link_sentinel(board, new_tid, title, assignee):
    """Make the workflow's single open sentinel wait on a newly created gate/finalizer."""
    stage, _ = _match_stage(title)
    if not (stage == "dev-finalize" or _is_review_gate(assignee, title)):
        return
    from hermes_cli import kanban_db as kb
    with _connect(board) as conn:
        rows = conn.execute(
            "SELECT id, status FROM tasks WHERE lower(title) LIKE '%sentinel%' AND assignee = ? "
            "AND status IN ('todo', 'ready', 'running', 'blocked') AND id != ?", (ORCH, new_tid)).fetchall()
        if len(rows) != 1:
            _log({"event": "sentinel_link_skipped", "task_id": new_tid,
                  "reason": f"{len(rows)} open sentinels (need exactly 1)"})
            return
        sid, sstatus = rows[0][0], rows[0][1]
        if conn.execute("SELECT 1 FROM task_links WHERE parent_id = ? AND child_id = ?",
                        (new_tid, sid)).fetchone():
            return
        kb.link_tasks(conn, new_tid, sid)
        unblocked = False
        if sstatus == "blocked":
            unblocked = bool(kb.unblock_task(conn, sid))
    _log({"event": "sentinel_linked", "parent": new_tid, "sentinel": sid, "unblocked": unblocked})


def transform_tool_result(tool_name=None, args=None, result=None, **kwargs):
    """Drop worker_context (a duplicate of the startup prompt) and heartbeat noise from kanban_show."""
    if tool_name != "kanban_show" or not isinstance(result, str):
        return None
    try:
        args = args if isinstance(args, dict) else {}
        if _board(args) not in GUARDED_BOARDS:
            return None
        data = json.loads(result)
        if not isinstance(data, dict) or "task" not in data or "worker_context" not in data:
            return None
        data.pop("worker_context", None)
        if isinstance(data.get("events"), list):
            data["events"] = [e for e in data["events"]
                              if not (isinstance(e, dict) and e.get("kind") == "heartbeat")]
        data["note"] = ("This is the complete task record. The startup context you already received "
                        "is not repeated here.")
        _log({"event": "kanban_show_trimmed", "task_id": (data.get("task") or {}).get("id"),
              "chars_before": len(result)})
        return json.dumps(data, ensure_ascii=False)
    except Exception as exc:
        _log({"event": "error", "tool": "transform_kanban_show", "error": repr(exc)})
        return None


def register(ctx):
    ctx.register_hook("pre_tool_call", pre_tool_call)
    ctx.register_hook("post_tool_call", post_tool_call)
    ctx.register_hook("transform_tool_result", transform_tool_result)
