---
name: diff-gate
description: Run after finishing a code change, before saying it is done, or when asked to check a diff, a PR or whether an import or package is real. Fails on imports and packages that do not exist or look squatted; warns on new deps and duplicate helpers. Not for non-code tasks.
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
- New dependencies are looked up on npm/PyPI. Add `--offline` to skip the network.
- Exit 1 means there are BLOCK findings.

## Act on the report
- **BLOCK: import does not resolve.** You invented a module, path or package, or you're using one that isn't installed. Fix the import to something real. Never "fix" it by adding a dependency you haven't verified exists on the registry, because invented package names are a supply-chain attack vector.
- **BLOCK: package does not exist on npm/PyPI, or looks squatted** (brand new, almost no downloads, and an install script or a name one typo from a popular package). Remove it and use the real package, or none. Don't install it to check.
- **WARN: new dependency.** Remove it if the stdlib, the platform or an installed dependency covers the need. Otherwise keep it and give one line saying why.
- **WARN: duplicates an existing definition.** Open the existing one. Reuse it, or say in one line why it doesn't fit. A name match isn't proof of a duplicate, so check before you merge them.
- **WARN: obscure or lookalike package** (low downloads, first published recently, or one typo from a popular name). Confirm it is the package you meant, in one line.
- **WARN: branded comments.** Delete them.
- **INFO:** context only (untested logic, install scripts, skipped lookups). Don't write extra code for it.

Re-run after fixing. Then report: the final PASS or remaining findings, and one line per finding you kept on purpose.

## Don't
- Don't paste the whole report to the user when it passes. "diff-gate: pass" is enough.
- Don't refactor code the task didn't touch to satisfy a finding.
- Don't add markers, tags or tool names to code or commits.

## Limits (be honest about them)
- Duplicate detection matches normalized function names only, so the same logic under a different name slips through.
- Path aliases (`@/`, `~/`) are checked against tsconfig/jsconfig `paths`; with no `paths` entry they are only listed as INFO.
- The registry check reads metadata (existence, age, downloads, install scripts). It does not read package code, so an old, popular package that turns malicious passes.
- Python imports are checked against the active interpreter, so a missing virtualenv shows up as false BLOCKs.
- Supported: JS/TS and Python.
