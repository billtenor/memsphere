import assert from "node:assert/strict";
import test from "node:test";
import { rewriteGlobalStyleUrls, validateGlobalStyle } from "../src/view/global-style-contract.js";

test("global style contract scans every declaration and nested at-rule resource", () => {
  const validated = validateGlobalStyle(`
    .org-example-card {
      --image: url(./images/card.png);
      cursor: url("./cursor.cur"), auto;
      list-style-image: url('./images/bullet.png');
      content: url(./images/mark.png);
      background: image-set(url(./images/a.png) 1x, url(./images/b.png) 2x);
      background-image: -webkit-image-set(url(./images/c.png) 1x);
    }
    @media (width > 400px) { .org-example-card { color: CanvasText; } }
    @font-face { font-family: Example; src: url(./fonts/example.woff2) format("woff2"); }
  `);
  assert.deepEqual(validated.assets, [
    "./images/card.png", "./cursor.cur", "./images/bullet.png", "./images/mark.png",
    "./images/a.png", "./images/b.png", "./images/c.png", "./fonts/example.woff2"
  ]);
});

test("global style contract rejects privileged or ambiguous CSS fail closed", () => {
  for (const css of [
    '@import "./other.css";',
    '.org-example { background: url(https://example.com/a.png); }',
    '.org-example { background: url(//example.com/a.png); }',
    '.org-example { background: url(/etc/passwd); }',
    '.org-example { background: url(../escape.png); }',
    '.org-example { color: red !important; }',
    ':root { --mem-view-color-text: red; }',
    '.view-shell-primary { color: red; }',
    '[data-view-slot="main"] { color: red; }',
    '@namespace svg url(http://www.w3.org/2000/svg);',
    '@page { background: url(./page.png); }',
    '.org-example { background: url("unterminated); }',
    '.org-example { width: expression(alert(1)); }'
  ]) {
    assert.throws(() => validateGlobalStyle(css), css);
  }
});

test("global style URL rewriting retains structure and uses only validated assets", () => {
  const css = rewriteGlobalStyleUrls(
    '.org-example { background: url(./image.png); src: url("./font.woff2"); }',
    path => `/assets/view-packages/key/${path.slice(2)}`
  );
  assert.match(css, /url\("\/assets\/view-packages\/key\/image\.png"\)/);
  assert.match(css, /url\("\/assets\/view-packages\/key\/font\.woff2"\)/);
});

test("declared style namespace is enforced for custom-property definitions", () => {
  assert.doesNotThrow(() => validateGlobalStyle(
    ".card { --org-example-card-accent: teal; color: var(--org-example-card-accent); }",
    "--org-example-card-*"
  ));
  assert.throws(() => validateGlobalStyle(
    ".card { --other-accent: teal; }",
    "--org-example-card-*"
  ), /outside its declared namespace/);
  assert.throws(() => validateGlobalStyle(".card { color: teal; }", "org-example-*"), /namespace/);
});
