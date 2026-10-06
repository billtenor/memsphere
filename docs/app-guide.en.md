# Create and Install an App

[简体中文](./app-guide.md) | English

This guide explains how to create an App, install it into a Project, and use it. App management and external CLI registration are implemented, and the examples have been verified through actual installation and use. See [App Design](./app-design.en.md) and the [implementation contract](./app-contract.en.md) for concepts and interfaces.

An author delivers a directory containing `app.json` and the App's assets. A user installs that directory into a Project and enables it. The installer registers the declared assets and records ownership; users do not install each Memory, register each CLI, or add each View Package separately. External CLI executables retain their own installation method.

## Author: create a minimal App

A writing App can provide a shared concept for Agents across Projects. It needs two files and no CLI, View, or Model:

```text
writing-app/
├── app.json
└── memories/
    └── concepts/
        └── writing-brief.yaml
```

Create the directory:

```bash
mkdir -p writing-app/memories/concepts
```

Save this as `writing-app/app.json`:

```json
{
  "schemaVersion": 1,
  "id": "org.example.writing",
  "name": "Writing conventions",
  "version": "0.1.0",
  "description": "Provide Agents with a shared concept for writing tasks.",
  "assets": {
    "memories": [
      {
        "key": "brief",
        "path": "memories/concepts/writing-brief.yaml"
      }
    ]
  },
  "entrypoints": {
    "agent": ["concepts/example-writing-brief"]
  }
}
```

Save this as `writing-app/memories/concepts/writing-brief.yaml`:

```yaml
!concept
syntax: memsphere-20260721-stable
names:
  - example-writing-brief
  - Writing brief
defines:
  - A writing brief is an agreement between an author and an Agent on a document's intended audience, purpose, and delivery format.
```

This is a complete minimal App distribution directory. `id` identifies the App for management, `name` is its display name, `key` identifies an asset within the App, and `path` is relative to the directory containing `app.json`. A Memory reference comes from its YAML kind and first name; `entrypoints.agent` identifies where the Agent starts reading.

Give the entire directory to another user, or put it in a repository for them to obtain. The first release installs local directories: extract archives first; direct marketplace or remote URL installation is out of scope. Include all declared files and, for code assets, built outputs. Installing an App must not require modifying or rebuilding Memsphere.

## User: install into a Project and use it

Install Memsphere following the [setup instructions](../README.en.md). The commands below use a Project named `my-project`. If it does not exist yet, create it first:

```bash
memsphere project create my-project
```

After obtaining `writing-app`, run these commands from its parent directory:

```bash
memsphere --project my-project app install ./writing-app
memsphere --project my-project app enable org.example.writing
memsphere --project my-project app show org.example.writing
```

| Operation | Expected result |
| --- | --- |
| install | Version `0.1.0` is installed, initially disabled. One Memory belongs to this App in the Project. The result provides the App ID and an enable instruction. |
| enable | Dependency checks pass and the App is enabled. This Memory-only example needs no View restart. |
| show | Name, version, state, owned Memory, and Agent entrypoint `concepts/example-writing-brief` are visible. |

Ask your Agent to read this App's entrypoint in `my-project` and help prepare a writing brief. The Agent uses the existing Memory command:

```bash
memsphere --project my-project memory read concepts/example-writing-brief
```

This entrypoint is a Concept to read. For a Procedure entrypoint, use `run start <reference> --name <task-name>`. The `usage.agent` field returned by `app show` provides the appropriate read or start command for each entrypoint.

Install the same directory in another Project to use it there. Each Project keeps its own installation and configuration; enabling one does not enable the other. This minimal example has no business data. Apps with data also need the appropriate data location configured for each Project.

## Business App: what the author adds

An expense App still ships as one directory, containing the assets that implement its business behavior:

```text
expense-app/
├── app.json
├── config.schema.json       # Required configuration and descriptions
├── memories/                # Concepts, rules, and procedures
├── cli/descriptor.json      # External expense tool descriptor
├── view/                    # module.json and built UI
├── models/                  # model-package.json and model definitions
└── backend/                 # Built operations and shared business implementation
```

See the runnable [expense App README](../examples/apps/expense/README.md) for build, standalone tool installation, and business commands. Authors supply the assets; `app.json` composes them.

| Author task | App declaration |
| --- | --- |
| Deliver concepts, rules, and procedures | List YAML files in `assets.memories` and starting points in `entrypoints.agent`. |
| Provide a Human interface | Build a package using the [View Plugin Guide](./view-plugin-guide.en.md); declare it in `assets.viewPackages` and its instances in `entrypoints.view`. |
| Provide models | Declare `assets.modelPackages`; connect models to storage through `stores`. |
| Provide an Agent tool | Declare descriptor files in `assets.cliDescriptors`; installation registers them. Connect configuration through `cliBindings`. |
| Connect frontend and backend | Declare business operations in `backend`; View and CLI use shared business code or a service against the same authoritative data. |
| Explain configuration | Point `configuration` to a Schema and include an example configuration and external CLI installation instructions. |

For example, `cli/descriptor.json` can contain:

```json
{
  "schemaVersion": 1,
  "id": "org.memsphere.expense-cli",
  "name": "Expense tool",
  "description": "Create, query, and update expense records.",
  "command": ["expense"],
  "help": ["--help"]
}
```

Declare this binding in `app.json`'s `cliBindings`, and use the same `ledgerDirectory` configuration value in the backend and Store:

```json
[
  {
    "cli": "org.memsphere.expense-cli",
    "args": ["--ledger", { "configKey": "ledgerDirectory" }]
  }
]
```

The user supplies a ledger location once. If the executable is on PATH, no manual `cli bind` is needed; an explicit local executable location can be bound when necessary. Manual `cli register` serves standalone tool use without an App.

## Business App: what the user adds

The author must provide a complete README, editable configuration example, and exact external tool installation commands. Install `expense` using those instructions. Save this as `my-expense.json`, replacing the path with your ledger directory:

```json
{
  "ledgerDirectory": "/absolute/path/to/my-ledger"
}
```

The expense example uses App ID `org.memsphere.expense`. Run:

```bash
memsphere --project my-project app install ./expense-app --config ./my-expense.json
memsphere --project my-project app check org.memsphere.expense
memsphere --project my-project app enable org.memsphere.expense
memsphere --project my-project app show org.memsphere.expense
```

The installer handles owned Memory, models, View Packages, and CLI descriptors. `check` verifies tool and configuration conditions; `enable` establishes entrypoints. If a View/backend composition reports `restartRequired`, run:

```bash
memsphere view restart
memsphere view status
```

Open the service URL returned by these commands, select `my-project`, and click **费用 / Expenses**. Alternatively, append the page path returned by `app show` to the service URL. On first use, `restart` also starts the service. There is no need to add the App's packages individually in Home settings.

`app show` tells Humans where to open the expense interface and Agents which Memory and tool binding to use. An Agent can obtain structured invocation information with this command, then call `expense` directly:

```bash
memsphere --project my-project cli show org.memsphere.expense-cli --app org.memsphere.expense
```

The Agent invokes the external program directly with the returned fixed arguments. In the expense example, records entered through View can be queried through the CLI, and CLI writes appear after refreshing View. Both entrypoints use the same ledger and business rules.

## Where to continue after a problem

| Situation | Next action |
| --- | --- |
| Conflicting Memory name or asset ID | Correct the indicated identity or dependency; installation must not overwrite existing assets. |
| Tool not found | Install it following the author's instructions, or use `cli bind` to specify its local executable location, then check again. |
| Invalid configuration | Correct the file against the Schema. For an installed App, run `app configure <id> --config <file>`, then check and enable it. |
| Interface needs a restart | Follow the returned restart instruction and reopen the entrypoint in the target Project. |
| Temporarily stop using the App | Run `app disable <id>` and follow any View restart instruction. Memory ownership, business data, and existing Runs remain. |

The first version installs trusted local directories. Remote downloads, upgrades, uninstall, and automatic adoption of existing Memory are out of scope. Embedded installations belong to the effective worktree; the main worktree does not adopt another worktree’s unmerged candidate.
