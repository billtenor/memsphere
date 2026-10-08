# Model data Artifacts

A normal Action can declare a business `store` and an optional `.json` `model`. The model is inferred from the Store; an explicit model must match. The first version supports filesystem JSON ValueStores with atomic upsert. `schema` cannot be combined with model data. Objects and arrays use JSON/YAML; strings, numbers and booleans also support plain. Control-condition Artifacts cannot write business data.

```yaml
- !action
  action: Produce the processing result.
  artifact: !artifact
    name: Processing result
    type: object
    format: json
    store: processing-results
    model: business/processing-result.json
```

Run creation checks all reachable targets and freezes their bindings and model fingerprints. Submission and acceptance reject changed targets or models; restoring the original configuration permits retry. Display names and tags do not affect fingerprints.

Each step execution has a persisted UUID. The business data ID combines the Run ID and this UUID. Retries and review revisions reuse it; loop iterations, repeated Calls and new Runs allocate distinct identities.

## Stable business IDs

```bash
memsphere run report --run <run-id> --artifact-file result.json --write-options '{"data_id":"task-123"}'
```

`--write-options` accepts an inline JSON object describing the Store write after acceptance. The only supported field is optional string `data_id`. Only normal model Artifacts bound to a business Store support it, including an empty object `{}` (Run API: optional `writeOptions: { data_id?: string }`). File references and YAML are unsupported. Unknown fields (including unimplemented `expected_revision`), non-objects and non-string IDs are rejected. The business Artifact remains pure model data. Different steps, loop iterations and Runs may select the same ID in the same Store. Omitting the option or passing `{}` retains generated IDs, or inherits an already frozen target.

An explicit ID must be nonempty and contain non-whitespace characters. Both the ID and `<id>.json` must satisfy the filesystem JSON ValueStore portable filename rules, including NFC, reserved names, forbidden characters and the 255-byte/character limit. IDs are neither trimmed nor encoded. Invalid IDs and use on non-model Artifacts are rejected before target freezing or business writes.

The first candidate passing format and model validation persists its target before review or upsert. Retries and review revisions inherit it when the option is omitted; the same explicit ID is accepted, a different ID is rejected. A generated target also cannot be changed during review. Failed format/model validation has not selected a target. New loop/Call executions do not inherit the previous execution target.

Candidate `modelTarget`, review materials and report receipts expose the selected ID. Accepted `modelData` records the written ID and revision. Acceptance checks the immutable Submission target against its frozen execution and Store/model fingerprint. Business identity remains independent of Step/Submission identity. Older Submissions without target metadata still use the original generated ID.

This version has no expected-revision or CAS. Upsert atomically replaces the complete record under its record lock: the last successful write wins, omitted optional fields are removed, and fields are not merged. Concurrent Runs targeting the same ID can overwrite each other's updates; review approval does not freeze the previous business revision. A business write followed by a failed Run save is redone at the same ID and may increase revision.

The current version keeps a complete, immutable Artifact snapshot **and** writes the accepted model value into the business Store. Review and historical reads use snapshots, never the current business value. Store revision metadata does not imply historical content lookup.

Before review approval, only the snapshot is stored. Revisions create new immutable Submissions. Acceptance upserts the full value and then advances the Run. A failed write does not advance; a successful write followed by a failed Run save can be redone at the same ID, increasing the revision. Later business updates do not change snapshots. Run abandonment, deletion, archival and restoration do not delete or resubmit business records.

Accepted events record Store, model fingerprint, execution identity, data ID, digest and available revision separately from the business value.

```bash
memsphere data upsert record-id --store processing-results --value-file result.json
```

The CLI also supports `--value`, `--dry-run` and `--output`. Upsert creates or replaces a complete value under the record lock. It does not merge fields and does not support raw DataStores, payloads, patches or expected-revision conditions.
