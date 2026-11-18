# TOS DataStore

`TosDataStoreFactory` (`memsphere/tos`) uses the official `@volcengine/tos-sdk` to store business Payloads in an existing bucket and dedicated prefix. Only these Store records are stored in TOS; this does not back up the Project, Memory or Run stores.

```json
{
  "region": "cn-beijing",
  "endpoint": "tos-cn-beijing.volces.com",
  "bucket": "lyj-test",
  "prefix": "memsphere/assets/",
  "mode": "revision",
  "credentials": { "source": "settings", "id": "tos-main" }
}
```

The endpoint must match the configured region (`tos-<region>.volces.com` or `tos-<region>.ivolces.com`). Public and internal endpoints identify the same regional bucket; within a Project, Store prefixes in that bucket must not overlap.

View settings group cloud configuration under **Volcengine cloud**. The TOS credentials list supports adding and deleting named credential sets and editing an existing set without displaying its saved secrets. Blank secret fields during an edit keep their existing values. Project business Store settings select these names from a dropdown; the creation form separates identity, cloud location, write/delete behavior and credentials. Existing Store configuration is expandable and keeps model, location and mode read-only.

Project hosts resolve saved credentials. Standalone factories default to environment references, for example `{ "source":"env", "accessKeyIdEnv":"TOS_ACCESS_KEY_ID", "accessKeySecretEnv":"TOS_ACCESS_KEY_SECRET", "stsTokenEnv":"TOS_SECURITY_TOKEN" }`. The final token reference is optional. Do not pass credentials as Store configuration fields.

- `raw`: exact original Payload bytes, create without overwrite, physical delete. Updates and `expectedRevision` are rejected.
- `revision`: a fourteen-byte `MSDT | storageVersion:u8=2 | flags:u8 | mutationId:8bytes` header precedes the Payload. Each write generates eight cryptographically random bytes internally. The opaque public revision is the unchanged single ETag (including quotes); update/delete send it as If-Match in one PUT without a pre-read. Random identity collisions remain a probabilistic ABA limitation. Unused legacy counter headers/tokens are not supported.
- Delete writes a header-only tombstone with a new random identity, including repeated deletion. Get returns `{id,model,deleted:true,revision}`; has includes tombstones and list hides them. An ordinary update with the tombstone revision and new Payload writes the data again. Create against a tombstone conflicts. There is no separate restore API.

Reads and writes are streaming, with backpressure and cancellation. Revision reads take header, metadata and ETag from one range response, then read Payload conditionally against the same ETag. Unknown-length input is supported. SDK success alone is insufficient: upload input must reach normal EOF. A timeout/cancel after transmission may have committed; errors do not trigger retry or compensating deletion. Re-read before deciding what to do next.

The first release accepts only never-versioned buckets, ordinary uploads and at most 5 GiB per physical object (revision Payload: 5 GiB minus fourteen bytes). No multipart upload, bucket creation, migration, Store mode/location switching, offline fallback or history restoration. List scans at most ten backend pages per call, up to 128 candidates per page and eight candidate reads concurrently. An empty result may still have a continuation cursor.

The SDK is pinned at 2.9.1 and loaded when a TOS client is opened, so filesystem commands do not initialize it. A narrow subclass extends its protected `fetch` method and delegates signing and HTTP to `super.fetch`; it supplies the SDK CancelToken because the pinned Axios transport does not implement AbortSignal. No private SDK state or custom HTTP adapter is patched. Redirects and SDK retries are disabled. Native endpoints use direct HTTPS; automatic HTTP proxy environment variables are ignored to avoid the pinned Axios transport pairing HTTP proxy requests with the SDK TLS Agent. `DEBUG` must exclude the `TOS` namespace (for example `DEBUG=*,-TOS`); requests fail before transmission when full SDK request logging is enabled. SDK upgrades require transport and real-cloud recalibration.

Home settings encrypt saved credentials with AES-256-GCM. The key is stored in the same settings file, so encryption does not protect an attacker who can read that entire file. APIs expose credential IDs only. Temporary credentials can instead reference environment variables.

Credential deletion requires confirmation and Home configuration CAS. It does not remove Store references or remote objects; affected Stores need another credential. Store deletion is available outside the collapsed configuration and only unbinds the Store after confirmed save.

Optional `dataTimeoutMs` (GET/PUT) and `controlTimeoutMs` (HEAD/list/versioning/physical DELETE) are positive integer milliseconds, each defaulting to 120000 for both TOS Store kinds. They can be edited after creation in CLI config or View; omission restores defaults. Each budget covers one request and its body, and parent cancellation may stop it earlier. Conflicts and uncertain outcomes are not automatically retried.

Object metadata uses `memsphere-storage-version` for the existing `raw-v1` / `revision-v1` storage identifiers. The former `memsphere-store-format` key remains readable for existing objects; conflicting old/new markers are rejected. New writes emit only `memsphere-storage-version`. This key rename does not change the Payload, binary header or public revision.
