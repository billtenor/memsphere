import { after } from "node:test";
import { chromium, type Browser, type BrowserContext } from "playwright";

export type TestBrowser = Pick<Browser, "newPage" | "newContext" | "close">;

let browserPromise: Promise<Browser> | undefined;
after(async () => {
  if (browserPromise) await (await browserPromise).close();
});

/** Reuse the Chromium process within a test file; each scope owns isolated contexts. */
export async function browserScope(): Promise<TestBrowser> {
  const browser = await (browserPromise ??= chromium.launch({ headless: true }));
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
