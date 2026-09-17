# diff-gate

**Prompts tell your agent to write less. diff-gate checks whether it did.**

A Claude skill: a ~250-line, zero-dependency Node script that reads the real `git diff` after your agent finishes and reports:

| Check | Level |
|---|---|
| Imports that don't resolve: invented packages, made-up `@/lib/...` paths, missing files, Python modules that aren't importable | **BLOCK** |
| New dependencies (compares the old and new manifests, so line-ending churn doesn't count) | WARN |
| New top-level helpers whose name already exists elsewhere in the repo | WARN |
| New branching logic with no test touched | WARN |
| Tool-branded comments left in code | WARN |
| Imports pointing into build output, packages used but only installed transitively | INFO |

It adds no tokens to every prompt, pushes nothing into subagents, and never stamps its name into your code.

## Why
Rule-based "lazy dev" skills measurably cut code, but a rule can't check itself. Pushing a model toward minimal code also tempts it to import a function or package that doesn't exist. Invented package names are an attack vector too: an attacker publishes the name and waits for someone to install it. diff-gate checks the code instead of trusting the prompt.

## Install
Copy this folder to `~/.claude/skills/diff-gate/` (or `.claude/skills/diff-gate/` in a project).

Skills don't always trigger on their own. For reliable runs, add one line to your `CLAUDE.md`:

```
Before reporting a coding task done, run the diff-gate skill and fix or justify its findings.
```

Run it by hand any time:
```
node ~/.claude/skills/diff-gate/scripts/check.mjs            # uncommitted + untracked work
node ~/.claude/skills/diff-gate/scripts/check.mjs main       # whole branch
```
Exit code: `1` if there are BLOCK findings, `0` otherwise, `2` for a bad ref or not a git repo.

## Tested on real code
- **Two production TypeScript repos (~54k added lines, Next.js + NestJS monorepo):** 0 false BLOCKs, and all path aliases resolved via tsconfig.
- **Real duplication it found:** a TOTP helper, a cookie jar and a member factory copy-pasted into 5 test files instead of shared.
- **Planted fixture:** caught every invented npm package, missing relative file, invented `@/` alias, fake Python module, new dependency and re-implemented helper.

## Limits
- Duplicates are matched by normalized top-level name. The same logic under a different name slips through.
- Python imports are checked against the active interpreter, so run it inside your venv.
- JS/TS and Python only.

## Credit
Inspired by the conversation around [ponytail](https://github.com/DietrichGebert/ponytail) and [andrej-karpathy-skills](https://github.com/multica-ai/andrej-karpathy-skills), whose rules this complements.

MIT
