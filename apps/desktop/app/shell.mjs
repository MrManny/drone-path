import { resolveLocale, translator } from '../dist/desktop-i18n/messages.js';

export function liveWindow(state) {
  return state.win && !state.win.isDestroyed() ? state.win : null;
}

export function showDialogWithParent(state, show, options) {
  return state.win ? show(state.win, options) : show(options);
}

export function translationFor(state) {
  return translator(resolveLocale(state.appState.language, state.systemLanguages));
}
