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

Project hosts resolve saved credentials. Standalone factories default to environment references, for example `{ "source":"env", "accessKeyIdEnv":"TOS_ACCESS_KEY_ID", "accessKeySecretEnv":"TOS_ACCESS_KEY_SECRET", "stsTokenEnv":"TOS_SECURITY_TOKEN" }`. The final token reference is optional. Do not pass credentials as Store configuration fields.

- `raw`: exact original Payload bytes, create without overwrite, physical delete. Updates and `expectedRevision` are rejected.
- `revision`: a ten-byte `MSDT | version:u8 | flags:u8 | counter:u32be` header precedes the Payload. Read returns an opaque string revision, encoded as eight lowercase hex counter digits, a colon and the unchanged ETag (including quotes). Callers pass only that string as `expectedRevision`. Updating and deleting use one conditional PUT without an object pre-read. The counter starts at one and wraps after uint32 max; indefinite ABA prevention is not promised.
- Delete writes a header-only tombstone and advances the counter, including repeated deletion. Get returns `{id,model,deleted:true,revision}`; has includes tombstones and list hides them. An ordinary update with the tombstone revision and new Payload writes the data again. Create against a tombstone conflicts. There is no separate restore API.

Reads and writes are streaming, with backpressure and cancellation. Revision reads take header, metadata and ETag from one range response, then read Payload conditionally against the same ETag. Unknown-length input is supported. SDK success alone is insufficient: upload input must reach normal EOF. A timeout/cancel after transmission may have committed; errors do not trigger retry or compensating deletion. Re-read before deciding what to do next.

The first release accepts only never-versioned buckets, ordinary uploads and at most 5 GiB per physical object (revision Payload: 5 GiB minus ten bytes). No multipart upload, bucket creation, migration, Store mode/location switching, offline fallback or history restoration. List scans at most ten backend pages per call, up to 128 candidates per page and eight candidate reads concurrently. An empty result may still have a continuation cursor.

The SDK is pinned at 2.9.1. A narrow subclass extends its protected `fetch` method and delegates signing and HTTP to `super.fetch`; it supplies the SDK CancelToken because the pinned Axios transport does not implement AbortSignal. No private SDK state or custom HTTP adapter is patched. Redirects and SDK retries are disabled. Native endpoints use direct HTTPS; automatic HTTP proxy environment variables are ignored to avoid the pinned Axios transport pairing HTTP proxy requests with the SDK TLS Agent. `DEBUG` must exclude the `TOS` namespace (for example `DEBUG=*,-TOS`); requests fail before transmission when full SDK request logging is enabled. SDK upgrades require transport and real-cloud recalibration.

Home settings encrypt saved credentials with AES-256-GCM. The key is stored in the same settings file, so encryption does not protect an attacker who can read that entire file. APIs expose credential IDs only. Temporary credentials can instead reference environment variables.
