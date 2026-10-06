# App Implementation Contract

[简体中文](./app-contract.md) | English

This contract describes local App integration. See [App Design](./app-design.en.md), the [creation and installation guide](./app-guide.en.md), and the executable [expense example](../examples/apps/expense/README.md).

## Distribution

`app.json` is strict JSON with `schemaVersion: 1`. Unknown fields are rejected. Required fields are the stable machine `id`, display `name`, SemVer `version`, and `description`. Paths are relative to the distribution root, or the containing Package where specified. Traversal, symlinks, and special files are rejected. The entire distribution is cached by content digest; users must not edit that cache.

| Field | Contract |
| --- | --- |
| `assets.memories` | `{key,path}[]` of owned Memory YAML. Existing four-kind syntax is unchanged. |
| `assets.viewPackages` | `{key,path}[]` of directories containing `module.json`. |
| `assets.modelPackages` | `{key,path}[]` of directories containing `model-package.json`. |
| `assets.cliDescriptors` | `{key,path}[]` of external tool descriptors. Registration does not install executables. |
| `assets.dataExtensions` | `{id,version,entry}[]`; trusted ESM default exports implement the existing DataExtension interface. |
| `dependencies` | `{kind,id,version?}[]`; kinds are app, viewPackage, modelPackage, dataExtension, cli, and memory. Versions are SemVer ranges; Memory uses canonical references. Missing dependencies are diagnosed, never downloaded. |
| `entrypoints.agent` | Canonical Memory references: read Concepts/Statements/Schemas, start Runs from Procedures. |
| `entrypoints.view` | `{packageKey,instanceId,path?,config?}[]`; path is a Module-relative route beginning with `/`, used by show. |
| `configuration` | Configuration JSON Schema file, validated on install/configure. |
| `stores` | `{key,model,kind,factory,config}[]`; kind is DataStore or ValueStore, using existing StoreBinding contracts. |
| `cliBindings` | `{cli,args?,cwd?,env?}[]`; values may reference installation configuration with `{configKey:"ledgerDirectory"}`. |
| `backend` | `{entry,operations}`; trusted ESM entry and operation-name-to-read/write mapping. |

A Model Package requires schemaVersion 1, id, name, version, and models. Each model declares modelRef, metaModel, and path, with optional name, description, and tags. Optional dependencies are model-package `{id,version?}[]`. Existing RuntimeFactories interpret definitions.

The single-field configKey form also works in Store and View instance configurations. Store directories resolve against the Project root. Relative paths in local CLI bindings resolve against the binding file. Keep secrets in host environment variables, outside distributions and examples.

## Installation and Memory

`app install <directory> [--config <file>]` validates metadata, paths, conflicts, and effective Memory before preparing installation. Successful installations start disabled. Identical content/configuration is idempotent; different content is not an implicit upgrade, and local Memory edits are not overwritten.

Home caches distributions at `apps/cache/<digest>`. Project state is `apps/<memory-root-digest>/state.json`, containing installations, ownership, bindings, and pending operations. An Embedded effective worktree is a separate installation scope. An operation cannot be resumed from another worktree; the main worktree never reads another worktree's unmerged candidate. This version does not automatically propagate worktree installation configuration.

Before writing Memory, installation persists reserved paths. Managed stores validate and publish an app_install ChangeSet; Embedded stores apply the validated candidate to the current worktree without committing Git. One atomic state write commits installation and ownership. If Memory publication succeeds but installation commit fails, File/Git Providers filter reserved paths before parsing YAML. Existing Memory remains readable. `app list` reports pending operations; fix the cause and retry identical distribution content. Do not repair by deleting files or editing state. Other Memory checkpoints require completion of a pending installation to avoid importing reserved assets into a candidate.

Writes use the Project App lock. Reads create no lock files: they revalidate state generation and published Store revision before and after materializing a snapshot, retrying on change. This preserves read-only Mounted access. Corrupt state fails explicitly instead of inventing unowned Memory. Mounted write targets are rejected before creating caches, locks, or candidates.

Ownership uses App ID, assetKey, and registered path. Installation preserves the original digest/reference; current references are resolved from Memory content and returned by app show. Edits and canonical renames preserve ownership. Required assets cannot be deleted or moved to another path. Optional ChangeSet app_ownership metadata participates in checkpoint digests. Candidate Runs freeze all four Memory kinds and ownership together; archive/restore retains Run metadata and the existing content manifest instead of consulting current installations.

## External CLI

| Command | Behavior |
| --- | --- |
| `memsphere cli register <descriptor-file>` | Validate/register; identical content is idempotent, conflicts fail. |
| `memsphere cli bind <id> --binding <binding-file> [--app <id>]` | Set an independent Project binding or a local override for one App. |
| `memsphere cli list [--app <id>]` | Discover registered tools, owners, and status without execution. |
| `memsphere cli show <id> [--app <id>]` | Return descriptor and executable/args/cwd/env/envFrom, without running help or business commands. |
| `memsphere cli check <id> [--app <id>]` | Explicitly check declared conditions and execute only a declared version probe. |

App and CLI commands accept global --project and command-level --output text|json. JSON errors contain code/message/details. Failed or unknown checks exit nonzero; malformed input exits 2.

Descriptors require schemaVersion 1, id, name, description, and a nonempty command argv array, such as `["expense"]` or `["node","tool.mjs"]`. Optional help is an argument array; documentation is a link or text. Requirements may declare env names, cwd presence, files, and a version range. A versionProbe is `{args:["--version"],format:"semver"}`; stdout must be one SemVer. Undeclared protocols are never guessed. Probes use no shell, with a 5-second timeout and a 64-KiB combined output limit.

Bindings have schemaVersion 1 and optional executable, args, cwd, env, envFrom, and files. Arguments follow descriptor.command. Local App overrides preserve manifest-derived fields unless explicitly replaced; configure regenerates manifest connections and retains explicit local overrides. env contains non-sensitive constants; envFrom maps child variable names to host environment variable names. Discovery does not expand referenced secrets.

Without --app, an explicit independent Project binding takes precedence. When App contexts exist without an independent binding, select one explicitly. App bindings never borrow another App's or the independent binding. Checks cover declared conditions only, not unverified authentication/network permissions. Agents invoke external programs directly using the structured information.

## View and Backend

Enabled Apps add View instances to their Project's boot composition, preserving Home themes and explicit Slot selections. Identical View/Model Package identities and content can be shared; conflicting content fails. `main.view@1:route:<route-id>` declares an instance's own page portably; the Runtime matches its actual scoped Route key without granting access to another instance's route.

An App-bound View Plugin injects api and calls `ctx.api.invoke(operation,input)`. Requests go to `/api/projects/<project>/apps/<app>/operations/<operation>`. The host resolves the Project, installation, and Stores, rejects undeclared operations, and reuses same-origin JSON and remote operator-token checks. Trusted plugins are not sandboxed.

The backend default export has operations containing `{kind,execute(ctx,input)}`, exactly matching the Manifest. ctx provides project, app, readonly config, signal, and `getStore(key)` restricted to declared App Store keys. Types are exported from `memsphere/app`. Independent CLIs may use public `memsphere/data` and `memsphere/data/extensions` directly without host HTTP.

Enable/configure/disable update persistent configuration. View uses a fixed boot composition and requires restart for interface changes. Backend requests read current installation configuration. Disablement immediately blocks new App requests and Procedure Runs; in-flight operations are not automatically rolled back. Memory remains readable, existing Runs retain frozen content, and standalone executables remain independent.

Remote distribution, upgrades, uninstall, adoption of existing Memory, execution gateways, and hot replacement are outside this version.
