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
flowchart LR
    H["Human"]
    A["General-purpose Agent"]

    subgraph S["One personalized software system"]
        direction TB
        M["Memory<br/>knowledge, rules, structures, and processes"]
        C["CLI<br/>deterministic tools"]
        D[("Data<br/>structured data, files, and documents")]
        I["Interface<br/>operations and visualization"]

        C <-->|"read and write"| D
        I <-->|"display and operate"| D
    end

    H <-->|"natural language"| A
    A -->|"read and follow"| M
    A -->|"invoke"| C
    A <-->|"use and manage"| D
    H <-->|"direct interaction"| I
~~~

Each asset has a different responsibility:

| Asset | Role | How it evolves |
| --- | --- | --- |
| Memory | Preserves the knowledge, rules, structures, and processes through which software understands the world, makes decisions, and completes work | Grows from natural-language descriptions into a readable, verifiable semantic model |
| CLI | Encapsulates deterministic tools for Agents | Distills steps repeatedly performed by an Agent into code and commands |
| Data | Preserves content continuously produced and used by software, including structured data, files, and document collections | Grows from scattered context into bounded, structured, queryable data assets |
| Interface | Provides operations and visualization when people need to interact with data directly | Grows from natural-language-driven interaction into stable operational and presentation interfaces |

This creates two complementary paths of interaction. People can use natural language to let an Agent understand intent, follow Memory, invoke CLI tools, and work with data. When an Agent is unnecessary, they can also operate and inspect data directly through interfaces. Memory keeps the software's understanding and behavior consistent. CLI provides stable execution while saving Tokens. Data retains the results of each run. Interfaces return direct interaction to people where it belongs.

None of these assets must exist in full on the first day of a software system.

For example, a personal research assistant might begin with one sentence: “Every day, summarize new papers in the fields I follow and tell me which ones are worth reading.” Through repeated use, it can gradually develop selection criteria and research processes, accumulate papers and notes, gain CLI tools for search, deduplication, and format conversion, and eventually provide an interface for browsing, annotating, and comparing research.

In this process, the user does not design a complete system before using it. Natural language is gradually distilled into stable assets through real use.

## 5. Two Kinds of Computing Power, Working Together

LLM Token-based computing is well suited to meaning, ambiguity, judgment, and change. Traditional CPU and GPU computing is better suited to deterministic, repetitive, and mechanical work.

One of Memsphere's core directions is therefore:

> Reserve Tokens for the parts that genuinely require understanding and judgment. Give established, deterministic work to the CLI.

After an Agent has understood and completed the same steps repeatedly, those steps can be distilled into code. The Agent can then select and invoke a command with much less context instead of reasoning through every detail again. This improves stability, reduces Token consumption, and returns work to the traditional computing resources best suited to perform it.

The CLI is therefore not primarily a collection of commands for humans. It is a software capability layer designed first for Agents.

## 6. Quick Start

### 6.1 Requirements

- Node.js 20 or later;
- Git;
- an Agent that can use Skills and terminal commands.

Windows users need to install [Git for Windows](https://git-scm.com/download/win) and ensure that git is available on PATH. Reopen PowerShell, CMD, Git Bash, or another supported shell after installation. Memsphere does not require Git Bash to run.

### 6.2 Installation

~~~bash
npm install -g memsphere
~~~

Install the Memsphere Skill globally so that your Agent can discover it:

~~~bash
memsphere skill init --global
~~~

### 6.3 Create and Bind a Project

Enter your working directory and create a persistent Project:

~~~bash
cd <your-project>
memsphere project create my-project --bind
~~~

Inspect the current state and validate Memory:

~~~bash
memsphere project show
memsphere validate
~~~

Start the local View:

~~~bash
memsphere view start
~~~

Then, in a new Agent session, enter:

~~~text
Use memsphere to start memsphere-tutorial-chapter-01.
~~~

The Agent will discover the applicable Procedure, create a Run, and advance through its steps.

## 7. Two Kinds of Project

Memsphere provides two Project models.

### 7.1 Managed Project

A Managed Project is designed for software assets maintained over time by a person or team. Its Memory is stored in the operating system's user data directory, so it is not deleted with a temporary working directory or Git worktree.

~~~bash
memsphere project create my-project --bind
~~~

When you edit Memory, Memsphere creates a ChangeSet. Validate the change before publishing it:

~~~bash
memsphere memory edit concepts/example
memsphere memory change validate <change-id>
memsphere memory publish --change <change-id>
~~~

### 7.2 Embedded Project

An Embedded Project is designed for repositories that want to version Memory alongside code. Memory lives directly in the Git repository and follows its existing commit, review, and merge workflow.

~~~bash
memsphere project create my-project --embedded .memsphere/memory --bind
~~~

Validate after editing:

~~~bash
memsphere memory edit concepts/example
memsphere memory change validate
~~~

Memsphere does not commit Git changes for you. Validated changes continue through the normal Git workflow.

## 8. Reading Memory and Running Procedures

List the Memory visible to the current Project:

~~~bash
memsphere memory list
memsphere memory list --kind procedures
~~~

Read a Memory:

~~~bash
memsphere memory read <reference>
~~~

Start a Procedure Run:

~~~bash
memsphere run start <procedure-name> --name "<run-name>"
~~~

Every step in a Run explicitly asks for an Artifact. The Agent reports results through run report; Memsphere validates them, records state, and enters Review when required.

## 9. Memsphere Is Still Evolving

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
- **View**: locally browses Memory, Tasks, Runs, Reviews, and changes;
- **Skill integration**: lets compatible Agents discover Memsphere and work according to Project Memory.

Memsphere is still at an early stage. These capabilities are the first foundation of the larger vision, not the destination. CLI, data, and interfaces are the next areas that need to become first-class assets.

Memsphere will continue to expand according to the same principles:

- let stable steps be distilled into CLI tools designed for Agents;
- turn data and documents produced by Runs into managed data assets;
- give capabilities that require direct human interaction interfaces that can be generated and maintained;
- let these assets begin in natural language and gradually become structured through use;
- let the same personalized software continue to run across different models and Agents.

Our goal is not to turn everyone into a programmer in the traditional sense. It is to let every person and every organization own software that truly fits them.

## 10. Development

~~~bash
git clone https://github.com/billtenor/memsphere.git
cd memsphere
npm install
npm run build
npm test
~~~

Read [CONTRIBUTING.md](CONTRIBUTING.md) before contributing. For security issues, see [SECURITY.md](SECURITY.md).

## 11. License

Memsphere is licensed under the Apache License 2.0. See [LICENSE](LICENSE) for details.
