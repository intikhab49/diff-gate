<div align="center">

<img src="docs/social-preview.png" alt="diff-gate: verify what your coding agent actually changed" width="720">

# diff-gate

**Your AI agent said "done". diff-gate checks whether it invented anything.**

A Claude Code skill and a GitHub Action that read the real `git diff` after an agent finishes and fail on imports that do not exist.

[![license](https://img.shields.io/badge/license-MIT-111111?style=flat-square)](LICENSE)
[![dependencies](https://img.shields.io/badge/dependencies-0-111111?style=flat-square)](scripts/check.mjs)
[![works with](https://img.shields.io/badge/works%20with-Claude%20Code%20%C2%B7%20Cursor%20%C2%B7%20OpenCode%20%C2%B7%20CI-111111?style=flat-square)](#install)
[![node](https://img.shields.io/badge/node-%E2%89%A518-111111?style=flat-square)](#install)

</div>

---

AI agents hallucinate imports. Sometimes it is a typo, sometimes the package simply does not exist, and sometimes an attacker has already registered the name an LLM likes to invent and is waiting for the install. A prompt cannot tell a real package from an imagined one. A resolver can.

```console
$ node scripts/check.mjs main
## diff-gate vs main
7 file(s) changed, 3 new, +214 / -18 lines

### BLOCK (must fix)
- src/report.ts: import 'pdf-easy-kit' does not resolve (no such file, not a declared dependency, not installed)
- src/lib/totp.ts: import '@/lib/base32' does not resolve (no such file, not a declared dependency, not installed)

### WARN (fix, or justify in one line)
- package.json: new dependencies dayjs@^1.11.0: for each, name what it replaces or why the stdlib or existing deps can't do it
- 'base32Decode' newly defined in src/lib/totp.ts but already exists in tests/support/totp.ts: reuse it or say why not
- 9 branches/loops added across 3 source file(s) and no test file touched: leave one runnable check

$ echo $?
1
```

## What it checks

| Check | Level | Why it exists |
|---|---|---|
| Imports that resolve to nothing: invented packages, made-up `@/...` aliases, missing files, Python modules that are not importable | **BLOCK** | hallucinated imports, typosquatting and slopsquatting exposure |
| New dependencies, by comparing the old and new manifest | WARN | the stdlib or an installed package usually covers it |
| A new top-level helper whose name already exists elsewhere | WARN | agents rewrite helpers they never saw |
| 3+ branches or loops added with no test file touched | WARN | logic shipped with nothing that fails when it breaks |
| Tool-branded comments left in code | WARN | your repo is not an advert |
| Imports into build output, packages installed only transitively, unverified aliases | INFO | context, not a problem |

Exit code `1` on a BLOCK finding, `0` otherwise, `2` for a bad ref or a non-git directory. In CI that fails the build. In an agent session it is a report the agent is told to act on.

## Install

### Claude Code (skill)
Copy this folder to `~/.claude/skills/diff-gate/`, or `.claude/skills/diff-gate/` inside one project.

Skills do not reliably fire on their own ([measured below](#does-it-actually-run)), so add one line to your `CLAUDE.md`:

```
Before reporting a coding task done, run the diff-gate skill and fix or justify its findings.
```

### GitHub Action (CI)
```yaml
- uses: actions/checkout@v4
  with: { fetch-depth: 0 }
- uses: actions/setup-node@v4
  with: { node-version: 22 }
- run: npm ci                       # so imports resolve against what is installed
- uses: intikhab49/diff-gate@v1
  # with:
  #   fail-on: warn                 # block (default) | warn | never
```
The report lands in the job summary. Full example: [`.github/workflows/example-usage.yml`](.github/workflows/example-usage.yml).

### Any other agent, or by hand
The script has no dependencies and no config. Point Cursor, OpenCode, Codex or a git hook at it:

```bash
node path/to/check.mjs          # uncommitted and untracked work
node path/to/check.mjs main     # a whole branch
```

If your agent asks permission to read files outside the project, keep the script inside the repo, for example `.diffgate/check.mjs` listed in `.gitignore`. Some agents stall on that prompt in headless mode.

## Does it actually run?

Measured, not assumed. Six headless Claude Code sessions, Sonnet, one coding task, project settings only, skill installed:

| Setup | Ran the check |
|---|--:|
| Skill installed, nothing else | **0 / 3** |
| Skill installed + the one-line `CLAUDE.md` instruction | **3 / 3** |

A skill sitting in a folder does not fire by itself. Any skill that claims otherwise has not measured it.

## What the benchmark did *not* show

The result that does not flatter this tool, published first, with the harness beside it.

Six dependency-trap tickets (xlsx export, timezone conversion, PDF receipt, JWT auth, rate limiting, helper reuse) against a seeded Express repo, DeepSeek V4 Flash via OpenCode, four arms. 30 of 48 cells completed before the run was stopped.

| arm | usable runs | mean added LOC | new deps | invented imports | duplicated helpers |
|---|--:|--:|--:|--:|--:|
| [ponytail](https://github.com/DietrichGebert/ponytail) | 4 | **21** | 4 | 0 | 0 |
| no rules | 3 | 32 | 2 | 0 | 0 |
| ponytail + diff-gate | 9 | 30 | 3 | 0 | 0 |
| diff-gate | 4 | 62 | 2 | 0 | 0 |

- **No arm invented an import or duplicated a helper.** On a capable model the failure this tool catches did not occur in 20 usable runs. It is insurance, not a daily win.
- **diff-gate's arm wrote the most code.** Acting on its findings adds lines: a test, a real import. If you want less code, that is ponytail's job and its numbers here support it.
- A third of runs ended with the model writing nothing at all. That is the cheap model, it hits every arm equally, and it means only the large gaps are meaningful.

Reproduce it: [`benchmark/seed.sh`](benchmark/seed.sh) builds the repo, [`benchmark/run.sh`](benchmark/run.sh) and [`benchmark/run-combined.sh`](benchmark/run-combined.sh) run the arms, [`benchmark/results.csv`](benchmark/results.csv) is the raw output (`exit=99` marks a run where the agent changed no code).

**Where it did earn its keep:** copy-pasted TOTP, cookie-jar and member-factory helpers across five test files in a real private repo; an invented `@/lib/...` alias import; and two bugs in its own scoring, found by reading raw diffs instead of trusting the summary.

## Limits
- Duplicates are matched by normalized top-level name, so the same logic under a different name slips through.
- Python imports are checked against the active interpreter, so run it inside your virtualenv.
- JavaScript, TypeScript and Python only.
- It reads diffs. It does not run your tests and cannot tell you whether the code is correct.

## Credit
Built alongside the conversation around [ponytail](https://github.com/DietrichGebert/ponytail) (MIT) and [andrej-karpathy-skills](https://github.com/multica-ai/andrej-karpathy-skills). Those shape what an agent writes. This one checks what it wrote. Use both.

## Contributing
Issues and pull requests welcome, especially new language support. See [CONTRIBUTING.md](CONTRIBUTING.md). Every claim in this README is reproducible from the repo, and a pull request that disproves one is a good pull request.

MIT © Intikhab Azam
