# Memsphere Architecture

[简体中文](./architecture.md) | English

This document records Memsphere’s long-term architectural baseline. It describes Memsphere’s position in the Agent ecosystem; the boundary between the platform core and personalized software; how Projects and Modules are organized; the code layers; and how CLI, View, and data capabilities collaborate. It does not require every detail to be implemented in one release.

## System Positioning

Memsphere is a personalized software runtime built on general-purpose Agents. Agents understand intent, reason, and execute. Memsphere organizes, runs, and manages software assets that accumulate across conversations, models, and Agents.

Humans and Agents enter the same personalized software through different adapters:

```text
Human → Memsphere View → Module View Adapter
Agent → Memory → Module CLI Adapter

View / CLI → Application → Domain → Persistence Adapter
           → authoritative Project data
```

Memory, CLI, data, and UI are four kinds of assets that personalized software may grow over time. They are not separate products and need not all exist at creation. Memory remains a Project-level semantic asset. Modules contain CLI, View, domain logic, and persistence capabilities.

## System Boundaries

### Memsphere Core

Core is the stable platform shipped with Memsphere. It owns:

- Home, Registry, Workspace Binding, and Project resolution;
- Memory discovery, reading, editing, and validation;
- Procedure Run, Artifact, Review, ChangeSet, and Archive;
- Module discovery, dependency resolution, instance composition, and lifecycle boundaries;
- CLI Host, ViewHost, and the public SDKs Modules may depend on;
- failure isolation, configuration management, and stable system entrypoints.

Core provides runtime mechanisms and does not contain business rules specific to one personalized software product.

### Project

A Project is the persistent boundary for personalized software assets, Module instances, run records, and authoritative data. A Workspace must bind a Project before Agents and Humans can use that Project’s software in the current work context.

### Module

A Module is an independently developed, installed, composed, and evolved software unit in a Project. Built-in and user capabilities should use the same Module mechanism instead of continuously expanding a privileged Core.

```text
Memsphere Core
├── Memory / Run / Review / ChangeSet Runtime
├── Module Composition Runtime
├── CLI Host
└── ViewHost

Project
├── Memory
├── Module Instance A
├── Module Instance B
├── Run / Review / ChangeSet / Archive
└── authoritative Module instance data
```

## Personalized Software and Modules

Software no longer has to be packaged as one traditional application or begin with complete code. A programmatic Memory can be software on its own, as can an interaction-only interface. It may later grow deterministic tools, domain logic, and persistent data.

Memsphere calls an independently executable code unit a **Module**. A Project composes multiple Modules supplied by Memsphere or developed by users after installation. Memory keeps its existing Project-level organization and does not belong to a Module.

Memory may help Agents discover a Module CLI, while Humans operate a Module through its View. CLI and View reuse the same Application and Domain and ultimately operate on the same authoritative data. Memory and Modules may reference each other but do not share directory ownership or packaging lifecycle.

User code does not enter Memsphere source code and does not require recompiling a released Memsphere. Memsphere stabilizes Host, SDK, and composition protocols; Modules compile independently and are introduced by a Project.

## Architectural Goals

- Core contains reusable platform mechanisms; personalized business capabilities evolve through Modules.
- Project is the persistent boundary for software assets, instances, runs, and authoritative data.
- One Project composes multiple independent Module instances.
- Projects may grow Memory and Modules as needed; Modules may grow CLI, View, domain logic, and persistence without empty placeholders.
- Built-in and user Modules use the same discovery, loading, and composition mechanism.
- CLI is the deterministic Agent entrypoint; View is the Human interaction and observation entrypoint.
- CLI and View reuse Application and Domain and share authoritative data.
- Users independently develop, compile, install, and compose Modules without rebuilding Memsphere.
- A Module may contribute complete pages or extend explicit local UI extension points of another Module.
- Prototypes and production Modules share one structure and can evolve in place.
- View is stateless, restartable, and reconstructed from Project configuration and persistent data.
- Failure of one user Module leaves the base Shell and healthy Modules available.
- Projects and personalized software assets remain portable, reproducible, and evolvable.

## Non-Goals

This document does not define:

- exact Module Manifest fields;
- domain data models, storage formats, migration protocols, or cross-Module data access;
- exact TypeScript APIs for CLI, View, and Persistence Adapters;
- sandboxing and permissions for untrusted third-party code;
- plugin hot replacement without restarting services;
- persistent user background services.

## Personalized Software Organization

### Project

A Project persists personalized software assets and their runtime history and is the Module composition boundary. It can declare multiple Module instances and record each instance’s Module version, configuration, and data namespace. A Project is not one traditional application package; it may contain a research workflow, customer list, and task board together.

### Module

A Module may contain:

- **CLI**: deterministic operations for Agents;
- **View**: interactions and visualization for Humans;
- **domain and data capabilities**: Domain, Application, and Persistence Adapter shared by CLI and View.

These capabilities appear progressively. A View-only prototype is valid; deterministic execution and persistent state can be added when needed.

Memory remains a Project-level semantic asset managed by the existing Memory Store, Catalog, ChangeSet, and Run systems. It may independently form personalized software or describe a Module’s knowledge and procedures, but it does not enter the Module directory, Manifest, or packaging lifecycle.

### Module Instance

A Module is a code and asset definition; a Module instance is one configured use of it by a Project. The same version installs once but may have multiple instances, such as “customer list” and “task list,” each with a stable ID, isolated configuration, and isolated data namespace.

Modules may declare dependencies and extend one another through public contracts. Code dependencies belong to the Module; instance selection and configuration belong to the Project.

### Memsphere View and Module View

Memsphere View is the Home-level management interface for Projects, Memory, Run, and other platform capabilities. Module View is a personalized software interface for Humans. They share ViewHost and one product Shell but are distinct product concepts. Built-in Memory and Run interfaces should also enter through built-in Module Views instead of privileged business UI.

The base Shell, Project switching, and failure diagnostics belong to ViewHost and cannot be replaced by Modules.

### Current View Implementation

The repository currently implements four builtin Modules along these boundaries:

```text
modules/
├── org.memsphere.memory/{module.json,adapter/view/}
├── org.memsphere.run/{module.json,adapter/view/}
└── org.memsphere.settings/{module.json,adapter/view/}
```

Build produces `dist/modules/<module-id>/dist/view/index.js` independently for each Module; no Legacy Bundle aggregates the three business interfaces. Core's builtin catalog declares only trusted package roots, instances, and reserved route grants. All three Modules pass through the same Manifest validation, SDK compatibility check, Bundle import, instance Context, `apply()` transaction, and Slot/Route commit.

ViewHost currently wires Router, the root Slot Catalog, the Stable Shell, Home, and shared overlay support. One failed instance produces a local diagnostic, and Project switching may reconstruct the complete page. The authoritative Slot list, product semantics, and current wiring status are maintained in the [Memsphere View Slot List](./view-slots.en.md). User Module repository discovery/installation, dynamic Project Composition, custom child Slots, the CLI Module Host, and backend domain-directory migration remain unimplemented.

## Three-Layer Module Structure

Modules use three concentric layers: Domain, Application, and Adapter. The Memsphere repository separates Core from built-in Modules:

```text
memsphere/
├── src/                         # Memsphere Core
└── modules/                     # built-in Modules shipped with Memsphere
    └── <module-id>/
```

`modules/` is a collection, not an architectural layer. Built-in and user Modules use the same structure, Manifest, and Host protocols; only distribution differs.

```text
module/
├── module.json                  # described by the Module Manifest contract
├── domain/                      # domain models, rules, and domain-owned contracts
├── application/                 # use-case orchestration and application-owned contracts
└── adapter/                     # outer adapters
    ├── cli/                     # deterministic Agent entrypoint
    ├── view/                    # Human UI, assets, and View API entrypoint
    └── persistence/             # file, database, or remote storage implementation
```

Directories appear only when their capability exists. `cli`, `view`, and `persistence` are Adapter categories, not new layers.

### Domain

Domain contains models and business rules independent of UI, CLI, and storage technology. Contracts owned by domain requirements, such as Repositories or domain services, live here.

### Application

Application composes Domain capabilities into executable use cases and owns transaction boundaries, authorization checks, and cross-domain coordination. CLI and View use the same use cases. A contract serving an application use case rather than the domain is defined here.

### Adapter

Adapters connect the Module to the external world:

- CLI Adapter translates deterministic Agent commands into Application calls.
- View Adapter translates Human interactions into Application calls and browser UI.
- Persistence Adapter implements Domain- or Application-owned persistence contracts.

Browser Bundles cannot import Node.js-only Application and Domain code directly. A View Adapter may therefore include a separately compiled browser UI and a Node.js HTTP/API entrypoint.

```text
Agent → CLI Adapter → Application → Domain → Persistence Adapter → data
Human → Browser View Bundle → View API Adapter → Application → Domain
      → Persistence Adapter → the same data
```

Browsers never access databases directly, and CLI and View never maintain separate business state.

### Dependency Direction and Contract Ownership

Static dependencies point inward:

```text
adapter → application → domain
```

Dependency inversion does not require a `ports/` directory. The inner layer that owns a need owns its contract:

- Domain owns Domain–Application boundary contracts.
- Application owns use-case contracts exposed to CLI and View.
- Persistence contracts live in Domain or Application according to the requirement owner.
- Adapters cannot require inner layers to implement adapter-owned business interfaces.

A Port is a boundary contract, not a fourth layer. An anti-corruption layer translates external and internal models, normally belongs to an Adapter, and is not itself a Port.

## Runtime Structure

```text
Memsphere
├── Module Composition Resolver
├── CLI Host
└── ViewHost
    ├── Boot Page
    ├── Stable Shell
    ├── Bundle Loader
    ├── Slot Registry / Renderer
    ├── View SDK
    └── Failure Boundary

Project
├── Memory
├── Module Instance A
│   ├── CLI Adapter
│   ├── View Adapter
│   └── Domain / Application / Persistence
├── Module Instance B
└── Module Instance C
```

The Composition Resolver derives Module versions, dependencies, instance configuration, and data namespaces from Project declarations. CLI Host and ViewHost consume the same result but may have different process lifecycles.

Core execution occurs in Agents; View is a reconstructible auxiliary entrypoint. Restarting View must not interrupt Agent tasks, and authoritative Module state cannot live only in the View process.

## ViewHost and Slots

### ViewHost

ViewHost is the minimal browser runtime supplied by Memsphere. It owns the boot page and Stable Shell, resolves the Project’s Module composition, loads independently compiled View Bundles, composes the Slot registry, supplies the public SDK, isolates failures, and supports browser recovery after restart. It does not contain Memory- or Run-specific business features; built-in Module View Adapters provide them.

### Slot

A Slot is an explicitly opened UI extension point and a contract between ViewHost and Modules or between Modules. The owner defines position, input, and composition rules. A Module may declare child Slots inside its own UI, producing an extensible tree.

```text
ViewHost
├── Header Slots
├── Navigation Slots
├── Home Slots
├── Main View Slot
├── Overlay Slot
└── Module-declared child Slots
```

See [View Slot List](./view-slots.en.md), [View Plugin Design](./view-plugin-design.en.md), and [View Plugin API](./view-plugin-api.en.md).

## Compilation and Loading

Memsphere and user Modules always compile separately:

```text
Memsphere release → Module Host + CLI Host + ViewHost + SDK
User Module       → independently compiled Node.js runtime
                  → independently compiled browser Bundle, if any
                  → install Module
                  → declare Module instances in a Project
                  → resolve and load on Host startup
```

Production never jointly compiles user source with Memsphere. Development tools may watch and compile only the relevant Module. The View protocol is framework-neutral; official tooling may prioritize React and TypeScript, while Modules carry their own browser framework and depend only on the stable View SDK.

## Installation and Project Composition

Installation and enablement are distinct:

- public Modules may install in a user-level repository shared by Projects;
- a Project records enabled Modules, instances, exact versions, and configurations;
- local Modules under development travel with their Project;
- built-in Modules live under repository-root `modules/` and ship with Memsphere;
- Projects lock public Module versions and report missing dependencies;
- upgrades are explicit and do not silently change existing Projects;
- one installed Module version may create multiple isolated instances.

A prototype uses the production Module structure from creation and can add Domain, Application, CLI, or Persistence in place.

## Runtime and Restart Model

Memsphere uses reconstructible startup, not plugin hot replacement:

```text
Start Host → read Project composition → resolve Modules and instances
           → load runtime pieces → register CLI and View → create instances

Update Module → recompile → restart relevant service → refresh browser
              → reconstruct from the same Project composition
```

Switching Projects may perform a full-page reload. View components still support normal mount and unmount to release DOM events and resources; this is a UI lifecycle, not a hot-plugin lifecycle.

## Statelessness and Data Boundary

ViewHost and Module View Adapters are disposable interaction runtimes. URLs store the current Module, instance, and page. Browsers refresh after service restart. Transient UI state and unsubmitted drafts may be lost. Persistent data must pass through Application, Domain, and Persistence Adapter, and CLI and View operations for one instance must use the same namespace.

## Failure Handling

A missing, incompatible, or failing Module disables only that Module. Slot conflicts identify the Module, instance, and Slot. Failure boundaries protect Shell and healthy Modules. Dependent Modules may also be disabled but never enter a silent partial-start state. Persistence failures must be explicit.

## Trust and Style

The current trust model loads code written by the user or explicitly installed as trusted and does not sandbox unknown malicious code. Trusted Modules still use only public Host, SDK, Slot, and version contracts.

Memsphere supplies theme variables and standard UI capabilities without forcing one visual style. Module styles must not pollute Host or other Modules; the View SDK and frontend implementation define the isolation mechanism.

## Specialized Contracts

This architecture is refined by separate contracts for Module Manifest, Module Runtime, Project Composition, View SDK, CLI SDK, Persistence, development tooling, and third-party distribution. None may require user Modules to depend on private Memsphere source, use joint compilation as an extension prerequisite, or let CLI, View, or Persistence bypass Application and Domain to form independent business logic.
