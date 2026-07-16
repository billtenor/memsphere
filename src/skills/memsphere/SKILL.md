---
name: memsphere
description: Use memsphere to discover, read, interpret, and apply project Memory, or to route Memory creation, editing, review, and Procedure execution through installed workflows. Trigger when the user explicitly asks to use memsphere, refers to Memory, Concept, Statement, Schema, Procedure, or asks for work that should follow memories installed in the current project.
---

# Memsphere

Memsphere manages reusable knowledge and workflows as Memory. Use the CLI as the only Memory access boundary; installed Memory is authoritative, while this Skill provides startup routing and a compact fast-start synopsis.

## Start

1. Confirm the current project is a memsphere scope with `memsphere validate` when scope health is uncertain.
2. If the request supplies a likely canonical name or alias, discover narrowly with `memsphere memory list --query "<exact-name-or-alias>" --output yaml`; add `--kind` when the type is known. `--query` is exact name/alias matching, not semantic search.
3. Use an unfiltered `memsphere memory list --output yaml` only when no usable name, alias, or kind can be extracted.
4. Treat list output as compact discovery metadata: `names`, prose `defines`, and folded structured-definition counts, analogous to a Skill's name and description. Read every selected Memory in full with `memsphere memory read <reference>` before interpreting or applying it.
5. Never search or read the Memory Store with `find`, `rg`, `cat`, `sed`, or equivalent filesystem tools.
6. Never read bundled `reserved-memory/` source in a repository or package. `init` installs selected built-ins into the standard Memory Store; after installation their origin is irrelevant.

When first encountering memsphere, read these memories in order:

```bash
memsphere memory read Memory
memsphere memory read Memsphere
memsphere memory read Concept
memsphere memory read Statement
memsphere memory read Schema
memsphere memory read Procedure
memsphere memory read "Memory 访问规则"
memsphere memory read "Memory 解读与应用规则"
```

If `memsphere memory list` or `memsphere memory read` is unavailable, do not bypass the missing CLI capability by reading storage files. Report that the required Memory access interface is unavailable. If validation reports missing installed memories, enter a user-confirmed `memsphere init` repair or installation flow; do not overwrite automatically.

## Route The Request

- For an explanation or knowledge query, find and read the relevant Concept, Statement, or Schema, then answer from the complete Memory.
- To apply existing Memory and create an instance or task artifact, read and follow `基于 Memory 完成任务流程`.
- To create, edit, review, or execute Memory, list Procedure memories, read the procedure matching the user's goal, and execute it through `memsphere run`.
- If no installed Procedure covers an operational request, state that the required memsphere capability has not been installed instead of inventing a workflow.

Do not start a Run for a simple knowledge explanation. Do not edit Memory while merely applying it to create an instance.

## Apply Memory

Use this compact interpretation model while reading the authoritative memories:

- Select candidates by canonical name, alias, and the user's actual goal. A Memory that explains a side fact is not automatically the task target.
- Use list metadata to understand and choose candidates. Type-specific fields remain absent, so list output never replaces `memory read` before applying a Memory.
- Read every plausible candidate when the target is uncertain. Ask the user only when the full definitions do not resolve the ambiguity.
- All members of `defines` apply together. They are complementary parts of one definition, not alternatives.
- A string definition establishes meaning, purpose, or boundary.
- Every assertion in an embedded `!statement` is mandatory.
- An embedded `!schema` supplies fields, content assertions, and presentation format.
- `format: outline` requires field names to be Markdown headings arranged by hierarchy. Bullets, key-value lines, bold labels, and tables are not outline substitutes.
- `format: table` requires first-level fields to be Markdown table columns and each element to be a row. Headings and bullets are not table substitutes.
- Infer information only when it follows unambiguously from the user's input and the Memory. Never invent missing amounts, dates, identifiers, or other facts.
- If required information is missing, do not create an empty, placeholder, or guessed artifact. Ask only for the missing information.
- If input conflicts with a constraint, do not create the artifact or silently repair the input. Identify the fact and the violated assertion.
- Obey the file format and output path defined by Memory, then verify every definition, assertion, field, format, and path before reporting completion.
- Unless the user explicitly requests a Memory change, do not create, modify, or delete Memory.

## Run Procedures

For an operational request backed by a Procedure:

1. Read the complete Procedure Memory.
2. Start it with `memsphere run start <procedure-name>`.
3. Execute only the current step returned by the CLI.
4. Report the step artifact with `memsphere run report --run <run-id>` using `--artifact` or `--artifact-file` as appropriate.
5. Continue until the CLI reports the Run is done, respecting every human checkpoint and branch.

The installed Memory is the source of truth. When a Skill synopsis conflicts with a Memory read from the current scope, follow the Memory and report the inconsistency.
