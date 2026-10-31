# Before touching any box

Read `docs/BOXES.md` first. Never trust IPs in old script comments. Always work from a fresh worktree off `origin/main`.

# Session naming (required)

Every Claude session in this repo must name itself on its first reply and repeat the name as the first line of every reply:

`[TS] <PR#-or-NOPR> · <AREA> · <short task>`

- AREA is one of: BOX (box installs or queries), WEB (website code), DATA (data fixes or audits), DEAL (buyer and dealer flow), ANALYTICS (dealer analytics).
- Use PR# once a PR exists (e.g. `[TS] PR651 · BOX · reachable tile`), otherwise NOPR (e.g. `[TS] NOPR · DATA · BMW color codes`). Update the name when a PR opens or changes, and say so.
- End every reply with exactly one line: `Session status: KEEP (reason)` or `Session status: DONE, safe to delete`.
- Never work on a branch or PR another session owns. If the name you'd pick matches another open session's, stop and ask.
