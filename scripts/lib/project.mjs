// Optional GitHub Projects status update shared by the scripts/ helpers.
// Best-effort by design: when the gh login cannot read or edit the project
// every step here fails softly and setIssueStatus() reports false, so the
// calling script can skip silently without treating it as an error. A miss
// while the project itself is readable is different: it prints a short
// stderr note so it cannot be mistaken for that intentional silent skip.
import { execOrThrow } from './exec.mjs';

// Items come from GraphQL instead of `gh project item-list` because that
// command defaults to a single 30-item page and hid items beyond it from the
// lookup (#96); no fixed --limit can promise to cover every item, so the
// cursor loop below walks all pages.
const ITEMS_QUERY = `query ($id: ID!, $endCursor: String) {
  node(id: $id) {
    ... on ProjectV2 {
      items(first: 100, after: $endCursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          content {
            __typename
            ... on Issue { number repository { nameWithOwner } }
          }
        }
      }
    }
  }
}`;

function ghJson(args) {
  return JSON.parse(execOrThrow('gh', args));
}

function* projectItemPages(projectId) {
  let cursor;
  for (;;) {
    const args = ['api', 'graphql', '-f', `query=${ITEMS_QUERY}`, '-f', `id=${projectId}`];
    if (cursor !== undefined) args.push('-f', `endCursor=${cursor}`);
    const page = ghJson(args).data?.node?.items;
    if (!page && cursor === undefined) return;
    if (!Array.isArray(page?.nodes)) throw new Error('project items unavailable');
    yield page.nodes;
    if (!page.pageInfo.hasNextPage) return;
    const nextCursor = page.pageInfo.endCursor;
    if (typeof nextCursor !== 'string' || !nextCursor || nextCursor === cursor) {
      throw new Error('project items pagination did not advance');
    }
    cursor = nextCursor;
  }
}

// Applies the named Status option to one project item. The project was
// readable at this point, so every miss is noted on stderr: a silent false
// would look exactly like the intentional no-access skip. Returns true only
// when the edit went through; never throws.
function updateItemStatus(project, item, owner, issueNumber, optionName) {
  try {
    const fields = ghJson([
      'project', 'field-list', String(project.number), '--owner', owner, '--format', 'json',
    ]).fields;
    const status = fields.find((field) => field.name === 'Status' && field.options);
    const option = status?.options.find((candidate) => candidate.name === optionName);
    if (!status || !option) {
      console.error(`Issue ${issueNumber} project Status option '${optionName}' not found; status not set`);
      return false;
    }
    execOrThrow('gh', [
      'project', 'item-edit',
      '--id', item.id,
      '--project-id', project.id,
      '--field-id', status.id,
      '--single-select-option-id', option.id,
    ]);
    return true;
  } catch (error) {
    console.error(`Issue ${issueNumber} project status could not be set: ${error.message}`);
    return false;
  }
}

// Moves the given issue's project item to the named Status option. Option and
// field ids are looked up at runtime because GitHub mints them per project.
// Returns true only when the status was actually updated; never throws.
export function setIssueStatus(issueNumber, optionName) {
  let readable = false;
  try {
    const repo = ghJson(['repo', 'view', '--json', 'nameWithOwner,owner']);
    const { nameWithOwner } = repo;
    if (typeof nameWithOwner !== 'string' || !nameWithOwner) return false;
    const owner = repo.owner.login;
    const projects = ghJson(['project', 'list', '--owner', owner, '--format', 'json']).projects;
    for (const project of projects) {
      for (const items of projectItemPages(project.id)) {
        readable = true;
        const item = items.find((entry) => {
          const content = entry?.content;
          return typeof entry?.id === 'string' && entry.id &&
            content?.__typename === 'Issue' &&
            content.repository?.nameWithOwner === nameWithOwner &&
            content.number === Number(issueNumber);
        });
        if (item) return updateItemStatus(project, item, owner, issueNumber, optionName);
      }
    }
    if (readable) {
      console.error(`Issue ${issueNumber} project item not found; status not set`);
    }
    return false;
  } catch (error) {
    if (readable) {
      console.error(`Issue ${issueNumber} project status could not be set: ${error.message}`);
    }
    return false;
  }
}
