import { readConfig } from "../config.js";
import {
  checkArtifactContractV2Migration,
  writeArtifactContractV2Migration
} from "../migration/artifact-contract-v2.js";

export async function migrateArtifactContractV2Command(options: { check?: boolean; write?: boolean; config?: string }): Promise<void> {
  if (Boolean(options.check) === Boolean(options.write)) {
    throw new Error("choose exactly one of --check or --write");
  }
  const config = await readConfig(options.config);
  const manifest = options.write
    ? await writeArtifactContractV2Migration(config)
    : (await checkArtifactContractV2Migration(config)).manifest;
  console.log(JSON.stringify(manifest, null, 2));
  if (manifest.status === "blocked") process.exitCode = 1;
}
