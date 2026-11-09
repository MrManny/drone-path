# Issues

## Templates

Two templates live in `.github/ISSUE_TEMPLATE/`:

- `bug-report.md` - what happened / what should have happened / steps to reproduce / additional context
- `feature-request.md` - problem first (GIVEN/WHEN/THEN is offered as structure), proposed solution, acceptance sketch

Fill in every section they contain; if one does not apply, write `N/A` instead of deleting it. Extra reader context goes under the last section ("Additional context") or the template's closing comment slot.

## Labels

Current taxonomy on the repository:

| Label | When to use |
| --- | --- |
| `bug` | Applied automatically by `bug-report.md` |
| `epic` | Should only be applied for umbrella work |
| `enhancement` | Applied automatically by `feature-request.md` |
| `documentation` | Doc-only work (README, AGENTS.md, templates) |
| `maintenance` | Chores, refactors, and code hygiene; no user-visible behavior change |
| `accessibility` | Whenever the report concerns accessibility |
| `question` | More of a question than a defect or feature |
| `duplicate` | After pointing at the original |
| `wontfix` | Maintainer decision only |
| `dependencies` | Automated dependency PRs |
| `javascript` | Companion label for JS dependency bumps |

Notes:

- `dependencies` / `javascript` belong to automated dependency PRs (see `.github/dependabot.yml`, monthly npm and github-actions updates); do not hand them out to other PRs.
- `duplicate` and `wontfix` resolve an issue: apply them only together with a comment pointing at the original / briefly explaining the decision.

## Planning

Planning happens in a GitHub Project, not in milestones; newly filed issues are added to it automatically.

- Project commands need extra OAuth scopes: `gh auth refresh -s read:project` to read, add `write:project` to add or edit items.

Project management belongs to the humans. Don't change anything in the project unless explicitly asked to by a human.

## Epics and issue relationships

Large features get an umbrella issue (epic) plus sub-issues for independently
shippable slices; the first sub-issue is the smallest increment that is runnable
and useful. Keep the epic body lean (problem, decision summary, acceptance
sketch) and let GitHub render sub-issues below it — don't list them in the body.

- Structural sub-issues (not body checklists):
  `gh api -X POST repos/<owner>/<repo>/issues/<parent-number>/sub_issues -F sub_issue_id=<int-id>`;
  get the integer id from `gh api repos/<owner>/<repo>/issues/<n> --jq .id`.
  Use `-F` (typed integer) for id fields — `-f` sends a string and gets a 422.
- Dependencies (sidebar "Relationships"): "X blocked by Y" =
  `gh api -X POST repos/<owner>/<repo>/issues/<X>/dependencies/blocked_by -F issue_id=<Y-int-id>`,
  "X relates to Y" likewise with `.../relates_to`. There is no REST "blocking"
  add endpoint — set it from the blocked side.
- GraphQL alternative: `addBlockedBy`/`addRelatesTo` mutations with node ids.

## Refining an existing issue

Discuss the wording first, then apply it with `gh issue edit <n> --body-file <file>`.
