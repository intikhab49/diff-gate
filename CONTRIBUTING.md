# Contributing

Thanks for looking. This project is small on purpose: one script, no dependencies, no config file.

## Ground rules
- **No runtime dependencies.** `scripts/check.mjs` must keep running on a bare Node ≥18 with nothing installed.
- **A false BLOCK is the worst bug here.** A check that cries wolf on working code gets uninstalled. Warnings can be noisy; BLOCK cannot.
- **Claims in the README must be reproducible from this repo.** If you change behaviour that a number depends on, re-run the thing that produced it.

## Before opening a pull request
1. Run it on this repo: `node scripts/check.mjs HEAD~1` — it should report cleanly.
2. Run it on a real project of yours with working code, diffed against a base a few commits back. **Zero BLOCK findings** is the bar.
3. If you added a check, plant an example that triggers it and confirm it does.

## Adding a language
Each language needs two things: how to find imports in added lines, and how to decide whether one resolves. Look at how JavaScript (`jsResolves`, tsconfig `paths`) and Python (`importlib.util.find_spec` in a batch) are handled, then follow the same shape. Build output, vendored folders and lock files must stay excluded.

## What is out of scope
- Running tests, type-checking or linting. Other tools do that better.
- Rules about how code should be written. That is [ponytail](https://github.com/DietrichGebert/ponytail)'s job, and this is designed to sit next to it.
- Anything that writes markers, tags or tool names into someone's code.

## Reporting a false positive
Open an issue with the finding line, the import or definition it fired on, and the project shape (monorepo, aliases, virtualenv). A false positive is a valid bug report on its own, no reproduction repo required.
