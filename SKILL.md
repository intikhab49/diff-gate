---
name: diff-gate
description: Verify a finished code change before calling it done. Runs a zero-dependency script over the git diff that fails on imports resolving to nothing (hallucinated or slopsquatted packages, invented path aliases, files never created) and warns on new dependencies, helpers that re-implement existing code, and logic added with no test. Use after writing or editing code and before saying a coding task is complete, when reviewing an agent's or PR's diff, when checking whether an import or package is real, or when the user says "check the diff", "diff-gate", "did you invent that import", or "verify your changes". Not for non-code tasks.
license: MIT
---

# diff-gate

Rules tell an agent to write less. This checks whether it did. Run it on the real diff, not on your memory of the change.

## When
Once, after the last edit of a coding task and before you report done. Also on request, against any ref.

Do the work first. This check never replaces the task, and a diff with no changes in it is not a pass, it means the task isn't done. Run the command and report what it printed. Never describe findings you reasoned out instead of running: if you did not run it, say so.

## Run
```
node <this-skill-dir>/scripts/check.mjs [base-ref]
```
- No argument: uncommitted and untracked work vs `HEAD`.
- A branch or PR: pass the merge base, e.g. `main` or `origin/main`.
- Exit 1 means there are BLOCK findings.

## Act on the report
- **BLOCK: import does not resolve.** You invented a module, path or package, or you're using one that isn't installed. Fix the import to something real. Never "fix" it by adding a dependency you haven't verified exists on the registry, because invented package names are a supply-chain attack vector.
- **WARN: new dependency.** Remove it if the stdlib, the platform or an installed dependency covers the need. Otherwise keep it and give one line saying why.
- **WARN: duplicates an existing definition.** Open the existing one. Reuse it, or say in one line why it doesn't fit. A name match isn't proof of a duplicate, so check before you merge them.
- **WARN: untested logic.** Add the smallest runnable check that fails if the logic breaks: one test or an assert. No frameworks you don't already use.
- **WARN: branded comments.** Delete them.
- **INFO:** look, then act only if something is actually wrong.

Re-run after fixing. Then report: the final PASS or remaining findings, and one line per finding you kept on purpose.

## Don't
- Don't paste the whole report to the user when it passes. "diff-gate: pass" is enough.
- Don't refactor code the task didn't touch to satisfy a finding.
- Don't add markers, tags or tool names to code or commits.

## Limits (be honest about them)
- Duplicate detection matches normalized function names only, so the same logic under a different name slips through.
- Path aliases (`@/`, `~/`) aren't resolved and are only listed as INFO.
- Python imports are checked against the active interpreter, so a missing virtualenv shows up as false BLOCKs.
- Supported: JS/TS and Python.
