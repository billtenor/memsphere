
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";



import { assertChangeShowRejected, changeShowFixture } from "../../helpers/change-show.js";

for (const damage of ["directory", "body", "description", "legacy", "version"] as const) {
  test(`Reviewer rejects ${damage} checkpoint damage without a fallback`, async t => {
    const f = await changeShowFixture(t);
    if (damage === "directory") await rm(f.versionRoot(), { recursive: true, force: true });
    if (damage === "body") await writeFile(join(f.versionRoot(), "memory/concepts/review-evidence.yaml"), "corrupt");
    if (damage === "description") await writeFile(join(f.versionRoot(), "checkpoint.json"), "not-json");
    if (damage === "legacy") await rm(join(f.versionRoot(), "checkpoint.json"));
    if (damage === "version") {
      const file = join(f.versionRoot(), "checkpoint.json");
      const value = JSON.parse(await readFile(file, "utf8")); value.format_version = 999;
      await writeFile(file, JSON.stringify(value));
    }
    const diagnostic = { directory: /checkpoint is missing/, body: /checkpoint digest does not match/,
      description: /JSON/, legacy: /validate again/, version: /format_version/ }[damage];
    assertChangeShowRejected(f.invoke(), 1, diagnostic);
  });
}
