// One hidden BrowserWindow rendering the export page, driven frame by frame
// and captured with webContents.capturePage(): the desktop app's answer to the
// CLI's Playwright page, using the embedded Chromium so packaged builds need
// neither playwright-core nor a system browser. This is the only module that
// touches Electron windows, so the render driver stays testable without
// launching Electron.

import { BrowserWindow } from 'electron';

import { JPEG_QUALITY } from '../dist/encode.js';

// Mirrors the CLI's waitForFunction('window.__READY === true'): the scene
// flips __READY once its first frame is drawable (with its own timeout
// fallback), so a page-side poll is enough.
const READY_POLL =
  'new Promise((resolve) => {' +
  ' const poll = () => {' +
  '  if (window.__READY === true) resolve(true); else setTimeout(poll, 25);' +
  ' };' +
  ' poll();' +
  '})';

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
    await win.loadURL(url);
    await win.webContents.executeJavaScript(READY_POLL);
  } catch (e) {
    win.destroy();
    throw e;
  }

  return {
    async setFrame(frame) {
      await win.webContents.executeJavaScript(`window.__setFrame(${frame})`);
    },
    async capture() {
      const image = await win.webContents.capturePage();
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
