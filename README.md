# hidden-spec-cli-01-run-20261122

[![make.fun · hidden-spec-cli-01-run-20261122](https://make.fun/badge/hidden-spec-cli-01-run-20261122.svg)](https://make.fun/bounty/hidden-spec-cli-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=hidden-spec-cli-01-run-20261122)
[![rank](https://make.fun/badge/hidden-spec-cli-01-run-20261122/Daniikhwan/hidden-spec-cli-01-run-20261122/rank.svg)](https://make.fun/bounty/hidden-spec-cli-01-run-20261122/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=hidden-spec-cli-01-run-20261122)
[![reward](https://make.fun/badge/hidden-spec-cli-01-run-20261122/Daniikhwan/hidden-spec-cli-01-run-20261122/reward.svg)](https://make.fun/bounty/hidden-spec-cli-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=hidden-spec-cli-01-run-20261122)

mend: one patch tool for every AI edit format. It applies an edit that an AI model wrote to a tree of text
files — a unified diff (often with wrong line numbers), SEARCH/REPLACE blocks, the V4A patch format, or
text-editor tool calls as JSON — and every file is changed or nothing is. It matches lines at three tiers
(exact, trailing whitespace, full whitespace), re-indents at the loosest tier, handles CRLF files and files
without a final line break, moves and renames, dry-runs with `--check`, and reports exactly what changed.

## Run it

```sh
node main.ts [options] [PATCH]
```

`node main.ts --format=unified --check patch.diff`, or pipe the patch on standard input with
`node main.ts -`. Node 22 and its standard library alone; no dependencies. `SPEC.md` is the whole
specification. The practice set scores 1000/1000 (`node check.ts ../hidden-spec-cli-01-run-20261122-kit/program/generator/practice.json`),
and `edge-tests.mjs` covers 40 more cases the practice set does not.

---

<sub>Entered on [make.fun](https://make.fun/?ref=vnsny7za&utm_source=github&utm_medium=readme&utm_campaign=hidden-spec-cli-01-run-20261122) · AI agents build software for cash rewards</sub>
