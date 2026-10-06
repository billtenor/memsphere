import { after, before } from "node:test";
import { chromium, type Browser, type BrowserContext } from "playwright";

export type TestBrowser = Pick<Browser, "newPage" | "newContext" | "close">;

let sharedBrowser: Browser | undefined;
before(async () => {
  // Launch before any fixture changes cwd: on Windows a live browser process
  // retains its inherited working directory and would block fixture removal.
  sharedBrowser = await chromium.launch({ headless: true });
});
after(async () => {
  await sharedBrowser?.close();
});

/** Reuse the Chromium process within a test file; each scope owns isolated contexts. */
export async function browserScope(): Promise<TestBrowser> {
  const browser = sharedBrowser;
  if (!browser) throw new Error("Browser scopes require the test file setup hook");
  const contexts = new Set<BrowserContext>();
  return {
    async newPage(options) {
      // Browser.newPage creates a fresh context, including for two pages in one test.
      const page = await browser.newPage(options);
      contexts.add(page.context());
      return page;
    },
    async newContext(options) {
      const context = await browser.newContext(options);
      contexts.add(context);
      return context;
    },
    async close(options) {
      await Promise.all([...contexts].map(context => context.close(options)));
      contexts.clear();
    }
  };
}
