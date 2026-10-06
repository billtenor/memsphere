# Memsphere Architecture

[简体中文](./architecture.md) | English

This document records Memsphere’s long-term architectural baseline. It describes Memsphere’s position in the Agent ecosystem; the boundary between the platform core and personalized software; how Projects, Apps, and their components are organized; the code layers; and how CLI, View, and data capabilities collaborate. It does not require every detail to be implemented in one release.

See [App Design](./app-design.en.md) for business feature composition, [Data Layer Design (Chinese)](./data-layer-design.md) for data protocols and extensions, and [View Plugin Design](./view-plugin-design.en.md) for frontend extension mechanisms.

## System Positioning

Memsphere is a personalized software runtime built on general-purpose Agents. Agents understand intent, reason, and execute. Memsphere organizes, runs, and manages software assets that accumulate across conversations, models, and Agents.

Humans and Agents enter the same personalized software through different adapters:

```text
Human → Memsphere View → Module (View Module)
Agent → Memory → CLI (standalone tool or CLI Adapter)

View / CLI → Application → Domain → Persistence Adapter
           → authoritative Project data
```

Memory, CLI, data, and UI are four kinds of assets that personalized software may grow over time. They need not all exist at creation. An App organizes capabilities around a complete business feature and declares how they connect. Memory can be an App's own asset, delivered and evolved with that App. A Project installs and combines multiple Apps, containing both their owned Memory and Memory not yet organized into any App. A CLI may be an external standalone tool; it need not be implemented as a Memsphere plugin.

## System Boundaries

### Memsphere Core

Core is the stable platform shipped with Memsphere. It owns:

- Home, Registry, Workspace Binding, and Project resolution;
- Memory discovery, reading, editing, and validation;
- Procedure Run, Artifact, Review, ChangeSet, and Archive;
- App and component discovery, installation, asset ownership management, dependency resolution, instance composition, and lifecycle boundaries;
- CLI registration and environment binding, ViewHost, data extension composition, and public SDKs;
- failure isolation, configuration management, and stable system entrypoints.

Core provides runtime mechanisms and does not contain business rules specific to one personalized software product.

### Project

A Project is a project and persistent space larger than an App. It combines multiple installed Apps and also contains Memory not yet organized into Apps, run records, and authoritative data. Project provides unified Memory discovery, reading, validation, and Run capabilities while preserving each Memory asset's App ownership. A Workspace must bind a Project before Agents and Humans can use that Project’s software in the current work context.

### App and Components

An App is an independent collection of plugins and assets organized around a complete business feature. It directly composes Modules, Models, DataExtensions, CLI registrations, and its own Memory, and may declare dependencies on other Apps' assets. These components need not occupy one physical package. Built-in and user capabilities should use the same extension mechanisms.

Module means View Module: an interface module that can be developed, loaded, and composed independently. App owns complete software composition and management; Models, DataExtensions, and CLIs are peer components alongside Modules.

```text
Memsphere Core
├── Memory / Run / Review / ChangeSet Runtime
├── App Composition Runtime
├── CLI Registry / Environment Binding
└── ViewHost

Home
└── Acquisition and caching of reusable App packages and components

Project
├── Installed App A
│   ├── Module / Model / DataExtension / CLI
│   └── Memory owned by App A
├── Installed App B
│   ├── Components selected as needed
│   └── Memory owned by App B
├── Unorganized Memory (not owned by any App)
├── Run / Review / ChangeSet / Archive
└── authoritative data bound to App instances
```

## Personalized Software and Apps

Software no longer has to be packaged as one traditional application or begin with complete code. A programmatic Memory can be software on its own, as can an interaction-only interface. It may later grow deterministic tools, domain logic, and persistent data.

Memsphere introduces **App** so complete business features can be composed and evolved independently. A Project may install and enable multiple Apps; each organizes components supplied by Memsphere or users. A CLI-only, View-only, or Memory-only App is valid when it fulfills its business purpose. App-owned Memory is delivered with the App and falls within its versioning and upgrade scope. Project manages its use through unified mechanisms while preserving ownership.

Memory may help Agents discover registered CLIs, while Humans operate the software through View Modules. CLI and View operations for the same business capability reuse Application and Domain through public business interfaces and share authoritative data. An external CLI requires explicit integration with those interfaces and Project data; registration alone does not establish the connection.

User code does not enter Memsphere source code and does not require recompiling a released Memsphere. Memsphere stabilizes Host, SDK, and composition protocols; components are developed and released independently, then connected through App configuration in a Project.

## Architectural Goals

- Core contains reusable platform mechanisms; Apps compose existing extension points into business features.
- Project is the common project boundary for multiple Apps, their owned Memory, unorganized Memory, runs, and authoritative data.
- A Project may install multiple Apps and enable them separately; initially each App has one installation per Project, while View Modules retain support for multiple instances.
- Apps may grow their own Memory, CLI, View, and data capabilities as needed without empty placeholders.
- Project unifies Memory reading, validation, and execution while preserving App ownership and cross-App dependencies; unorganized Memory can later be explicitly incorporated into an App.
- Built-in and user Modules use the same discovery, loading, and composition mechanism.
- CLI is the deterministic Agent entrypoint and may run independently of Memsphere; View is the Human interaction and observation entrypoint.
- CLI and View reuse Application and Domain and share authoritative data.
- Users independently develop, compile, install, and compose Modules without rebuilding Memsphere.
- A Module may contribute complete pages or extend explicit local UI extension points of another Module.
- UI prototypes and production Modules share one structure and can evolve into production interfaces in place.
- View is stateless, restartable, and reconstructed from Project configuration and persistent data.
- Failure of one user Module leaves the base Shell and healthy Modules available.
- Projects and personalized software assets remain portable, reproducible, and evolvable.

## Non-Goals

This document does not define:

- exact App Manifest, CLI registration, and Module Manifest fields;
- App Memory paths, owner metadata, namespaces, merging Project-local edits with upgrades, or asset disposition during uninstall;
- domain data models, storage formats, migration protocols, or cross-App data access;
- exact TypeScript APIs for CLI, View, and Persistence Adapters;
- sandboxing and permissions for untrusted third-party code;
- plugin hot replacement without restarting services;
- persistent user background services.

## Personalized Software Organization

### Project

A Project combines installed Apps and persists software assets, unorganized Memory, and runtime history. Installing an App in a Project establishes its assets and ownership and records its installed version, configuration, environment, and data bindings. Enabling the App establishes its runtime entrypoints. A Project is not one traditional application package: it may contain a research workflow, customer list, and task board together, alongside Memory not owned by any App. A unified Catalog, store, or Run entrypoint does not make all Memory exclusively owned by Project.

### App Definition and App Instance

An App definition declares stable identity, version, owned assets, components, dependencies, and collaboration contracts, and may span multiple packages. An App instance is a concrete installation of that definition in a Project, with its own configuration, asset ownership, and enablement state. Initially each App has one installation per Project; it may reference multiple View Module instances.

### Memory Ownership and Lifecycle

App Memory is delivered with the App and included in its versioning and upgrade scope. Project provides unified reading, validation, editing, and Run management for both App-owned and unorganized Memory. Existing ChangeSet and Run mechanisms continue to govern controlled edits and execution records; their integration with App upgrades requires a specialized contract. Unified storage and operations do not replace App ownership.

Logical references support addressing and dependencies. An App may depend on another App's Memory without acquiring ownership through reference or use. Unorganized Memory may be explicitly incorporated into an App; matching names, references, or use do not assign ownership automatically.

Disabling an App removes runtime entrypoints while retaining installed assets and their App ownership. Uninstalling an App must address asset dependencies and Project-local modifications and preserve existing Run snapshots. Asset retention, deletion, and migration policies remain to be defined; neither deleting Memory nor turning it into unorganized Memory is automatic.

The [App contract](./app-contract.en.md) specifies local installation paths, ownership, and checkpoints. Upgrade merging, uninstall disposition, and ownership migration remain future work.

### Modules and Other Components

A Module is a View Module that can be developed, installed, loaded, and composed independently. It provides interface capabilities:

- pages and routes;
- contributions to public Slots and Slots opened within its own interface;
- interactions, presentation logic, and view state.

A Module may organize a group of related interfaces, rather than just one page, or contribute only local UI. CLI, Model, and DataExtension are separate components referenced directly by App, not sub-capabilities of a Module. When backend business rules are needed, a Module accesses independent shared libraries or services through business interfaces.

Models define business data structures. DataExtensions supply pluggable model interpretation, serialization, and storage implementations. CLI registration describes stable tool identity, purpose, command entrypoint, help, and version requirements; local paths and environment settings belong to concrete bindings. Discovery, availability checks, and execution are separate steps: registration does not mean a tool is installed or configured.

### Module Instance

A Module defines interface code and assets; a Module instance is one concrete use of that interface in a Project context. The same version installs once but may have multiple view instances, such as “customer list” and “task list.” Each instance has a stable ID, independent View Context, UI configuration, and registration scope. App and Project own business data bindings; Module instances consume the supplied business context rather than defining authoritative data namespaces.

Modules may declare UI dependencies and extend one another through public Slots and other contracts. UI dependencies belong to Modules; instance selection and configuration are part of App composition in a Project. App declares business dependencies and data bindings.

### Memsphere View and Module View

Memsphere View is the Home-level management interface for Projects, Memory, Run, and other platform capabilities. Module View is a personalized software interface for Humans. They share ViewHost and one product Shell but are distinct product concepts. Built-in Memory and Run interfaces should also enter as built-in Modules instead of privileged business UI.

The base Shell, Project switching, and failure diagnostics belong to ViewHost and cannot be replaced by Modules.

### Current Implementation and Target Design

The repository currently implements six builtin View Modules:

```text
modules/
├── org.memsphere.memory/{module.json,adapter/view/}
├── org.memsphere.run/{module.json,adapter/view/}
├── org.memsphere.models/{module.json,adapter/view/}
├── org.memsphere.model-prototype/{module.json,adapter/view/}
├── org.memsphere.reference/{module.json,adapter/view/}
└── org.memsphere.settings/{module.json,adapter/view/}
```

Build produces `dist/modules/<module-id>/dist/view/index.js` independently for each Module; no Legacy Bundle aggregates the business interfaces. Core's builtin catalog declares only trusted package roots, instances, and reserved route grants. Built-in and trusted local packages pass through the same Manifest validation, SDK compatibility check, Bundle import, instance Context, `apply()` transaction, and Slot/Route commit.

ViewHost currently wires Router, the Slot Catalog, the Stable Shell, Home, and shared overlay support. One failed instance produces a local diagnostic, and Project switching may reconstruct the complete page. Trusted local View package installation and Home-level configuration are implemented: Home theme, Slot selections, and package composition apply across Projects, with a fixed snapshot at service startup. See the [Memsphere View Slot List](./view-slots.en.md) for authoritative Slot semantics and wiring status.

Project App installations now compose Model Packages, DataExtensions, Stores, View Modules, and business operations. CLI registration/binding supports direct external tools; App-owned Memory is installed through ChangeSets with ownership retained. See the [implementation contract](./app-contract.en.md) and [installation guide](./app-guide.en.md). Upgrades, uninstall, and existing-asset migration remain future work.

## Module Interface Code Organization

The Memsphere repository separates Core from built-in Modules:

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
├── adapter/view/                # pages, routes, Slots, interactions, and UI assets
└── dist/view/index.js           # independently compiled browser entrypoint
```

`adapter/view/` contains the Module's interface implementation; App composes CLI, backend business logic, and persistence implementations independently.

## Three-Layer Business Implementation Structure

Business implementations use three concentric layers: Domain, Application, and Adapter. App is the composition and management unit for a business feature; Application is the code layer that orchestrates use cases. Business logic shared by Modules and CLIs lives in independent libraries or services, outside the Module.

The following layout illustrates business code layers only. It does not define a new registered entity, mandatory directory structure, or package format:

```text
business-implementation/
├── domain/                      # domain models, rules, and domain-owned contracts
├── application/                 # use-case orchestration and application-owned contracts
└── adapter/                     # outer adapters
    ├── cli/                     # deterministic Agent entrypoint
    ├── api/                     # server-side business interfaces for Modules and external CLIs
    └── persistence/             # file, database, or remote storage implementation
```

Directories appear only when their capability exists. CLI, business API, and Persistence are Adapter categories, not new layers. Shared libraries, services, and interfaces may be organized according to engineering needs; sharing a repository or distribution package does not merge their responsibilities.

### Domain

Domain contains models and business rules independent of UI, CLI, and storage technology. Contracts owned by domain requirements, such as Repositories or domain services, live here.

### Application

Application composes Domain capabilities into executable use cases and owns transaction boundaries, authorization checks, and cross-domain coordination. CLI and View use the same use cases. A contract serving an application use case rather than the domain is defined here.

### Adapter

Adapters connect business implementations to the external world:

- CLI Adapter translates deterministic Agent commands into Application calls.
- Business API Adapter translates requests from Modules or external CLIs into Application calls; the Module handles UI interaction and result presentation.
- Persistence Adapter implements Domain- or Application-owned persistence contracts.

Module browser Bundles cannot import Node.js-only Application and Domain code directly. A server-side HTTP/API entrypoint belongs to the business implementation, independently of the Module’s browser entrypoint. Standalone CLIs may use that API or a shared business library.

```text
Agent → CLI Adapter → Application → Domain → Persistence Adapter → data
Human → Module Browser Bundle → Business API Adapter → Application → Domain
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

## App and Component Runtime Structure

```text
Memsphere
├── App Composition Resolver
├── CLI Registry / Environment Binding
└── ViewHost
    ├── Boot Page
    ├── Stable Shell
    ├── Bundle Loader
    ├── Slot Registry / Renderer
    ├── View SDK
    └── Failure Boundary

Project
├── Installed App Instance A
│   ├── View Module instances
│   ├── CLI registrations and environment bindings
│   ├── Model / DataExtension / Store bindings
│   ├── Business interfaces → Application / Domain / Persistence
│   ├── Memory owned by App A
│   └── Dependencies on other Apps' assets
├── Installed App Instance B (including Memory owned by App B)
└── Unorganized Memory
```

The App Composition Resolver derives App versions, asset ownership, capability dependencies, instance configuration, and data bindings from Project installation and enablement state, then delegates to each capability’s Host or runtime. Project provides unified Memory reading, validation, and Run capabilities while retaining owning App identities and cross-App dependencies. View and CLI share business and data bindings. External CLIs retain independent processes and release mechanisms; Memsphere need not launch or host them.

Core execution occurs in Agents; View is a reconstructible auxiliary entrypoint. Restarting View must not interrupt Agent tasks, and authoritative business data used by an App is persisted outside the View process.

## ViewHost and Slots

### ViewHost

ViewHost is the minimal browser runtime supplied by Memsphere. It owns the boot page and Stable Shell, consumes the Project’s resolved View Module composition, loads independently compiled View Bundles, composes the Slot registry, supplies the public SDK, isolates failures, and supports browser recovery after restart. It does not contain Memory- or Run-specific interfaces; built-in Modules provide those interfaces and invoke business operations through the corresponding APIs.

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
Memsphere release → Component Hosts + CLI Registry + ViewHost + SDK
User Module       → independently compiled browser View Bundle
                  → install Module
                  → App combines Module and other assets
                  → Project installs App, then enables and configures instances as needed
                  → resolve and load on Host startup
```

Production never jointly compiles user source with Memsphere. Development tools may watch and compile only the relevant Module. CLIs, DataExtensions, and shared business libraries or services use their own build and release mechanisms and are separately referenced and connected by an App; they are not Module build outputs. The View protocol is framework-neutral; official tooling may prioritize React and TypeScript, while Modules carry their own browser framework and depend only on the stable View SDK.

## Installation and Project Composition

Acquisition, installation, and enablement are distinct stages:

- Home acquires or caches reusable App packages and components for multiple Projects; a cached package does not mean the App is installed in any Project;
- Project installs an App, establishing its assets and ownership and recording exact versions, component configurations, and data bindings; App Memory enters the Project with its owning App identity;
- Project enables an installed App, resolves runtime dependencies, and establishes CLI, Module, and other entrypoints; installation and enablement states are recorded separately;
- external CLIs retain their own installation methods, and registration does not install them;
- local Modules under development travel with their Project;
- built-in Modules live under repository-root `modules/` and ship with Memsphere;
- Projects lock resolved component versions and report missing dependencies;
- App and component upgrades are explicit and do not silently change existing Projects; App upgrades include version changes to owned Memory, while merging local modifications with upgrades remains to be defined;
- one installed Module version may create multiple instances with isolated View Contexts, configurations, and registration scopes.

Home View configuration remains global. Project App installations add enabled instances without rewriting Home selections. See the [App contract](./app-contract.en.md) for installation and ownership layout; uninstall remains future work.

A UI prototype uses the production Module structure from creation and can evolve into a production interface, lock its version, or be released independently. When the feature needs a CLI, business rules, or persistent data, its App connects those capabilities separately and binds the Module to the same business interfaces and data.

## Runtime and Restart Model

Memsphere uses reconstructible startup, not plugin hot replacement:

```text
Start Host → read installed Apps and enablement state in the Project
           → resolve Apps, asset ownership, capabilities, and data bindings
           → validate dependencies and CLI environments
           → load backend and View components as needed
           → establish App entrypoints and component instances

Update Module → recompile → restart relevant service → refresh browser
              → reconstruct from the same Project composition
```

Switching Projects may perform a full-page reload. View components still support normal mount and unmount to release DOM events and resources; this is a UI lifecycle, not a hot-plugin lifecycle.

## Statelessness and Data Boundary

ViewHost and Modules are disposable interaction runtimes. URLs store the current Module, instance, and page. Browsers refresh after service restart. Transient UI state and unsubmitted drafts may be lost. Persistent data must pass through Application, Domain, and Persistence Adapter. CLI and Module operations for the same business capability must use the corresponding shared data binding owned by App and Project. Restarting, upgrading, or replacing View preserves authoritative business data and does not interrupt core Agent tasks.

## Failure Handling

A missing, incompatible, or failing Module disables only that Module. Slot conflicts identify the Module, instance, and Slot. Failure boundaries protect Shell and healthy Modules. Dependent Modules may also be disabled but never enter a silent partial-start state. Persistence failures must be explicit.

## Trust and Style

The current trust model loads code written by the user or explicitly installed as trusted and does not sandbox unknown malicious code. Trusted Modules still use only public Host, SDK, Slot, and version contracts.

Memsphere supplies theme variables and standard UI capabilities without forcing one visual style. Module styles must not pollute Host or other Modules; the View SDK and frontend implementation define the isolation mechanism.

## Specialized Contracts

This architecture is refined by separate contracts for App definitions, owned assets, composition, Project installation, and instance binding; Module identity, compatibility, browser entrypoints, loading, instantiation, and failures; CLI registration and environment binding; View SDK; business APIs; data and persistence; development tooling; third-party distribution; and App Memory ownership, addressing, delivery, upgrades, and integration with unified Project reading, validation, ChangeSet, and Run mechanisms. Local Memory metadata is specified by the App contract; upgrade merging and uninstall remain future work.

[App Design](./app-design.en.md) owns feature identity, component relationships, App Memory ownership, Home acquisition, and Project installation and enablement. [Data Layer Design (Chinese)](./data-layer-design.md) owns Model, DataExtension, and Store contracts. [View Plugin Design](./view-plugin-design.en.md) owns UI extension mechanisms.

CLI registration does not require external tools to adopt a CLI SDK; hosted adapters alone need a corresponding Host contract. No specialized contract may require user extensions to depend on private Memsphere source, use joint compilation as an extension prerequisite, or let CLI, View, or Persistence bypass Application and Domain to implement conflicting rules for the same business operation.
