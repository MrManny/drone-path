# Issues

## Templates

Two templates live in `.github/ISSUE_TEMPLATE/`:

- `bug-report.md` - what happened / what should have happened / steps to reproduce / additional context
- `feature-request.md` - problem first (GIVEN/WHEN/THEN is offered as structure), proposed solution, acceptance sketch

Fill in every section they contain; if one does not apply, write `N/A` instead of deleting it. Extra reader context goes under the last section ("Additional context") or the template's closing comment slot.

To refine an existing issue, discuss the wording first, then apply it with `gh issue edit <n> --body-file <file>`.

## Labels

Current taxonomy on the repository:

| Label | When to use |
| --- | --- |
| `bug` | Applied automatically by `bug-report.md` |
| `epic` | Should only be applied for umbrella work |
| `enhancement` | Applied automatically by `feature-request.md` |
| `documentation` | Doc-only work (README, AGENTS.md, templates) |
| `maintenance` | Chores, refactors, and code hygiene; no user-visible behavior change |
| `duplicate` | Resolves the issue; apply only with a comment pointing at the original |
| `wontfix` | Maintainer decision only; apply only with a comment explaining the decision |
| `dependencies` | Automated dependency PRs only (`.github/dependabot.yml`, weekly npm and github-actions); never handed out otherwise |
| `javascript` | Companion label for JS dependency bumps (same rule as `dependencies`) |

`accessibility` and `question` need no rules beyond their names.

## Planning

Planning happens in a GitHub Project, not in milestones; newly filed issues are added to it automatically.

- Project commands need extra OAuth scopes: `gh auth refresh -s read:project` to read, add `write:project` to add or edit items.

Project management belongs to the humans. Don't change anything in the project unless explicitly asked to by a human.

## Epics and issue relationships

Large features get an umbrella issue (epic) plus sub-issues for independently
shippable slices; the first sub-issue is the smallest increment that is runnable
and useful. Keep the epic body lean (problem, decision summary, acceptance
sketch) and let GitHub render sub-issues below it — don't list them in the body.

- Link sub-issues structurally via the API, not as body checklists.
- Dependencies (sidebar "Relationships") are set from the side the relationship
  names: "X blocked by Y" is added to X — there is no REST "blocking" add
  endpoint. "X relates to Y" works the same way.

The commands, the `-F` id gotcha and the GraphQL alternative live in
[commands.md](commands.md#issue-relationships).
