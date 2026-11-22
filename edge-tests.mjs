// Adversarial edge cases for mend, beyond the practice set. Run with node 22:
//   node edge-tests.mjs
// Uses the kit's runner (runCheck) to run main.ts on each case.
import { runCheck } from './runner.ts';

let pass = 0;
let fail = 0;
function t(name, check, expect) {
  const got = runCheck(check);
  const wantFiles = { ...check.files };
  for (const [p, v] of Object.entries(expect.changes)) {
    if (v === null) delete wantFiles[p];
    else wantFiles[p] = v;
  }
  const why = [];
  if (got.exit !== expect.exit) why.push(`exit ${got.exit} != ${expect.exit}`);
  if (got.stdout !== expect.stdout) why.push(`stdout ${JSON.stringify(got.stdout)} != ${JSON.stringify(expect.stdout)}`);
  for (const p of new Set([...Object.keys(wantFiles), ...Object.keys(got.files)])) {
    if (wantFiles[p] === undefined) why.push(`${p} should not exist`);
    else if (got.files[p] === undefined) why.push(`${p} missing`);
    else if (got.files[p] !== wantFiles[p]) why.push(`${p}: got ${JSON.stringify(got.files[p])} want ${JSON.stringify(wantFiles[p])}`);
  }
  if (why.length === 0) {
    pass++;
  } else {
    fail++;
    console.log(`FAIL ${name}\n  ${why.join('\n  ')}`);
  }
}

// 1. Unified: \ after a `-` line only (old file had no EOL); new file ends WITH a break.
t('u-bs-after-minus', { id: '1', argv: ['-'], stdin: '--- a/x.txt\n+++ b/x.txt\n@@ -1,2 +1,2 @@\n ctx\n-old\n\\ No newline at end of file\n+new\n', files: { 'x.txt': 'ctx\nold' } },
  { exit: 0, stdout: 'M x.txt\nok: 1 file\n', changes: { 'x.txt': 'ctx\nnew\n' } });

// 2. Unified: delete the last line of a file with no EOL; hunk ends with `-` + `\`.
t('u-bs-delete-last', { id: '2', argv: ['-'], stdin: '--- a/x.txt\n+++ b/x.txt\n@@ -1,2 +1,1 @@\n ctx\n-last\n\\ No newline at end of file\n', files: { 'x.txt': 'ctx\nlast' } },
  { exit: 0, stdout: 'M x.txt\nok: 1 file\n', changes: { 'x.txt': 'ctx\n' } });

// 3. Unified: `--- ` not followed by `+++ ` inside a header -> parse at the line after it.
t('u-header-dash', { id: '3', argv: ['-'], stdin: 'diff --git a/x b/x\n--- a/x\nindex abc\n@@ -1,1 +1,1 @@\n-a\n+b\n', files: { x: 'a\n' } },
  { exit: 2, stdout: 'error: parse 3\n', changes: {} });

// 4. Unified: malformed @@ line -> parse at its line.
t('u-bad-hunk', { id: '4', argv: ['-'], stdin: '--- a/x\n+++ b/x\n@@ -1 @@\n-a\n+b\n', files: { x: 'a\n' } },
  { exit: 2, stdout: 'error: parse 3\n', changes: {} });

// 5. Unified: hunk before any section -> parse at its line (with --format=unified).
t('u-hunk-first', { id: '5', argv: ['--format=unified', '-'], stdin: '@@ -1,1 +1,1 @@\n-a\n+b\n', files: { x: 'a\n' } },
  { exit: 2, stdout: 'error: parse 1\n', changes: {} });

// 6. Unified: malformed diff --git line -> parse at its line.
t('u-bad-diffgit', { id: '6', argv: ['-'], stdin: 'diff --git a/x\n--- a/x\n+++ b/x\n@@ -1,1 +1,1 @@\n-a\n+b\n', files: { x: 'a\n' } },
  { exit: 2, stdout: 'error: parse 1\n', changes: {} });

// 7. Unified: creation where the file exists -> exists.
t('u-create-exists', { id: '7', argv: ['-'], stdin: '--- /dev/null\n+++ b/x\n@@ -0,0 +1 @@\n+hi\n', files: { x: 'old\n' } },
  { exit: 1, stdout: 'error: exists x\nfailed: 1 of 1 edits\n', changes: {} });

// 8. Unified: move to an existing path -> exists.
t('u-move-exists', { id: '8', argv: ['-'], stdin: '--- a/x\n+++ b/y\n@@ -1,1 +1,1 @@\n-a\n+b\n', files: { x: 'a\n', y: 'y\n' } },
  { exit: 1, stdout: 'error: exists y\nfailed: 1 of 1 edits\n', changes: {} });

// 9. Unified: empty-O insertion at end with \ after last + -> no final break.
t('u-insert-eof-noeol', { id: '9', argv: ['-'], stdin: '--- a/x\n+++ b/x\n@@ -2,0 +3,1 @@\n+last\n\\ No newline at end of file\n', files: { x: 'a\nb\n' } },
  { exit: 0, stdout: 'M x\nok: 1 file\n', changes: { x: 'a\nb\nlast' } });

// 10. Unified: empty-O insertion in the middle.
t('u-insert-mid', { id: '10', argv: ['-'], stdin: '--- a/x\n+++ b/x\n@@ -1,0 +2,1 @@\n+mid\n', files: { x: 'a\nb\n' } },
  { exit: 0, stdout: 'M x\nok: 1 file\n', changes: { x: 'a\nmid\nb\n' } });

// 11. Unified: nearest-position tie -> earlier occurrence.
t('u-nearest-tie', { id: '11', argv: ['-'], stdin: '--- a/x\n+++ b/x\n@@ -2,1 +2,1 @@\n-a\n+b\n', files: { x: 'a\na\na\n' } },
  { exit: 0, stdout: 'M x\nok: 1 file\n', changes: { x: 'a\nb\na\n' } });

// 12. SEARCH/REPLACE: first block with no path -> parse at SEARCH line.
t('s-no-path', { id: '12', argv: ['-'], stdin: '<<<<<<< SEARCH\na\n=======\nb\n>>>>>>> REPLACE\n', files: {} },
  { exit: 2, stdout: 'error: parse 1\n', changes: {} });

// 13. SEARCH/REPLACE: second block inherits the previous block's path.
t('s-inherit-path', { id: '13', argv: ['-'], stdin: 'x.txt\n<<<<<<< SEARCH\na\n=======\nb\n>>>>>>> REPLACE\n<<<<<<< SEARCH\nb\n=======\nc\n>>>>>>> REPLACE\n', files: { 'x.txt': 'a\n' } },
  { exit: 0, stdout: 'M x.txt\nok: 1 file\n', changes: { 'x.txt': 'c\n' } });

// 14. SEARCH/REPLACE: unsafe path.
t('s-unsafe', { id: '14', argv: ['-'], stdin: '../x.txt\n<<<<<<< SEARCH\na\n=======\nb\n>>>>>>> REPLACE\n', files: {} },
  { exit: 1, stdout: 'error: unsafe ../x.txt\nfailed: 1 of 1 edits\n', changes: {} });

// 15. V4A: missing Begin Patch -> parse at first non-blank line (with --format=v4a).
t('v-no-begin', { id: '15', argv: ['--format=v4a', '-'], stdin: '*** Update File: x\n@@\n a\n-b\n+c\n*** End Patch\n', files: { x: 'a\nb\n' } },
  { exit: 2, stdout: 'error: parse 1\n', changes: {} });

// 16. V4A: `*** End of File` with no chunk -> parse at its line.
t('v-eof-no-chunk', { id: '16', argv: ['-'], stdin: '*** Begin Patch\n*** Update File: x\n*** End of File\n*** End Patch\n', files: { x: 'a\n' } },
  { exit: 2, stdout: 'error: parse 3\n', changes: {} });

// 17. V4A: body line after `*** End of File` -> parse at its line.
t('v-body-after-eof', { id: '17', argv: ['-'], stdin: '*** Begin Patch\n*** Update File: x\n@@\n a\n*** End of File\n b\n*** End Patch\n', files: { x: 'a\nb\n' } },
  { exit: 2, stdout: 'error: parse 6\n', changes: {} });

// 18. V4A: Move to with no chunks -> pure move.
t('v-move-only', { id: '18', argv: ['-'], stdin: '*** Begin Patch\n*** Update File: x\n*** Move to: y\n*** End Patch\n', files: { x: 'a\nb\n' } },
  { exit: 0, stdout: 'R x -> y\nok: 1 file\n', changes: { x: null, y: 'a\nb\n' } });

// 19. V4A: eof chunk where O occurs in the middle AND at the end -> takes the end one.
t('v-eof-repeat', { id: '19', argv: ['-'], stdin: '*** Begin Patch\n*** Update File: x\n@@\n a\n-b\n+c\n*** End of File\n*** End Patch\n', files: { x: 'a\nb\na\nb\n' } },
  { exit: 0, stdout: 'M x\nok: 1 file\n', changes: { x: 'a\nb\na\nc\n' } });

// 20. V4A: Add file with trailing blank lines dropped.
t('v-add-trailing-blank', { id: '20', argv: ['-'], stdin: '*** Begin Patch\n*** Add File: x\n+one\n+two\n\n\n*** End Patch\n', files: {} },
  { exit: 0, stdout: 'A x\nok: 1 file\n', changes: { x: 'one\ntwo\n' } });

// 21. JSON: array form with a bad element -> parse at the array's start line.
t('j-array-bad', { id: '21', argv: ['-'], stdin: '\n[{"command":"create","path":"x","file_text":"a"},{"command":"nope","path":"y"}]\n', files: {} },
  { exit: 2, stdout: 'error: parse 2\n', changes: {} });

// 22. CLI: --format given twice -> usage.
t('c-format-twice', { id: '22', argv: ['--format=json', '--format=v4a', '-'], stdin: '[]', files: {} },
  { exit: 2, stdout: 'error: usage\n', changes: {} });

// 23. CLI: unknown option -> usage (wins over a missing patch file).
t('c-usage-wins', { id: '23', argv: ['--bogus', 'nope.patch'], stdin: null, files: {} },
  { exit: 2, stdout: 'error: usage\n', changes: {} });

// 24. CLI: missing patch file -> no-patch.
t('c-no-patch', { id: '24', argv: ['missing.patch'], stdin: null, files: {} },
  { exit: 2, stdout: 'error: no-patch\n', changes: {} });

// 25. CLI: `--` ends options; a patch file named like an option after `--` is positional.
t('c-dashdash', { id: '25', argv: ['--', '-'], stdin: '[{"command":"create","path":"x","file_text":"a"}]', files: {} },
  { exit: 0, stdout: 'A x\nok: 1 file\n', changes: { x: 'a' } });

// 26. CRLF file with SEARCH/REPLACE: final break preserved, CRLF preserved.
t('s-crlf', { id: '26', argv: ['-'], stdin: 'x\n<<<<<<< SEARCH\na\r\n=======\nb\r\n>>>>>>> REPLACE\n', files: { x: 'a\r\nc\r\n' } },
  { exit: 0, stdout: 'M x\nok: 1 file\n', changes: { x: 'b\r\nc\r\n' } });

// 27. Delete every line of a file -> empty file.
t('u-delete-all', { id: '27', argv: ['-'], stdin: '--- a/x\n+++ b/x\n@@ -1,2 +1,0 @@\n-a\n-b\n', files: { x: 'a\nb\n' } },
  { exit: 0, stdout: 'M x\nok: 1 file\n', changes: { x: '' } });

// 28. Multiple failures reported in patch order.
t('multi-fail', { id: '28', argv: ['-'], stdin: 'a\n<<<<<<< SEARCH\nzzz\n=======\nb\n>>>>>>> REPLACE\nb\n<<<<<<< SEARCH\nyyy\n=======\nc\n>>>>>>> REPLACE\n', files: { a: 'a\n' } },
  { exit: 1, stdout: 'error: no-match a\nerror: missing b\nfailed: 2 of 2 edits\n', changes: {} });

// 29. --check with success: same output, no writes.
t('c-check-ok', { id: '29', argv: ['--check', '-'], stdin: 'x\n<<<<<<< SEARCH\na\n=======\nb\n>>>>>>> REPLACE\n', files: { x: 'a\n' } },
  { exit: 0, stdout: 'M x\nok: 1 file\n', changes: {} });

// 30. R line sorts by new path among other rows.
t('sort-r', { id: '30', argv: ['-'], stdin: '--- a/m\n+++ b/a\n@@ -1,1 +1,1 @@\n-x\n+y\n--- a/z\n+++ b/z\n@@ -1,1 +1,1 @@\n-p\n+q\n', files: { m: 'x\n', z: 'p\n' } },
  { exit: 0, stdout: 'R m -> a\nM z\nok: 2 files\n', changes: { m: null, a: 'y\n', z: 'q\n' } });

// 31. Tier-2 re-indent when O's first line has no indent but the file's does.
t('tier2-empty-p', { id: '31', argv: ['-'], stdin: '--- a/x\n+++ b/x\n@@ -1,2 +1,2 @@\n foo\n-bar\n+  bar\n+baz\n', files: { x: '  foo\n  bar\n' } },
  { exit: 0, stdout: 'M x\nok: 1 file\n', changes: { x: '  foo\n    bar\n  baz\n' } });

// 32. V4A anchor matched at tier 1 (trailing space).
t('v-anchor-tier1', { id: '32', argv: ['-'], stdin: '*** Begin Patch\n*** Update File: x\n@@ def f(): \n a\n-b\n+c\n*** End Patch\n', files: { x: 'def f():\na\nb\n' } },
  { exit: 0, stdout: 'M x\nok: 1 file\n', changes: { x: 'def f():\na\nc\n' } });

// 33. Unified: creation with no hunks -> empty file.
t('u-create-nohunks', { id: '33', argv: ['-'], stdin: '--- /dev/null\n+++ b/x\n', files: {} },
  { exit: 0, stdout: 'A x\nok: 1 file\n', changes: { x: '' } });

// 34. Unified: a section with no hunks for a missing file -> missing.
t('u-nohunks-missing', { id: '34', argv: ['-'], stdin: '--- a/x\n+++ b/x\n', files: {} },
  { exit: 1, stdout: 'error: missing x\nfailed: 1 of 1 edits\n', changes: {} });

// 35. JSON create writes file_text byte for byte (no trailing break added).
t('j-create-bytes', { id: '35', argv: ['-'], stdin: '[{"command":"create","path":"x","file_text":"a\\nb"}]', files: {} },
  { exit: 0, stdout: 'A x\nok: 1 file\n', changes: { x: 'a\nb' } });

// 36. --strict with unified: tier-1-only difference fails.
t('strict-u', { id: '36', argv: ['--strict', '-'], stdin: '--- a/x\n+++ b/x\n@@ -1,1 +1,1 @@\n-a \n+b\n', files: { x: 'a\n' } },
  { exit: 1, stdout: 'error: no-match x\nfailed: 1 of 1 edits\n', changes: {} });

// 37. A patch that changes nothing prints ok: 0 files.
t('noop-unified', { id: '37', argv: ['-'], stdin: '--- a/x\n+++ b/x\n@@ -1,1 +1,1 @@\n a\n', files: { x: 'a\n' } },
  { exit: 0, stdout: 'ok: 0 files\n', changes: {} });

// 38. V4A: Add file where the path exists -> exists; Delete where missing -> missing (both reported).
t('v-add-del-fail', { id: '38', argv: ['-'], stdin: '*** Begin Patch\n*** Add File: x\n+hi\n*** Delete File: y\n*** End Patch\n', files: { x: 'old\n' } },
  { exit: 1, stdout: 'error: exists x\nerror: missing y\nfailed: 2 of 2 edits\n', changes: {} });

// 39. Unified: `--- ` line inside a hunk body that is NOT followed by `+++ ` is an old line.
t('u-dash-in-body', { id: '39', argv: ['-'], stdin: '--- a/x\n+++ b/x\n@@ -1,2 +1,1 @@\n a\n--- foo\n', files: { x: 'a\n-- foo\n' } },
  { exit: 0, stdout: 'M x\nok: 1 file\n', changes: { x: 'a\n' } });

// 40. JSON str_replace on a CRLF file converts breaks back to CRLF.
t('j-crlf-2', { id: '40', argv: ['-'], stdin: '[{"command":"str_replace","path":"x","old_str":"a\\nb","new_str":"a\\nc"}]', files: { x: 'a\r\nb\r\n' } },
  { exit: 0, stdout: 'M x\nok: 1 file\n', changes: { x: 'a\r\nc\r\n' } });

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
