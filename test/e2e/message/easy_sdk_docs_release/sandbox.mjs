import { chromium } from 'playwright';

if (process.argv[2] === 'path') {
  console.log(chromium.executablePath());
} else {
  try {
    const browser = await chromium.launch({ channel: 'chromium', headless: true, chromiumSandbox: true, timeout: 15_000 });
    await browser.close();
    console.log('Sandboxed Chromium launch passed.');
  } catch (error) {
    // This probe runs before any SDK or credentials are loaded; retain only a failure category.
    const denied = /No usable sandbox|Failed to move to new namespace|Operation not permitted|AppArmor.*user namespaces/i.test(error.message);
    console.error(denied ? 'Chromium sandbox user namespaces are unavailable.' : 'Chromium launch failed for a reason other than the known sandbox restriction.');
    process.exitCode = denied ? 78 : 1;
  }
}
