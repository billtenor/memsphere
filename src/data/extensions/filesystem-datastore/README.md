# Filesystem DataStore

`FilesystemDataStoreFactory.createStore(context, id, model, config)` creates a
missing root. `openExisting` takes the same arguments but only opens an existing
directory; reads and dry-run must use this path. Missing or concurrently removed
roots fail without being recreated. Configuration and MIME mappings are checked
before directory creation. `parseFilesystemDataStoreConfig(config)` exposes this
pure validation and the effective suffix-to-MIME mapping for host preflight.

The required `directory` must be nonblank. Optional `contentTypeExtensions`
overrides each MIME type's suffix list; other fields are rejected. Factory-relative
paths use cwd; the Project service resolves Project-relative paths before calling.

This Store keeps original Payload bytes and provides no revision or conditional
write support. Passing `expectedRevision` fails with `UNSUPPORTED_CAPABILITY`.
Native record locks and retained deletion revisions belong to the filesystem JSON
ValueStore implementation, not this DataStore or the generic Store interfaces.
