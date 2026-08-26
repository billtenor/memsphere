# Memsphere

[简体中文](README.md) | English

> A runtime environment for personalized software in the AI era

Software no longer has to begin with code.

Memsphere lets software begin in natural language, then grow through use into personalized software that is reusable, verifiable, manageable, and continuously evolvable.

Here, personalized software is not limited to individuals. It is built around the real needs of a particular person, team, organization, or industry, and it evolves as those needs change.

Memsphere is not another Agent. It is designed to run on top of different general-purpose Agents, providing personalized software with a relatively stable language, runtime environment, and way to manage software assets. No matter which model or Agent runs underneath, the capabilities accumulated by users and organizations should not be locked inside a single conversation or product.

## 1. Why Memsphere Exists

Traditional computers abstract hardware such as CPUs and GPUs into general computing resources. Operating systems then organize those resources into an environment where software can run.

In the AI era, LLMs are becoming a new form of standardized computing power. They understand intent, process meaning, generate solutions, and use tools, while users do not need to know whether those capabilities ultimately run on GPUs, CPUs, NPUs, or other hardware. General-purpose Agents built on LLMs are beginning to play a role similar to an operating system: they understand goals, read context, invoke tools, and get work done.

But computing power and an Agent are still not software.

Traditional software is expensive to build. Professional teams abstract many individual needs into a smaller set of common requirements, then iterate on products that serve as many people as possible. Long-tail needs that do not survive this abstraction are usually handled with spreadsheets, formulas, scripts, and manual processes.

LLMs change these economics. Someone can describe a task in one sentence and ask an Agent to perform it immediately. When the need changes, they can change the description. When the task repeats, its method can be retained. Software no longer has to begin with code; it can begin with natural language.

The problem is that a Prompt alone is not yet software you can rely on over time. It usually lacks:

- stable semantics and rules;
- reusable execution processes;
- verifiable inputs, outputs, and intermediate results;
- persistent data and documents;
- deterministic tools and visual interfaces;
- mechanisms for portability across Agents, versioning, and continuous evolution.

Memsphere aims to provide this missing layer.

## 2. From Prompt to Skill to Memsphere

Personalized software often begins with a Prompt. It expresses an immediate intent and asks an Agent to complete one task.

When the same kind of work repeats, its method can be organized as a Skill. A Skill packages instructions, scripts, and references so that an Agent can discover, install, and reuse a focused capability with clear boundaries. The [Agent Skills open specification](https://agentskills.io/specification) is making this form of software portable across different Agents.

As the need continues to grow, a Skill may need to retain long-term knowledge, invoke more deterministic tools, manage continuously generated data, provide interfaces for direct interaction, and record and verify every run. Memsphere provides a unified organization and runtime environment for these richer, more complex software needs.

| Form | Best suited for |
| --- | --- |
| Prompt | Expressing one intent and completing the current task |
| Skill | Organizing a focused, clearly bounded, reusable capability |
| Memsphere | Organizing personalized software that must run over time, remain managed, and keep evolving |

This is not a path that every capability must complete. For many simple cases, a Skill is already enough and does not need to become more complex. Memsphere becomes useful when a capability genuinely needs Memory, CLI, data, and interfaces to work together.

Skill and Memsphere are not replacements for one another. In a shared Agent execution environment, a Skill can invoke software defined in Memsphere, and software in Memsphere can invoke capabilities provided by Skills. Together, they enrich the software ecosystem of Agent operating systems.

## 3. Where Memsphere Fits

~~~text
┌──────────────────────────────────────────────┐
│            Personalized software             │
├──────────────────────────────────────────────┤
│  Memsphere: language, runtime, asset mgmt.    │
├──────────────────────────────────────────────┤
│  General Agent: intent, planning, execution   │
├──────────────────────────────────────────────┤
│  LLM: semantic computing and intelligence     │
├──────────────────────────────────────────────┤
│  CPU / GPU / NPU / cloud and other hardware  │
└──────────────────────────────────────────────┘
~~~

The Agent is responsible for understanding and execution. Memsphere is responsible for giving the knowledge, rules, processes, tools, data, and interfaces required by software a stable organization and lifecycle.

This distinction matters: Memsphere is not an Agent, and it should not be tied to any one Agent. Its goal is to preserve a portable layer of software assets that can accumulate over time in a diverse Agent ecosystem.

## 4. Software That Grows

Memsphere is planned to manage four kinds of assets that work together:

~~~mermaid
flowchart TB
    H["Human"]
    A["General-purpose Agent"]

    subgraph S["One personalized software system"]
        direction TB
        M["Memory<br/>Agent entry: knowledge, rules, structures, and processes"]
        C["CLI<br/>deterministic tools"]
        I["Interface<br/>human entry: operations and visualization"]
        D[("Data<br/>shared foundation for CLI and Interface")]

        M -.->|"guides Agent invocation"| C
        C <-->|"read and write"| D
        I <-->|"query, operate, and display"| D
    end

    H <-->|"natural language"| A
    A -->|"read and follow"| M
    H <-->|"operate and inspect"| I
~~~

Each asset has a different responsibility:

| Asset | Role | How it evolves |
| --- | --- | --- |
| Memory | Serves as the Agent's entry into the software and preserves the knowledge, rules, structures, and processes through which it understands the world, makes decisions, and completes work | Grows from natural-language descriptions into a readable, verifiable semantic model |
| CLI | Encapsulates deterministic tools for Agents | Distills steps repeatedly performed by an Agent into code and commands |
| Data | Serves as the shared foundation for CLI tools and interfaces, preserving the structured data, files, and document collections continuously produced and used by software | Grows from scattered context into bounded, structured, queryable data assets |
| Interface | Serves as the human entry into the software, providing operations and visualization | Grows from natural-language-driven interaction into stable operational and presentation interfaces |

This creates two entry points and one shared foundation. An Agent enters the software through Memory, understands and follows its knowledge, rules, and processes, and then invokes CLI tools for deterministic work. A person enters through an interface to operate the software and inspect results. People interact directly with the interface, not with the underlying data; the interface then queries, presents, or modifies that data. Data supports both CLI tools and interfaces, keeping deterministic execution and human operations grounded in the same software state.

None of these assets must exist in full on the first day of a software system.

For example, a personal research assistant might begin with one sentence: “Every day, summarize new papers in the fields I follow and tell me which ones are worth reading.” Through repeated use, it can gradually develop selection criteria and research processes, accumulate papers and notes, gain CLI tools for search, deduplication, and format conversion, and eventually provide an interface for browsing, annotating, and comparing research.

In this process, the user does not design a complete system before using it. Natural language is gradually distilled into stable assets through real use.

## 5. Two Kinds of Computing Power, Working Together

LLM Token-based computing is well suited to meaning, ambiguity, judgment, and change. Traditional CPU and GPU computing is better suited to deterministic, repetitive, and mechanical work.

One of Memsphere's core directions is therefore:

> Reserve Tokens for the parts that genuinely require understanding and judgment. Give established, deterministic work to the CLI.

But this transition should not depend entirely on users noticing and driving it themselves. Memsphere will also provide a set of built-in meta-memories. They do not perform specific business tasks directly. Instead, they guide an Agent to observe how personalized software actually runs, identify repeated steps with clear boundaries that are suitable for deterministic execution, and help the user develop, validate, and distill those steps into personalized CLI tools.

The collaboration between the two kinds of computing power is therefore not a one-time manual refactor, but part of the software's continuous evolution. Early on, the software relies more heavily on Token-based computing to explore, understand, and adapt to requirements. As experience accumulates, meta-memory guides the Agent to move stable parts into CLI tools executed by traditional computing resources, while Token-based computing remains focused on new, uncertain work that genuinely requires judgment.

Once a set of steps has been distilled into code, the Agent can select and invoke a command with much less context instead of reasoning through every detail again. This improves stability, reduces Token consumption, and returns work to the traditional computing resources best suited to perform it.

The CLI is therefore not primarily a collection of commands for humans. It is a software capability layer designed first for Agents.

## 6. Quick Start

### 6.1 Requirements

- Node.js 20 or later;
- Git;
- an Agent that can use Skills and terminal commands.

Windows users need to install [Git for Windows](https://git-scm.com/download/win) and ensure that git is available on PATH. Reopen PowerShell, CMD, Git Bash, or another supported shell after installation. Memsphere does not require Git Bash to run.

### 6.2 Ask an Agent to Install Memsphere and Start the Tutorial (Recommended)

Memsphere is designed for Agents, so installation, initialization, and Project setup are best delegated to an Agent as well. First, have the Agent enter the working directory where you want to use Memsphere, then send it this entire prompt:

~~~text
Install and configure Memsphere in the current working directory. Perform all required terminal operations yourself:

1. Check that Node.js 20 or later and Git are available. If a prerequisite is missing, tell me clearly what I need to install.
2. Run npm install -g memsphere, then run memsphere skill init --global.
3. Read and follow the Memsphere Skill you just installed. If this session does not automatically refresh its Skill list, read SKILL.md directly from the location reported by the installation command and continue this task; do not ask me to open a new session solely for that reason.
4. Check whether the current directory is already bound to a Project. Reuse an existing binding. If it is not bound, ask whether I want a Managed Project or an Embedded Project. If I am unsure, recommend and create a Managed Project, then bind this directory.
5. Run memsphere project show and memsphere validate, and resolve any installation or configuration issues you can handle.
6. After setup succeeds, do not stop with a summary. Immediately use memsphere to discover and read the complete memsphere-tutorial-chapter-01 Procedure, start a named Run, and begin the tutorial by following the current step returned by the Run.

Pause only when you genuinely need me to choose a Project type, grant permission, or complete a human step.
~~~

The goal of this prompt is not merely to install Memsphere. It tells the Agent to continue into the first tutorial chapter in the same task. Once the tutorial begins, the Agent performs the steps it can handle and pauses with clear instructions when your action or decision is required.

### 6.3 Installation Command Reference

These are the core installation commands the Agent will run. You can also run them manually when troubleshooting installation:

~~~bash
npm install -g memsphere
~~~

Install the Memsphere Skill globally so that your Agent can discover it:

~~~bash
memsphere skill init --global
~~~

### 6.4 Choose and Create a Project

A Project is Memsphere's persistent space for Memory, run history, and other software assets. After you bind the current working directory to a Project, Agents can read and run that personalized software there.

Memsphere provides two kinds of Project. The most important difference is whether Memory should follow a code repository.

| Type | Where Memory lives | How changes are saved | When to choose it |
| --- | --- | --- | --- |
| Managed Project | Stored separately by Memsphere, outside the code repository | Confirmed and saved in Memsphere | Memory does not need to be committed with code |
| Embedded Project | Stored with the code in a Git repository | Committed and reviewed through Git like code | Memory needs to be maintained together with code |

If you are unsure, start with a Managed Project. Choose an Embedded Project when you explicitly want Memory to follow a code repository.

#### 6.4.1 Managed Project

Enter your working directory, then create and bind a Managed Project:

~~~bash
cd <your-project>
memsphere project create my-project --bind
~~~

`--bind` only associates the current working directory with the Project; it does not copy Memory into that directory. The Project's Memory remains available even if a temporary directory or Git worktree is deleted.

Creation automatically installs the bundled System Memory for the current version and publishes it to the Managed Store through the initial controlled ChangeSet.

When you edit Managed Memory, Memsphere creates a ChangeSet. Validate the completed edit before publishing it:

~~~bash
memsphere memory edit concepts/example
memsphere memory change validate <change-id>
memsphere memory publish --change <change-id>
~~~

#### 6.4.2 Embedded Project

To keep Memory and code in the same Git repository, create and bind an Embedded Project:

~~~bash
cd <your-git-repository>
memsphere project create my-project --embedded .memsphere/memory --bind
~~~

Here, `.memsphere/memory` is the Memory directory inside the repository. Creation automatically installs the bundled System Memory as file changes in the current worktree that can be reviewed with Git; Memsphere does not stage or commit them. When an Agent works in different Git worktrees, it reads and edits the version of Memory in the current worktree.

Validate changes with Memsphere, then commit them through your normal Git workflow:

~~~bash
memsphere memory edit concepts/example
memsphere memory change validate
git add .memsphere/memory
git commit -m "Update Memory"
~~~

Embedded Memory does not use `memsphere memory publish`; Memsphere does not commit Git changes for you.

The only exception is a `market_import` ChangeSet created from Memory Market in View. After review and validation, publish only applies the isolated candidate to the current Embedded worktree. It still does not commit or push, and the ChangeSet remains active until the change reaches the main branch.

#### 6.4.3 Memory Market

Under Memory, View provides a Current Project / Memory Market switch. Memory Market displays officially selected Memory bundled in the npm package, but bundled items are inactive by default and do not enter the current Project Catalog or any Run. Import and Re-import create a market ChangeSet; subsequent item-by-item imports in the same Project keep appending to the same active ChangeSet until it is completed or abandoned. The user inspects the combined candidate in that ChangeSet and decides whether to publish or apply it.

Once imported, an item is ordinary user Memory: it can be edited or renamed and does not update automatically with the npm package. View associates the two copies only by the current `<kind>/<canonical-name>` and reports Not imported, Importing, Imported · unchanged, Imported · different, or Name conflict. Importing links directly to the active market ChangeSet. Renaming ends the association. Renaming a bundled item is equivalent to removing the old item and adding a new one. Re-import replaces the same-name Memory with current bundled content and includes only referenced market dependencies missing from the Project; existing dependencies are not overwritten.

### 6.5 Validate the Project and Start View

Inspect the currently bound Project and validate its Memory:

~~~bash
memsphere project show
memsphere validate
~~~

Start the local View:

~~~bash
memsphere view start
~~~

#### Repair or Upgrade System Memory

To install missing System Memory, restore it, or upgrade it to the bundled version in an existing Managed or Embedded Project, run repair. System Memory marked as retired by the current manifest v4 (with v3 compatibility) is removed by default, but only when both its historical path and canonical identity match. User Memory and Mounted Projects are not touched:

~~~bash
memsphere project repair my-project
# You can also select the Project globally, or omit the name to use the current Primary Project
memsphere --project my-project project repair
~~~

Managed repair creates a controlled ChangeSet, validates the complete effective Memory, and publishes it automatically. A no-op repair creates no ChangeSet or Revision. If a failure occurs after ChangeSet creation, Memsphere preserves a read-only `abandoned` record with failure diagnostics and removes the Workspace candidate.

Embedded repair uses the effective Memory Root in the Git worktree where the command runs. It refuses to overwrite uncommitted changes on planned targets, validates the complete candidate Store in a temporary directory, and writes validated System Memory differences back to the current worktree. It does not commit, push, or perform a Managed publish. Review the result with an ordinary `git diff` and integrate it through the repository's normal workflow. Running it in a linked worktree does not modify the main worktree; a no-op repair writes nothing.

### 6.6 Discover and Read Memory

List all Memory visible to the current Project, or list only Procedures:

~~~bash
memsphere memory list
memsphere memory list --kind procedures
~~~

The list is for discovering candidates. After selecting one, read the complete Memory:

~~~bash
memsphere memory read <reference>
~~~

### 6.7 Run Your First Procedure

After reading the target Procedure, start a named Run:

~~~bash
memsphere run start <procedure-name> --name "<run-name>"
~~~

Every step in a Run explicitly asks for an Artifact. The Agent reports results through `run report`; Memsphere validates them, records state, and enters Review when required.

You can also enter the following in a new Agent session:

~~~text
Use memsphere to start memsphere-tutorial-chapter-01.
~~~

The Agent will discover and read the applicable Procedure, create a Run, and advance through its steps.

## 7. Memsphere Is Still Evolving

The sections above describe the complete direction Memsphere is working toward. We are beginning with the most important foundation and turning that direction into reality one step at a time.

The current version starts with Memory because any long-lived software needs a semantic foundation that an Agent can read and follow accurately.

Memsphere currently supports four kinds of Memory:

| Type | Question it answers |
| --- | --- |
| Concept | “What is it?” — defines concepts, boundaries, and relationships within a Project |
| Statement | “What must be true?” — preserves facts, principles, constraints, and rules |
| Schema | “What does a valid result look like?” — defines values, fields, and delivery contracts |
| Procedure | “How is this done?” — defines executable, verifiable, reusable processes |

Together, these four types form the semantic part of software. Concept gives the Agent the right understanding. Statement constrains decisions. Schema constrains results. Procedure organizes execution.

The current version also provides:

- **Project**: organizes persistent or repository-managed Memory and binds it to a working directory;
- **Run**: turns a Procedure into a named, stateful execution;
- **Artifact**: preserves each step's deliverable and validates it against a Schema;
- **Review**: lets people or Agents review Run artifacts;
- **ChangeSet**: safely edits, validates, and publishes Memory changes;
- **View**: locally browses Memory, Runs, Reviews, and changes;
- **Skill integration**: lets compatible Agents discover Memsphere and work according to Project Memory.

Memsphere is still at an early stage. These capabilities are the first foundation of the larger vision, not the destination. CLI, data, and interfaces are the next areas that need to become first-class assets.

Memsphere will continue to expand according to the same principles:

- let stable steps be distilled into CLI tools designed for Agents;
- turn data and documents produced by Runs into managed data assets;
- give capabilities that require direct human interaction interfaces that can be generated and maintained;
- let these assets begin in natural language and gradually become structured through use;
- let the same personalized software continue to run across different models and Agents.

Our goal is not to turn everyone into a programmer in the traditional sense. It is to let every person and every organization own software that truly fits them.

## 8. Development

~~~bash
git clone https://github.com/billtenor/memsphere.git
cd memsphere
npm install
npm run build
npm test
~~~

Read [CONTRIBUTING.md](CONTRIBUTING.md) before contributing. For security issues, see [SECURITY.md](SECURITY.md).

## 9. License

Memsphere is licensed under the Apache License 2.0. See [LICENSE](LICENSE) for details.
