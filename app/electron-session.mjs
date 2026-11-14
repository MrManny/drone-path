// One hidden BrowserWindow rendering the export page, driven frame by frame
// and captured with webContents.capturePage(): the desktop app's answer to the
// CLI's Playwright page, using the embedded Chromium so packaged builds need
// neither playwright-core nor a system browser. This is the only module that
// touches Electron windows, so the render driver stays testable without
// launching Electron.

import { BrowserWindow } from 'electron';

import { JPEG_QUALITY } from '../dist/encode.js';

// Mirrors src/render.ts's page and screenshot timeouts. A page that never
// loads or boots must fail the export, not hang it: the scene's own ready
// timeout only exists once bootScene has constructed the Scene, so a boot
// failure would leave an unbounded poll here otherwise.
const PAGE_LOAD_TIMEOUT_MS = 60000;
const SCREENSHOT_TIMEOUT_MS = 60000;

const READY_POLL =
  'new Promise((resolve) => {' +
  ' const poll = () => {' +
  '  if (window.__READY === true) resolve(true); else setTimeout(poll, 25);' +
  ' };' +
  ' poll();' +
  '})';

function withTimeout(work, ms, message) {
  // The race's loser must never surface as an unhandled rejection.
  work.catch(() => {});
  let timer;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  timeout.catch(() => {});
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

export async function openElectronSession({ url, width, height, capture }) {
  const win = new BrowserWindow({
    show: false,
    useContentSize: true,
    width,
    height,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      devTools: false,
      // A hidden window must keep painting or capturePage returns blanks.
      backgroundThrottling: false,
      paintWhenInitiallyHidden: true,
    },
  });
  try {
    // Playwright screenshots at deviceScaleFactor 1; pin the emulated screen
    // so capturePage returns output-size pixels on scaled displays too.
    win.webContents.enableDeviceEmulation({
      screenPosition: 'desktop',
      screenSize: { width, height },
      viewSize: { width, height },
      deviceScaleFactor: 1,
    });
    await withTimeout(
      win.loadURL(url),
      PAGE_LOAD_TIMEOUT_MS,
      `page load timed out after ${PAGE_LOAD_TIMEOUT_MS / 1000}s`,
    );
    await withTimeout(
      win.webContents.executeJavaScript(READY_POLL),
      PAGE_LOAD_TIMEOUT_MS,
      `render page did not become ready in ${PAGE_LOAD_TIMEOUT_MS / 1000}s`,
    );
  } catch (e) {
    win.destroy();
    throw e;
  }

  return {
    async setFrame(frame) {
      await win.webContents.executeJavaScript(`window.__setFrame(${frame})`);
    },
    async capture() {
      const image = await withTimeout(
        win.webContents.capturePage(),
        SCREENSHOT_TIMEOUT_MS,
        `frame capture timed out after ${SCREENSHOT_TIMEOUT_MS / 1000}s`,
      );
      const size = image.getSize();
      const fitted =
        size.width === width && size.height === height ? image : image.resize({ width, height });
      return capture === 'jpeg' ? fitted.toJPEG(JPEG_QUALITY) : fitted.toPNG();
    },
    async close() {
      if (!win.isDestroyed()) win.destroy();
    },
  };
}
