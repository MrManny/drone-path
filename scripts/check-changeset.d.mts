export interface RunCheckEnv {
  PR_TITLE?: string;
  BASE_SHA?: string;
  HEAD_SHA?: string;
}

export interface RunCheckDeps {
  listChanged?: (baseSha: string, headSha: string) => string[];
  log?: (line: string) => void;
}

export function runCheck(env: RunCheckEnv, deps?: RunCheckDeps): number;
