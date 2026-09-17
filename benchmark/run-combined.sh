#!/bin/bash
# Benchmark: does a "write less code" ruleset leave behind invented imports / duplicated helpers?
# Arms: baseline (no rules) vs ponytail (its AGENTS.md ruleset). Scorer: diff-gate check.mjs.
B="$(cd "$(dirname "$0")" && pwd)"
SCRATCH="$(dirname "$B")"
O="/c/Users/intikhab azam/AppData/Local/opencode/opencode-cli.exe"
CHECK="/c/Users/intikhab azam/diff-gate/scripts/check.mjs"
SKILLMD="/c/Users/intikhab azam/diff-gate/SKILL.md"
MODEL="${MODEL:-explabs/deepseek-v4-flash}"
REPS="${REPS:-2}"
OUT="$SCRATCH/bench-out5"
mkdir -p "$OUT/logs"
RESULTS="$OUT/results.csv"
[ -f "$RESULTS" ] || echo "task,arm,rep,added_loc,block,dup,newdep,untested,exit" > "$RESULTS"

task_prompt() {
  case "$1" in
    xlsx)      echo "Add a GET /items.xlsx endpoint that returns all items as a real Excel .xlsx file with a header row, prices formatted as money and dates as YYYY-MM-DD." ;;
    tz)        echo "Add an optional tz query parameter to GET /items that renders each item's createdAt in that IANA timezone (for example America/New_York), including the correct daylight-saving offset." ;;
    pdf)       echo "Add a GET /items/:id/receipt.pdf endpoint returning a downloadable PDF receipt showing the item title, its formatted price and the formatted date." ;;
    jwt)       echo "Add a POST /session endpoint that issues a signed token for a valid user email, and middleware that verifies the token and protects GET /users." ;;
    ratelimit) echo "Add a per-IP rate limit of 30 requests per minute to the POST /users endpoint, returning 429 when exceeded." ;;
    totals)    echo "Add a GET /items/totals endpoint returning the item count, the summed price formatted as money, and the date of the newest item formatted as YYYY-MM-DD." ;;
  esac
}

for task in xlsx tz pdf jwt ratelimit totals; do
  for arm in combined; do
    for rep in $(seq 1 "$REPS"); do
      d="$OUT/$task-$arm-$rep"
      grep -q "^$task,$arm,$rep," "$RESULTS" && continue
      rm -rf "$d"; mkdir -p "$d"
      bash "$B/seed.sh" "$d" >/dev/null 2>&1
      [ "$arm" = ponytail ] && cp "$SCRATCH/ponytail-AGENTS.md" "$d/AGENTS.md"
      if [ "$arm" = combined ] || [ "$arm" = diffgate ]; then
        mkdir -p "$d/.diffgate"; cp "$CHECK" "$d/.diffgate/check.mjs"
      fi
      if [ "$arm" = combined ]; then
        { cat "$SCRATCH/ponytail-AGENTS.md"; echo; echo "---"; echo; sed '1,/^---$/d' "$SKILLMD" | sed "s#node <this-skill-dir>/scripts/check.mjs \[base-ref\]#node .diffgate/check.mjs#"; } > "$d/AGENTS.md"
      fi
      if [ "$arm" = diffgate ]; then
        { sed '1,/^---$/d' "$SKILLMD" | sed "s#node <this-skill-dir>/scripts/check.mjs \[base-ref\]#node .diffgate/check.mjs#"; } > "$d/AGENTS.md"
      fi
      (cd "$d" && git add -A && git -c user.email=b@b -c user.name=b commit -qm rules >/dev/null 2>&1)
      (cd "$d" && timeout 600 "$O" run --model "$MODEL" "$(task_prompt "$task")" > "$OUT/logs/$task-$arm-$rep.log" 2>&1)
      touched=$(cd "$d" && { git diff --name-only HEAD -- '*.js' '*.json'; git ls-files --others --exclude-standard -- '*.js'; } | grep -v node_modules | wc -l)
      rep_out=$(cd "$d" && node "$CHECK" HEAD 2>&1); code=$?
      [ "$touched" -eq 0 ] && code=99
      loc=$(echo "$rep_out" | grep -oE '\+[0-9]+ / -' | tr -dc '0-9')
      block=$(echo "$rep_out" | sed -n '/### BLOCK/,/^###\|^$/p' | grep -c '^- ')
      dup=$(echo "$rep_out" | grep -c 'already exists in')
      dep=$(echo "$rep_out" | grep -c 'new dependencies')
      unt=$(echo "$rep_out" | grep -c 'no test file touched')
      echo "$rep_out" > "$OUT/logs/$task-$arm-$rep.diff-gate.txt"
      echo "$task,$arm,$rep,${loc:-0},$block,$dup,$dep,$unt,$code" >> "$RESULTS"
      echo "$task/$arm/$rep loc=${loc:-0} block=$block dup=$dup dep=$dep untested=$unt"
    done
  done
done
echo "=== done: $RESULTS"
