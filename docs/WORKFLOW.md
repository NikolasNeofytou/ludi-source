# Working session rituals

Two small scripts under `scripts/` make working sessions less leaky and more focused. They're not magic — they just automate the rituals you'd otherwise skip when you're tired. Run them, trust them.

```
scripts/morning.sh   → run at session start
scripts/wrap.sh      → run before closing the laptop
```

> Optional third script: `scripts/dev.sh` — a project-specific launcher (Docker, backend, simulator, dev server, etc.) that you write once for your stack. The `dev-workflow` skill doesn't generate this because launch flows are too project-specific. Ask Claude to write one for your stack if you want it.

Ludi's project-specific launchers:

```
scripts/launch_ios_simulator.sh  → boot iOS sim + Supabase + run the app
scripts/launch_admin.sh          → boot the Next.js admin app locally
scripts/install_on_device.sh     → build + install on a physical iPhone (--release default, --debug for hot reload)
```

Each is documented inline (`./scripts/<name>.sh --help`).

## Daily rhythm

### 1. Morning — orientation (60 seconds)

```bash
./scripts/morning.sh
```

What it shows you:

- **Today's date** (so you don't lose track of what bucket to start)
- **Latest refs fetched** from all remotes
- **Where you are**: current branch + any dirty files
- **Your open PRs** with review status (via `gh`)
- **Local branches with unmerged commits** vs the default branch
- **Memory index** — every saved Claude Code memory file with its 1-line description
- **Today's bucket** — pulled automatically from the active week plan in memory (if one exists)

Run this *before* you open the codebase. It saves the "wait, what was I doing?" first 20 minutes that most sessions burn on context-rebuilding.

### 2. Wrap — leak detection (30 seconds)

```bash
./scripts/wrap.sh
```

Pure read-only. Tells you what's loose:

- **Uncommitted changes** — files you forgot to commit
- **Local commits not on any remote** — work that won't survive a disk wipe
- **What you actually shipped today** — your real output, not vibes (`git log --since=today --author=you`)
- **Open PRs** with review + CI status
- **Memory check** — three honest questions for next-session-you:
  1. Any decision you made today that's NOT obvious from the diff?
  2. Any blocker or open question to surface before tomorrow?
  3. Did your understanding of the project shift today?

If yes to any of those three, ask Claude to update memory before you close the session. Auto-memory persists notes across sessions — but only if you actually write them.

## Memory system

Claude Code's auto-memory feature stores files at:

```
~/.claude/projects/-<dashed-encoded-repo-path>/memory/
```

Indexed by `MEMORY.md`. Each memory file has frontmatter (`name`, `description`, `type`) and a body. Types:

- **`project`** — facts about the codebase, ongoing work, audit results, week plans
- **`feedback`** — guidance the user has given, reasons for decisions
- **`reference`** — pointers to external systems (Linear, Slack, dashboards)
- **`user`** — user role, preferences, expertise

`morning.sh` prints the index at session start. Anything load-bearing for tomorrow's session belongs in memory.

## Pull request template

`.github/pull_request_template.md` is intentionally slim:

```markdown
## Summary
- 1-3 bullets, lead with the *why*

## Test plan
- [ ] checklist

## Deferred (intentionally out of scope)
- things you noticed but decided not to fix here
```

The "Deferred" section is the most valuable — it tells reviewers *yes, I saw that, no, not in this PR*, so they don't ask. Delete the section if nothing was deferred.

## Mid-session habits

When scope creep tries to pull you sideways ("oh I should also fix..."), don't follow it. File the follow-up so you can come back later:

- **Use `mcp__ccd_session__spawn_task`** for narrow, well-scoped bugs you'd otherwise mention as a "by the way". The user gets a chip, can spin off the fix into its own session with one click.
- **Update memory** for bigger initiatives (parking-lot items, planning needed). They surface in the next planning conversation.

This keeps the current PR tight while not losing the observation.

## Replication

These rituals were installed by the `dev-workflow` Claude Code skill (`~/.claude/skills/dev-workflow/`). To replicate on another repo, ask Claude *"set up dev workflow rituals"* and it installs the same files there.
