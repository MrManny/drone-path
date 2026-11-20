import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { setIssueStatus } from '../scripts/lib/project.mjs';

const execOrThrow = vi.hoisted(() => vi.fn<(command: string, args: string[]) => string>());
vi.mock('../scripts/lib/exec.mjs', () => ({ execOrThrow }));

const repo = { nameWithOwner: 'owner/drone-path', owner: { login: 'owner' } };
const project = { id: 'project-first', number: 1 };

function queueOutput(...responses: unknown[]): void {
  for (const response of responses) execOrThrow.mockReturnValueOnce(JSON.stringify(response));
}

function item(id: string, nameWithOwner: string, number = 42) {
  return { id, content: { __typename: 'Issue', number, repository: { nameWithOwner } } };
}

function page(nodes: unknown[], endCursor: string | null = null) {
  return { data: { node: { items: { nodes, pageInfo: { hasNextPage: endCursor !== null, endCursor } } } } };
}

beforeEach(() => {
  execOrThrow.mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
});

it('updates only the matching issue from the current repo, even on a later page', () => {
  queueOutput(
    repo,
    { projects: [project] },
    page([
      item('foreign-issue', 'owner/other'),
      { id: 'pull-request', content: { __typename: 'PullRequest' } },
      item('different-number', repo.nameWithOwner, 43),
    ], 'page-two'),
    page([item('right-issue', repo.nameWithOwner)]),
    { fields: [{ id: 'status-field', name: 'Status', options: [{ id: 'option', name: 'In review' }] }] },
  );

  expect(setIssueStatus('42', 'In review')).toBe(true);
  const calls = execOrThrow.mock.calls;
  const queryArg = calls[2][1][3];
  expect(queryArg).toContain('__typename');
  expect(queryArg).toContain('... on Issue { number repository { nameWithOwner } }');
  expect(queryArg).not.toContain('... on PullRequest');
  expect(calls).toEqual([
    ['gh', ['repo', 'view', '--json', 'nameWithOwner,owner']],
    ['gh', ['project', 'list', '--owner', 'owner', '--format', 'json']],
    ['gh', ['api', 'graphql', '-f', queryArg, '-f', 'id=project-first']],
    ['gh', ['api', 'graphql', '-f', queryArg, '-f', 'id=project-first', '-f', 'endCursor=page-two']],
    ['gh', ['project', 'field-list', '1', '--owner', 'owner', '--format', 'json']],
    ['gh', [
      'project', 'item-edit', '--id', 'right-issue', '--project-id', 'project-first',
      '--field-id', 'status-field', '--single-select-option-id', 'option',
    ]],
  ]);
});

it('ignores missing and malformed content without editing project items', () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  queueOutput(repo, { projects: [project] }, page([
    null,
    { id: 'redacted', content: null },
    { id: 'missing-repo', content: { __typename: 'Issue', number: 42 } },
    { id: 'missing-type', content: { number: 42, repository: { nameWithOwner: repo.nameWithOwner } } },
    { content: item('unused-id', repo.nameWithOwner).content },
    item('foreign-issue', 'owner/other'),
  ]));

  expect(setIssueStatus('42', 'In review')).toBe(false);
  expect(execOrThrow).toHaveBeenCalledTimes(3);
  expect(error).toHaveBeenCalledExactlyOnceWith('Issue 42 project item not found; status not set');
});

it('skips silently when no project items can be read', () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  queueOutput(repo, { projects: [project] });
  execOrThrow.mockImplementationOnce(() => { throw new Error('access denied'); });

  expect(setIssueStatus('42', 'In review')).toBe(false);
  expect(execOrThrow).toHaveBeenCalledTimes(3);
  expect(error).not.toHaveBeenCalled();
});

it('requires the current repository name before looking up items', () => {
  queueOutput({ owner: repo.owner });

  expect(setIssueStatus('42', 'In review')).toBe(false);
  expect(execOrThrow).toHaveBeenCalledTimes(1);
});

it.for([
  { name: 'fetching the next page', projects: [project], firstPage: page([], 'page-two') },
  { name: 'reading a later project', projects: [project, { id: 'project-next', number: 2 }], firstPage: page([]) },
])('reports API failures while $name after a readable page', ({ projects, firstPage }) => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  queueOutput(repo, { projects }, firstPage);
  execOrThrow.mockImplementationOnce(() => { throw new Error('graphql unavailable'); });

  expect(setIssueStatus('42', 'In review')).toBe(false);
  expect(execOrThrow).toHaveBeenCalledTimes(4);
  expect(error).toHaveBeenCalledExactlyOnceWith('Issue 42 project status could not be set: graphql unavailable');
});

it('reports invalid cursor data without querying the same page twice', () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  queueOutput(repo, { projects: [project] }, page([], 'page-two'), page([], 'page-two'));

  expect(setIssueStatus('42', 'In review')).toBe(false);
  expect(execOrThrow).toHaveBeenCalledTimes(4);
  expect(error).toHaveBeenCalledExactlyOnceWith('Issue 42 project status could not be set: project items pagination did not advance');
});
