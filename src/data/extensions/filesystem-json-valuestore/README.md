# Filesystem JSON ValueStore

`FilesystemJsonValueStoreFactory.createStore(context, id, runtime, config)` opens
the configured root and creates it if missing. `openExisting` takes the same
arguments and never creates directories or files; use it when assembling a
Store for read-only operations or dry-run. Both reject invalid configuration.
The only configuration field is the required, nonblank `directory` string.
Relative paths at this Factory boundary resolve against the process cwd; the
Project service resolves them against the Registry Project root before calling.

Records remain readable `<id>.json` files containing `id`, `revision`, timestamps,
and `value`. Every create/update/delete acquires the same native per-record lock
across processes and Factory instances. Conditions are checked inside that lock.
An omitted `expectedRevision` is unconditional; it does not protect an earlier
client read. The first creation has revision 1. Before deletion, the highest used
revision is persisted; recreating the ID uses that number plus one. Failed
publication or deletion does not advance the visible record's revision. Corrupt
revision metadata and numeric overflow fail without resetting the sequence.

Permanent coordination files and deleted revision history live in
`.memsphere-json-store/`. They are excluded from `list()` and must be retained when
unregistering/re-registering a Store. Never delete or replace its lock files:
ownership is managed by the operating system, so process termination releases a
lock without deleting it. Lock waits time out and support `Context.signal`; a
timeout never steals a live lock. Unsupported native locking fails before the
record action. External file edits or removal of internal metadata bypass these
guarantees. No cross-record transaction or power-loss recovery is promised.

`validateFilesystemJsonStoreMetadata(context, directory)` performs a pure check
of retained internal state for explicit directory registration. It accepts only
this implementation's metadata and temporary-file protocol and never repairs or
deletes evidence. `parseFilesystemJsonValueStoreConfig(config)` checks and returns
a configuration snapshot without I/O.
