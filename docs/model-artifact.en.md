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

The current version keeps a complete, immutable Artifact snapshot **and** writes the accepted model value into the business Store. Review and historical reads use snapshots, never the current business value. Store revision metadata does not imply historical content lookup.

Before review approval, only the snapshot is stored. Revisions create new immutable Submissions. Acceptance upserts the full value and then advances the Run. A failed write does not advance; a successful write followed by a failed Run save can be redone at the same ID, increasing the revision. Later business updates do not change snapshots. Run abandonment, deletion, archival and restoration do not delete or resubmit business records.

Accepted events record Store, model fingerprint, execution identity, data ID, digest and available revision separately from the business value.

```bash
memsphere data upsert record-id --store processing-results --value-file result.json
```

The CLI also supports `--value`, `--dry-run` and `--output`. Upsert creates or replaces a complete value under the record lock. It does not merge fields and does not support raw DataStores, payloads, patches or expected-revision conditions.
