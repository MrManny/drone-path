/**
 * Invokes an Electron dialog function with a parent window when one is available.
 * @template TOptions, TResult
 * @param {import('../dist/shellcontroller.js').ShellWindow | null} win
 * @param {(...args: any[]) => Promise<TResult>} show
 * @param {TOptions} options
 * @returns {Promise<TResult>}
 */
export function showDialogWithParent(win, show, options) {
  return win ? show(win, options) : show(options);
}
