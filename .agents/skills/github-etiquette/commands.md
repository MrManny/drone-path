# gh CLI cheat sheet

```bash
# issues
gh issue list
gh issue view <n>
gh issue edit <n> --body-file /path/to/body.md

# pull requests
gh pr create --draft --base main --head <branch> --title "<title>" --body-file /path/to/body.md
gh pr edit <n> --body-file /path/to/body.md
gh pr ready <n>          # undraft
gh pr view <n>

# CI on a PR: snapshot vs. wait
gh pr checks <n>                    # one-shot status of all checks
gh pr checks <n> --watch            # block until every check finishes (exit != 0 on failure)
gh pr checks <n> --watch --fail-fast   # stop waiting at the first failed check

# CI as a workflow run (see live job/step progress)
gh run list --branch <branch>          # find the run id for the PR branch
gh run watch <run-id> --exit-status    # stream job/step status until done; non-zero on failure
gh run view <run-id> --log-failed      # fetch failing logs afterwards
```

## Issue relationships

```bash
# structural sub-issues (not body checklists)
gh api repos/<owner>/<repo>/issues/<n> --jq .id   # integer id for -F fields
gh api -X POST repos/<owner>/<repo>/issues/<parent-number>/sub_issues -F sub_issue_id=<int-id>

# dependencies (sidebar "Relationships"); there is no REST "blocking" add
# endpoint — "X blocked by Y" is added to X, the blocked side
gh api -X POST repos/<owner>/<repo>/issues/<X>/dependencies/blocked_by -F issue_id=<Y-int-id>
gh api -X POST repos/<owner>/<repo>/issues/<X>/dependencies/relates_to -F issue_id=<Y-int-id>
```

Use `-F` (typed integer) for id fields — `-f` sends a string and gets a 422. GraphQL alternative: `addBlockedBy`/`addRelatesTo` mutations with node ids.

## Attaching files

`gh issue create/edit/comment` and `gh pr create/edit/comment` accept `--attach PATH` (repeatable) for images and videos: the upload lands as a URL in the body, `#ALT-TEXT` appended to the path sets image alt text, and when the body already references the local file the CLI rewrites that reference in place — so bodies can be written and previewed locally before posting unchanged. Only images and videos attach; it requires push access to the repository ([docs](https://docs.github.com/en/github-cli/github-cli/attaching-files-with-github-cli)).
