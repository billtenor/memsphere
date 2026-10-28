// examples/view-packages/procedure-graph-prototype/src/index.js
import { defineViewPlugin, slots } from "@memsphere/view-sdk";

// examples/view-packages/procedure-graph-prototype/fixtures.json
var fixtures_default = {
  procedure: {
    tag: "!procedure",
    syntax: "memsphere-20261027-stable",
    mode: "graph",
    names: [
      "analyze-materials",
      "\u9010\u4EFD\u5206\u6790\u8D44\u6599"
    ],
    defines: [
      "\u51C6\u5907\u8D44\u6599\uFF0C\u9010\u4EFD\u5206\u6790\u5E76\u8BC4\u5BA1\uFF0C\u6536\u96C6\u7ED3\u679C\u540E\u5F62\u6210\u603B\u7ED3\u3002"
    ],
    goals: [],
    actions: [
      {
        tag: "!action",
        id: "prepare",
        description: "\u51C6\u5907\u5F85\u5206\u6790\u8D44\u6599",
        actor: "agent",
        dependencies: [
          {
            tag: "!dependency",
            from: "START"
          }
        ],
        artifact: {
          name: "\u5F85\u5206\u6790\u8D44\u6599",
          model: {
            definedBy: "json-schema/draft-07.json",
            definition: '{"type": "object", "properties": {"remaining": {"type": "array", "items": {"type": "string"}}}, "required": ["remaining"], "additionalProperties": false}'
          },
          payload: {
            contentType: "application/json"
          }
        }
      },
      {
        tag: "!action",
        id: "check",
        description: "\u68C0\u67E5\u5269\u4F59\u8D44\u6599",
        actor: "agent",
        dependencies: [
          {
            tag: "!dependency",
            from: "prepare"
          },
          {
            tag: "!dependency",
            from: "analyze"
          }
        ],
        artifact: {
          name: "\u5269\u4F59\u8D44\u6599\u68C0\u67E5",
          model: {
            definedBy: "json-schema/draft-07.json",
            definition: '{"type": "object", "properties": {"hasMore": {"type": "boolean"}, "remaining": {"type": "array", "items": {"type": "string"}}}, "required": ["hasMore", "remaining"], "additionalProperties": false}'
          },
          payload: {
            contentType: "application/json"
          }
        }
      },
      {
        tag: "!action",
        id: "analyze",
        description: "\u5206\u6790\u4E00\u4EFD\u8D44\u6599",
        actor: "agent",
        dependencies: [
          {
            tag: "!dependency",
            from: "check",
            when: "artifacts.check.hasMore = true"
          }
        ],
        artifact: {
          name: "\u5355\u4EFD\u8D44\u6599\u5206\u6790",
          model: {
            definedBy: "json-schema/draft-07.json",
            definition: '{"type": "object", "properties": {"material": {"type": "string", "description": "\u5F53\u524D\u5206\u6790\u7684\u8D44\u6599"}, "finding": {"type": "string", "description": "\u4F9D\u636E\u8D44\u6599\u5F62\u6210\u7684\u7ED3\u8BBA"}, "remaining": {"type": "array", "items": {"type": "string"}}}, "required": ["material", "finding", "remaining"], "additionalProperties": false}'
          },
          payload: {
            contentType: "application/json"
          },
          review: [
            "\u9886\u57DF\u4E13\u5BB6"
          ]
        }
      },
      {
        tag: "!action",
        id: "gather",
        description: "\u6536\u96C6\u5206\u6790\u7ED3\u679C",
        dependencies: [
          {
            tag: "!dependency",
            from: "check",
            when: "artifacts.check.hasMore = false"
          }
        ],
        collect: [
          "analyze"
        ]
      },
      {
        tag: "!action",
        id: "summarize",
        description: "\u751F\u6210\u5206\u6790\u603B\u7ED3",
        actor: "agent",
        dependencies: [
          {
            tag: "!dependency",
            from: "gather"
          }
        ],
        artifact: {
          name: "\u5206\u6790\u603B\u7ED3",
          model: {
            definedBy: "raw.json",
            definition: "{}"
          },
          payload: {
            contentType: "text/markdown"
          }
        }
      }
    ]
  },
  snapshots: {
    fresh: {
      run: {
        id: "run-example",
        name: "\u9010\u4EFD\u5206\u6790\u8D44\u6599 \xB7 \u793A\u4F8B\u8FD0\u884C",
        status: "running",
        createdAt: "2026-10-27T13:00:00.000Z",
        language: "zh-CN",
        memoryRef: "procedures/analyze-materials",
        memorySnapshot: {
          memories: {
            "procedures/analyze-materials": {
              memoryRef: "procedures/analyze-materials",
              payload: {
                contentType: "application/yaml",
                content: `!procedure
syntax: memsphere-20261027-stable
mode: graph
names:
  - analyze-materials
  - \u9010\u4EFD\u5206\u6790\u8D44\u6599
defines:
  - \u51C6\u5907\u8D44\u6599\uFF0C\u9010\u4EFD\u5206\u6790\u5E76\u8BC4\u5BA1\uFF0C\u6536\u96C6\u7ED3\u679C\u540E\u5F62\u6210\u603B\u7ED3\u3002
goals: []
actions:
  - !action
    id: prepare
    description: \u51C6\u5907\u5F85\u5206\u6790\u8D44\u6599
    actor: agent
    dependencies:
      - !dependency
        from: START
    artifact:
      name: \u5F85\u5206\u6790\u8D44\u6599
      model:
        definedBy: json-schema/draft-07.json
        definition: '{"type": "object", "properties": {"remaining": {"type": "array", "items": {"type": "string"}}}, "required": ["remaining"], "additionalProperties": false}'
      payload:
        contentType: application/json
  - !action
    id: check
    description: \u68C0\u67E5\u5269\u4F59\u8D44\u6599
    actor: agent
    dependencies:
      - !dependency
        from: prepare
      - !dependency
        from: analyze
    artifact:
      name: \u5269\u4F59\u8D44\u6599\u68C0\u67E5
      model:
        definedBy: json-schema/draft-07.json
        definition: '{"type": "object", "properties": {"hasMore": {"type": "boolean"}, "remaining": {"type": "array", "items": {"type": "string"}}}, "required": ["hasMore", "remaining"], "additionalProperties": false}'
      payload:
        contentType: application/json
  - !action
    id: analyze
    description: \u5206\u6790\u4E00\u4EFD\u8D44\u6599
    actor: agent
    dependencies:
      - !dependency
        from: check
        when: artifacts.check.hasMore = true
    artifact:
      name: \u5355\u4EFD\u8D44\u6599\u5206\u6790
      model:
        definedBy: json-schema/draft-07.json
        definition: '{"type": "object", "properties": {"material": {"type": "string", "description": "\u5F53\u524D\u5206\u6790\u7684\u8D44\u6599"}, "finding": {"type": "string", "description": "\u4F9D\u636E\u8D44\u6599\u5F62\u6210\u7684\u7ED3\u8BBA"}, "remaining": {"type": "array", "items": {"type": "string"}}}, "required": ["material", "finding", "remaining"], "additionalProperties": false}'
      payload:
        contentType: application/json
      review:
        - \u9886\u57DF\u4E13\u5BB6
  - !action
    id: gather
    description: \u6536\u96C6\u5206\u6790\u7ED3\u679C
    dependencies:
      - !dependency
        from: check
        when: artifacts.check.hasMore = false
    collect:
      - analyze
  - !action
    id: summarize
    description: \u751F\u6210\u5206\u6790\u603B\u7ED3
    actor: agent
    dependencies:
      - !dependency
        from: gather
    artifact:
      name: \u5206\u6790\u603B\u7ED3
      model:
        definedBy: raw.json
        definition: "{}"
      payload:
        contentType: text/markdown
`
              }
            }
          }
        }
      },
      steps: [
        {
          id: "s-prepare",
          runId: "run-example",
          createdAt: "2026-10-27T13:00:00.000Z",
          status: "pending",
          source: {
            memoryRef: "procedures/analyze-materials",
            actionId: "prepare"
          },
          inputs: {}
        }
      ],
      artifacts: [],
      externals: [],
      reviews: [],
      completeIds: [],
      outputArtifactIds: []
    },
    review: {
      run: {
        id: "run-example",
        name: "\u9010\u4EFD\u5206\u6790\u8D44\u6599 \xB7 \u793A\u4F8B\u8FD0\u884C",
        status: "running",
        createdAt: "2026-10-27T13:00:00.000Z",
        language: "zh-CN",
        memoryRef: "procedures/analyze-materials",
        memorySnapshot: {
          memories: {
            "procedures/analyze-materials": {
              memoryRef: "procedures/analyze-materials",
              payload: {
                contentType: "application/yaml",
                content: `!procedure
syntax: memsphere-20261027-stable
mode: graph
names:
  - analyze-materials
  - \u9010\u4EFD\u5206\u6790\u8D44\u6599
defines:
  - \u51C6\u5907\u8D44\u6599\uFF0C\u9010\u4EFD\u5206\u6790\u5E76\u8BC4\u5BA1\uFF0C\u6536\u96C6\u7ED3\u679C\u540E\u5F62\u6210\u603B\u7ED3\u3002
goals: []
actions:
  - !action
    id: prepare
    description: \u51C6\u5907\u5F85\u5206\u6790\u8D44\u6599
    actor: agent
    dependencies:
      - !dependency
        from: START
    artifact:
      name: \u5F85\u5206\u6790\u8D44\u6599
      model:
        definedBy: json-schema/draft-07.json
        definition: '{"type": "object", "properties": {"remaining": {"type": "array", "items": {"type": "string"}}}, "required": ["remaining"], "additionalProperties": false}'
      payload:
        contentType: application/json
  - !action
    id: check
    description: \u68C0\u67E5\u5269\u4F59\u8D44\u6599
    actor: agent
    dependencies:
      - !dependency
        from: prepare
      - !dependency
        from: analyze
    artifact:
      name: \u5269\u4F59\u8D44\u6599\u68C0\u67E5
      model:
        definedBy: json-schema/draft-07.json
        definition: '{"type": "object", "properties": {"hasMore": {"type": "boolean"}, "remaining": {"type": "array", "items": {"type": "string"}}}, "required": ["hasMore", "remaining"], "additionalProperties": false}'
      payload:
        contentType: application/json
  - !action
    id: analyze
    description: \u5206\u6790\u4E00\u4EFD\u8D44\u6599
    actor: agent
    dependencies:
      - !dependency
        from: check
        when: artifacts.check.hasMore = true
    artifact:
      name: \u5355\u4EFD\u8D44\u6599\u5206\u6790
      model:
        definedBy: json-schema/draft-07.json
        definition: '{"type": "object", "properties": {"material": {"type": "string", "description": "\u5F53\u524D\u5206\u6790\u7684\u8D44\u6599"}, "finding": {"type": "string", "description": "\u4F9D\u636E\u8D44\u6599\u5F62\u6210\u7684\u7ED3\u8BBA"}, "remaining": {"type": "array", "items": {"type": "string"}}}, "required": ["material", "finding", "remaining"], "additionalProperties": false}'
      payload:
        contentType: application/json
      review:
        - \u9886\u57DF\u4E13\u5BB6
  - !action
    id: gather
    description: \u6536\u96C6\u5206\u6790\u7ED3\u679C
    dependencies:
      - !dependency
        from: check
        when: artifacts.check.hasMore = false
    collect:
      - analyze
  - !action
    id: summarize
    description: \u751F\u6210\u5206\u6790\u603B\u7ED3
    actor: agent
    dependencies:
      - !dependency
        from: gather
    artifact:
      name: \u5206\u6790\u603B\u7ED3
      model:
        definedBy: raw.json
        definition: "{}"
      payload:
        contentType: text/markdown
`
              }
            }
          }
        }
      },
      steps: [
        {
          id: "s-prepare",
          runId: "run-example",
          createdAt: "2026-10-27T13:00:00.000Z",
          status: "done",
          source: {
            memoryRef: "procedures/analyze-materials",
            actionId: "prepare"
          },
          inputs: {},
          startedAt: "2026-10-27T13:00:00.000Z",
          endedAt: "2026-10-27T13:01:00.000Z",
          completionSequence: 1,
          artifact: {
            mode: "produce",
            id: "a-prepare"
          }
        },
        {
          id: "s-check-1",
          runId: "run-example",
          createdAt: "2026-10-27T13:02:00.000Z",
          status: "done",
          source: {
            memoryRef: "procedures/analyze-materials",
            actionId: "check"
          },
          inputs: {
            prepare: [
              {
                kind: "artifact",
                id: "a-prepare"
              }
            ]
          },
          startedAt: "2026-10-27T13:02:00.000Z",
          endedAt: "2026-10-27T13:03:00.000Z",
          completionSequence: 3,
          artifact: {
            mode: "produce",
            id: "a-check-1"
          }
        },
        {
          id: "s-analyze-1",
          runId: "run-example",
          createdAt: "2026-10-27T13:04:00.000Z",
          status: "done",
          source: {
            memoryRef: "procedures/analyze-materials",
            actionId: "analyze"
          },
          inputs: {
            check: [
              {
                kind: "artifact",
                id: "a-check-1"
              }
            ]
          },
          startedAt: "2026-10-27T13:04:00.000Z",
          endedAt: "2026-10-27T13:05:00.000Z",
          completionSequence: 5,
          artifact: {
            mode: "produce",
            id: "a-analyze-1"
          }
        },
        {
          id: "s-check-2",
          runId: "run-example",
          createdAt: "2026-10-27T13:06:00.000Z",
          status: "done",
          source: {
            memoryRef: "procedures/analyze-materials",
            actionId: "check"
          },
          inputs: {
            analyze: [
              {
                kind: "artifact",
                id: "a-analyze-1"
              }
            ]
          },
          startedAt: "2026-10-27T13:06:00.000Z",
          endedAt: "2026-10-27T13:07:00.000Z",
          completionSequence: 7,
          artifact: {
            mode: "produce",
            id: "a-check-2"
          }
        },
        {
          id: "s-analyze-2",
          runId: "run-example",
          createdAt: "2026-10-27T13:08:00.000Z",
          status: "awaiting_review",
          source: {
            memoryRef: "procedures/analyze-materials",
            actionId: "analyze"
          },
          inputs: {
            check: [
              {
                kind: "artifact",
                id: "a-check-2"
              }
            ]
          },
          startedAt: "2026-10-27T13:08:00.000Z"
        }
      ],
      artifacts: [
        {
          id: "a-prepare",
          stepId: "s-prepare",
          name: "\u5F85\u5206\u6790\u8D44\u6599",
          status: "submitted",
          tags: [
            "default"
          ],
          dependencies: [],
          content: {
            model: {
              definedBy: "json-schema/draft-07.json",
              definition: '{"type": "object", "properties": {"remaining": {"type": "array", "items": {"type": "string"}}}, "required": ["remaining"], "additionalProperties": false}'
            },
            payload: {
              contentType: "application/json",
              content: '{"remaining": ["\u8D44\u6599\u7532", "\u8D44\u6599\u4E59"]}'
            }
          }
        },
        {
          id: "a-check-1",
          stepId: "s-check-1",
          name: "\u5269\u4F59\u8D44\u6599\u68C0\u67E5",
          status: "submitted",
          tags: [
            "default"
          ],
          dependencies: [
            {
              kind: "artifact",
              id: "a-prepare"
            }
          ],
          content: {
            model: {
              definedBy: "json-schema/draft-07.json",
              definition: '{"type": "object", "properties": {"hasMore": {"type": "boolean"}, "remaining": {"type": "array", "items": {"type": "string"}}}, "required": ["hasMore", "remaining"], "additionalProperties": false}'
            },
            payload: {
              contentType: "application/json",
              content: '{"hasMore": true, "remaining": ["\u8D44\u6599\u7532", "\u8D44\u6599\u4E59"]}'
            }
          }
        },
        {
          id: "a-analyze-1",
          stepId: "s-analyze-1",
          name: "\u5355\u4EFD\u8D44\u6599\u5206\u6790",
          status: "submitted",
          tags: [
            "default"
          ],
          dependencies: [
            {
              kind: "artifact",
              id: "a-check-1"
            }
          ],
          content: {
            model: {
              definedBy: "json-schema/draft-07.json",
              definition: '{"type": "object", "properties": {"material": {"type": "string", "description": "\u5F53\u524D\u5206\u6790\u7684\u8D44\u6599"}, "finding": {"type": "string", "description": "\u4F9D\u636E\u8D44\u6599\u5F62\u6210\u7684\u7ED3\u8BBA"}, "remaining": {"type": "array", "items": {"type": "string"}}}, "required": ["material", "finding", "remaining"], "additionalProperties": false}'
            },
            payload: {
              contentType: "application/json",
              content: '{"material": "\u8D44\u6599\u7532", "finding": "\u8D44\u6599\u7532\u63CF\u8FF0\u4E86\u8BB0\u5FC6\u5B9A\u4E49\u56FE\u7684\u9605\u8BFB\u9700\u6C42\u3002", "remaining": ["\u8D44\u6599\u4E59"]}'
            }
          }
        },
        {
          id: "a-check-2",
          stepId: "s-check-2",
          name: "\u5269\u4F59\u8D44\u6599\u68C0\u67E5",
          status: "submitted",
          tags: [
            "default"
          ],
          dependencies: [
            {
              kind: "artifact",
              id: "a-analyze-1"
            }
          ],
          content: {
            model: {
              definedBy: "json-schema/draft-07.json",
              definition: '{"type": "object", "properties": {"hasMore": {"type": "boolean"}, "remaining": {"type": "array", "items": {"type": "string"}}}, "required": ["hasMore", "remaining"], "additionalProperties": false}'
            },
            payload: {
              contentType: "application/json",
              content: '{"hasMore": true, "remaining": ["\u8D44\u6599\u4E59"]}'
            }
          }
        },
        {
          id: "a-analyze-2-v1",
          stepId: "s-analyze-2",
          name: "\u5355\u4EFD\u8D44\u6599\u5206\u6790",
          status: "submitted",
          tags: [
            "default"
          ],
          dependencies: [
            {
              kind: "artifact",
              id: "a-check-2"
            }
          ],
          content: {
            model: {
              definedBy: "json-schema/draft-07.json",
              definition: '{"type": "object", "properties": {"material": {"type": "string", "description": "\u5F53\u524D\u5206\u6790\u7684\u8D44\u6599"}, "finding": {"type": "string", "description": "\u4F9D\u636E\u8D44\u6599\u5F62\u6210\u7684\u7ED3\u8BBA"}, "remaining": {"type": "array", "items": {"type": "string"}}}, "required": ["material", "finding", "remaining"], "additionalProperties": false}'
            },
            payload: {
              contentType: "application/json",
              content: '{"material": "\u8D44\u6599\u4E59", "finding": "\u8FD0\u884C\u9875\u9762\u9700\u8981\u652F\u6301\u8FFD\u6EAF\u3002", "remaining": []}'
            }
          }
        },
        {
          id: "a-analyze-2-v2",
          stepId: "s-analyze-2",
          name: "\u5355\u4EFD\u8D44\u6599\u5206\u6790",
          status: "submitted",
          tags: [
            "default"
          ],
          dependencies: [
            {
              kind: "artifact",
              id: "a-check-2"
            }
          ],
          content: {
            model: {
              definedBy: "json-schema/draft-07.json",
              definition: '{"type": "object", "properties": {"material": {"type": "string", "description": "\u5F53\u524D\u5206\u6790\u7684\u8D44\u6599"}, "finding": {"type": "string", "description": "\u4F9D\u636E\u8D44\u6599\u5F62\u6210\u7684\u7ED3\u8BBA"}, "remaining": {"type": "array", "items": {"type": "string"}}}, "required": ["material", "finding", "remaining"], "additionalProperties": false}'
            },
            payload: {
              contentType: "application/json",
              content: '{"material": "\u8D44\u6599\u4E59", "finding": "\u8D44\u6599\u4E59\u7B2C 3 \u6BB5\u63D0\u51FA\uFF1A\u8FD0\u884C\u9875\u9762\u9700\u8981\u533A\u5206\u6267\u884C\u5B9E\u4F8B\u4E0E\u4EA7\u7269\u4FEE\u8BA2\u3002", "remaining": []}'
            }
          },
          revisedFrom: "a-analyze-2-v1",
          revisedSummary: "\u8865\u5145\u7ED3\u8BBA\u5BF9\u5E94\u7684\u539F\u6587\u51FA\u5904\u3002"
        }
      ],
      externals: [],
      reviews: [
        {
          id: "review-v1",
          artifactId: "a-analyze-2-v1",
          reviewer: {
            role: "reviewer",
            source: "human",
            actorId: "expert"
          },
          status: "submitted",
          comments: [
            {
              id: "comment-v1",
              body: "\u7ED3\u8BBA\u9700\u8981\u6CE8\u660E\u8D44\u6599\u51FA\u5904\u3002",
              createdAt: "2026-10-27T13:10:00.000Z",
              severity: "blocking"
            }
          ],
          vote: {
            value: "request_changes"
          },
          createdAt: "2026-10-27T13:09:00.000Z",
          endedAt: "2026-10-27T13:10:00.000Z"
        },
        {
          id: "review-v2",
          artifactId: "a-analyze-2-v2",
          reviewer: {
            role: "reviewer",
            source: "human",
            actorId: "expert"
          },
          status: "pending",
          comments: [],
          createdAt: "2026-10-27T13:12:00.000Z"
        }
      ],
      completeIds: [
        "a-prepare",
        "a-check-1",
        "a-analyze-1",
        "a-check-2"
      ],
      outputArtifactIds: []
    },
    done: {
      run: {
        id: "run-example",
        name: "\u9010\u4EFD\u5206\u6790\u8D44\u6599 \xB7 \u793A\u4F8B\u8FD0\u884C",
        status: "done",
        createdAt: "2026-10-27T13:00:00.000Z",
        language: "zh-CN",
        memoryRef: "procedures/analyze-materials",
        endedAt: "2026-10-27T13:20:00.000Z",
        memorySnapshot: {
          memories: {
            "procedures/analyze-materials": {
              memoryRef: "procedures/analyze-materials",
              payload: {
                contentType: "application/yaml",
                content: `!procedure
syntax: memsphere-20261027-stable
mode: graph
names:
  - analyze-materials
  - \u9010\u4EFD\u5206\u6790\u8D44\u6599
defines:
  - \u51C6\u5907\u8D44\u6599\uFF0C\u9010\u4EFD\u5206\u6790\u5E76\u8BC4\u5BA1\uFF0C\u6536\u96C6\u7ED3\u679C\u540E\u5F62\u6210\u603B\u7ED3\u3002
goals: []
actions:
  - !action
    id: prepare
    description: \u51C6\u5907\u5F85\u5206\u6790\u8D44\u6599
    actor: agent
    dependencies:
      - !dependency
        from: START
    artifact:
      name: \u5F85\u5206\u6790\u8D44\u6599
      model:
        definedBy: json-schema/draft-07.json
        definition: '{"type": "object", "properties": {"remaining": {"type": "array", "items": {"type": "string"}}}, "required": ["remaining"], "additionalProperties": false}'
      payload:
        contentType: application/json
  - !action
    id: check
    description: \u68C0\u67E5\u5269\u4F59\u8D44\u6599
    actor: agent
    dependencies:
      - !dependency
        from: prepare
      - !dependency
        from: analyze
    artifact:
      name: \u5269\u4F59\u8D44\u6599\u68C0\u67E5
      model:
        definedBy: json-schema/draft-07.json
        definition: '{"type": "object", "properties": {"hasMore": {"type": "boolean"}, "remaining": {"type": "array", "items": {"type": "string"}}}, "required": ["hasMore", "remaining"], "additionalProperties": false}'
      payload:
        contentType: application/json
  - !action
    id: analyze
    description: \u5206\u6790\u4E00\u4EFD\u8D44\u6599
    actor: agent
    dependencies:
      - !dependency
        from: check
        when: artifacts.check.hasMore = true
    artifact:
      name: \u5355\u4EFD\u8D44\u6599\u5206\u6790
      model:
        definedBy: json-schema/draft-07.json
        definition: '{"type": "object", "properties": {"material": {"type": "string", "description": "\u5F53\u524D\u5206\u6790\u7684\u8D44\u6599"}, "finding": {"type": "string", "description": "\u4F9D\u636E\u8D44\u6599\u5F62\u6210\u7684\u7ED3\u8BBA"}, "remaining": {"type": "array", "items": {"type": "string"}}}, "required": ["material", "finding", "remaining"], "additionalProperties": false}'
      payload:
        contentType: application/json
      review:
        - \u9886\u57DF\u4E13\u5BB6
  - !action
    id: gather
    description: \u6536\u96C6\u5206\u6790\u7ED3\u679C
    dependencies:
      - !dependency
        from: check
        when: artifacts.check.hasMore = false
    collect:
      - analyze
  - !action
    id: summarize
    description: \u751F\u6210\u5206\u6790\u603B\u7ED3
    actor: agent
    dependencies:
      - !dependency
        from: gather
    artifact:
      name: \u5206\u6790\u603B\u7ED3
      model:
        definedBy: raw.json
        definition: "{}"
      payload:
        contentType: text/markdown
`
              }
            }
          }
        }
      },
      steps: [
        {
          id: "s-prepare",
          runId: "run-example",
          createdAt: "2026-10-27T13:00:00.000Z",
          status: "done",
          source: {
            memoryRef: "procedures/analyze-materials",
            actionId: "prepare"
          },
          inputs: {},
          startedAt: "2026-10-27T13:00:00.000Z",
          endedAt: "2026-10-27T13:01:00.000Z",
          completionSequence: 1,
          artifact: {
            mode: "produce",
            id: "a-prepare"
          }
        },
        {
          id: "s-check-1",
          runId: "run-example",
          createdAt: "2026-10-27T13:02:00.000Z",
          status: "done",
          source: {
            memoryRef: "procedures/analyze-materials",
            actionId: "check"
          },
          inputs: {
            prepare: [
              {
                kind: "artifact",
                id: "a-prepare"
              }
            ]
          },
          startedAt: "2026-10-27T13:02:00.000Z",
          endedAt: "2026-10-27T13:03:00.000Z",
          completionSequence: 3,
          artifact: {
            mode: "produce",
            id: "a-check-1"
          }
        },
        {
          id: "s-analyze-1",
          runId: "run-example",
          createdAt: "2026-10-27T13:04:00.000Z",
          status: "done",
          source: {
            memoryRef: "procedures/analyze-materials",
            actionId: "analyze"
          },
          inputs: {
            check: [
              {
                kind: "artifact",
                id: "a-check-1"
              }
            ]
          },
          startedAt: "2026-10-27T13:04:00.000Z",
          endedAt: "2026-10-27T13:05:00.000Z",
          completionSequence: 5,
          artifact: {
            mode: "produce",
            id: "a-analyze-1"
          }
        },
        {
          id: "s-check-2",
          runId: "run-example",
          createdAt: "2026-10-27T13:06:00.000Z",
          status: "done",
          source: {
            memoryRef: "procedures/analyze-materials",
            actionId: "check"
          },
          inputs: {
            analyze: [
              {
                kind: "artifact",
                id: "a-analyze-1"
              }
            ]
          },
          startedAt: "2026-10-27T13:06:00.000Z",
          endedAt: "2026-10-27T13:07:00.000Z",
          completionSequence: 7,
          artifact: {
            mode: "produce",
            id: "a-check-2"
          }
        },
        {
          id: "s-analyze-2",
          runId: "run-example",
          createdAt: "2026-10-27T13:08:00.000Z",
          status: "done",
          source: {
            memoryRef: "procedures/analyze-materials",
            actionId: "analyze"
          },
          inputs: {
            check: [
              {
                kind: "artifact",
                id: "a-check-2"
              }
            ]
          },
          startedAt: "2026-10-27T13:08:00.000Z",
          endedAt: "2026-10-27T13:13:00.000Z",
          completionSequence: 9,
          artifact: {
            mode: "produce",
            id: "a-analyze-2-v2"
          }
        },
        {
          id: "s-check-3",
          runId: "run-example",
          createdAt: "2026-10-27T13:14:00.000Z",
          status: "done",
          source: {
            memoryRef: "procedures/analyze-materials",
            actionId: "check"
          },
          inputs: {
            analyze: [
              {
                kind: "artifact",
                id: "a-analyze-2-v2"
              }
            ]
          },
          startedAt: "2026-10-27T13:14:00.000Z",
          endedAt: "2026-10-27T13:15:00.000Z",
          completionSequence: 15,
          artifact: {
            mode: "produce",
            id: "a-check-3"
          }
        },
        {
          id: "s-gather",
          runId: "run-example",
          createdAt: "2026-10-27T13:16:00.000Z",
          status: "done",
          source: {
            memoryRef: "procedures/analyze-materials",
            actionId: "gather"
          },
          inputs: {
            check: [
              {
                kind: "artifact",
                id: "a-check-3"
              }
            ]
          },
          startedAt: "2026-10-27T13:16:00.000Z",
          endedAt: "2026-10-27T13:17:00.000Z",
          completionSequence: 17,
          artifact: {
            mode: "collect",
            items: {
              analyze: [
                "a-analyze-1",
                "a-analyze-2-v2"
              ]
            }
          }
        },
        {
          id: "s-summary",
          runId: "run-example",
          createdAt: "2026-10-27T13:18:00.000Z",
          status: "done",
          source: {
            memoryRef: "procedures/analyze-materials",
            actionId: "summarize"
          },
          inputs: {
            analyze: [
              {
                kind: "artifact",
                id: "a-analyze-1"
              },
              {
                kind: "artifact",
                id: "a-analyze-2-v2"
              }
            ]
          },
          startedAt: "2026-10-27T13:18:00.000Z",
          endedAt: "2026-10-27T13:19:00.000Z",
          completionSequence: 19,
          artifact: {
            mode: "produce",
            id: "a-summary"
          }
        }
      ],
      artifacts: [
        {
          id: "a-prepare",
          stepId: "s-prepare",
          name: "\u5F85\u5206\u6790\u8D44\u6599",
          status: "submitted",
          tags: [
            "default"
          ],
          dependencies: [],
          content: {
            model: {
              definedBy: "json-schema/draft-07.json",
              definition: '{"type": "object", "properties": {"remaining": {"type": "array", "items": {"type": "string"}}}, "required": ["remaining"], "additionalProperties": false}'
            },
            payload: {
              contentType: "application/json",
              content: '{"remaining": ["\u8D44\u6599\u7532", "\u8D44\u6599\u4E59"]}'
            }
          }
        },
        {
          id: "a-check-1",
          stepId: "s-check-1",
          name: "\u5269\u4F59\u8D44\u6599\u68C0\u67E5",
          status: "submitted",
          tags: [
            "default"
          ],
          dependencies: [
            {
              kind: "artifact",
              id: "a-prepare"
            }
          ],
          content: {
            model: {
              definedBy: "json-schema/draft-07.json",
              definition: '{"type": "object", "properties": {"hasMore": {"type": "boolean"}, "remaining": {"type": "array", "items": {"type": "string"}}}, "required": ["hasMore", "remaining"], "additionalProperties": false}'
            },
            payload: {
              contentType: "application/json",
              content: '{"hasMore": true, "remaining": ["\u8D44\u6599\u7532", "\u8D44\u6599\u4E59"]}'
            }
          }
        },
        {
          id: "a-analyze-1",
          stepId: "s-analyze-1",
          name: "\u5355\u4EFD\u8D44\u6599\u5206\u6790",
          status: "submitted",
          tags: [
            "default"
          ],
          dependencies: [
            {
              kind: "artifact",
              id: "a-check-1"
            }
          ],
          content: {
            model: {
              definedBy: "json-schema/draft-07.json",
              definition: '{"type": "object", "properties": {"material": {"type": "string", "description": "\u5F53\u524D\u5206\u6790\u7684\u8D44\u6599"}, "finding": {"type": "string", "description": "\u4F9D\u636E\u8D44\u6599\u5F62\u6210\u7684\u7ED3\u8BBA"}, "remaining": {"type": "array", "items": {"type": "string"}}}, "required": ["material", "finding", "remaining"], "additionalProperties": false}'
            },
            payload: {
              contentType: "application/json",
              content: '{"material": "\u8D44\u6599\u7532", "finding": "\u8D44\u6599\u7532\u63CF\u8FF0\u4E86\u8BB0\u5FC6\u5B9A\u4E49\u56FE\u7684\u9605\u8BFB\u9700\u6C42\u3002", "remaining": ["\u8D44\u6599\u4E59"]}'
            }
          }
        },
        {
          id: "a-check-2",
          stepId: "s-check-2",
          name: "\u5269\u4F59\u8D44\u6599\u68C0\u67E5",
          status: "submitted",
          tags: [
            "default"
          ],
          dependencies: [
            {
              kind: "artifact",
              id: "a-analyze-1"
            }
          ],
          content: {
            model: {
              definedBy: "json-schema/draft-07.json",
              definition: '{"type": "object", "properties": {"hasMore": {"type": "boolean"}, "remaining": {"type": "array", "items": {"type": "string"}}}, "required": ["hasMore", "remaining"], "additionalProperties": false}'
            },
            payload: {
              contentType: "application/json",
              content: '{"hasMore": true, "remaining": ["\u8D44\u6599\u4E59"]}'
            }
          }
        },
        {
          id: "a-analyze-2-v1",
          stepId: "s-analyze-2",
          name: "\u5355\u4EFD\u8D44\u6599\u5206\u6790",
          status: "submitted",
          tags: [
            "default"
          ],
          dependencies: [
            {
              kind: "artifact",
              id: "a-check-2"
            }
          ],
          content: {
            model: {
              definedBy: "json-schema/draft-07.json",
              definition: '{"type": "object", "properties": {"material": {"type": "string", "description": "\u5F53\u524D\u5206\u6790\u7684\u8D44\u6599"}, "finding": {"type": "string", "description": "\u4F9D\u636E\u8D44\u6599\u5F62\u6210\u7684\u7ED3\u8BBA"}, "remaining": {"type": "array", "items": {"type": "string"}}}, "required": ["material", "finding", "remaining"], "additionalProperties": false}'
            },
            payload: {
              contentType: "application/json",
              content: '{"material": "\u8D44\u6599\u4E59", "finding": "\u8FD0\u884C\u9875\u9762\u9700\u8981\u652F\u6301\u8FFD\u6EAF\u3002", "remaining": []}'
            }
          }
        },
        {
          id: "a-analyze-2-v2",
          stepId: "s-analyze-2",
          name: "\u5355\u4EFD\u8D44\u6599\u5206\u6790",
          status: "submitted",
          tags: [
            "default"
          ],
          dependencies: [
            {
              kind: "artifact",
              id: "a-check-2"
            }
          ],
          content: {
            model: {
              definedBy: "json-schema/draft-07.json",
              definition: '{"type": "object", "properties": {"material": {"type": "string", "description": "\u5F53\u524D\u5206\u6790\u7684\u8D44\u6599"}, "finding": {"type": "string", "description": "\u4F9D\u636E\u8D44\u6599\u5F62\u6210\u7684\u7ED3\u8BBA"}, "remaining": {"type": "array", "items": {"type": "string"}}}, "required": ["material", "finding", "remaining"], "additionalProperties": false}'
            },
            payload: {
              contentType: "application/json",
              content: '{"material": "\u8D44\u6599\u4E59", "finding": "\u8D44\u6599\u4E59\u7B2C 3 \u6BB5\u63D0\u51FA\uFF1A\u8FD0\u884C\u9875\u9762\u9700\u8981\u533A\u5206\u6267\u884C\u5B9E\u4F8B\u4E0E\u4EA7\u7269\u4FEE\u8BA2\u3002", "remaining": []}'
            }
          },
          revisedFrom: "a-analyze-2-v1",
          revisedSummary: "\u8865\u5145\u7ED3\u8BBA\u5BF9\u5E94\u7684\u539F\u6587\u51FA\u5904\u3002"
        },
        {
          id: "a-check-3",
          stepId: "s-check-3",
          name: "\u5269\u4F59\u8D44\u6599\u68C0\u67E5",
          status: "submitted",
          tags: [
            "default"
          ],
          dependencies: [
            {
              kind: "artifact",
              id: "a-analyze-2-v2"
            }
          ],
          content: {
            model: {
              definedBy: "json-schema/draft-07.json",
              definition: '{"type": "object", "properties": {"hasMore": {"type": "boolean"}, "remaining": {"type": "array", "items": {"type": "string"}}}, "required": ["hasMore", "remaining"], "additionalProperties": false}'
            },
            payload: {
              contentType: "application/json",
              content: '{"hasMore": false, "remaining": []}'
            }
          }
        },
        {
          id: "a-summary",
          stepId: "s-summary",
          name: "\u5206\u6790\u603B\u7ED3",
          status: "submitted",
          tags: [
            "default"
          ],
          dependencies: [
            {
              kind: "artifact",
              id: "a-analyze-1"
            },
            {
              kind: "artifact",
              id: "a-analyze-2-v2"
            }
          ],
          content: {
            model: {
              definedBy: "raw.json",
              definition: "{}"
            },
            payload: {
              contentType: "text/markdown",
              content: "\u603B\u7ED3\u8986\u76D6\u8D44\u6599\u7532\u548C\u8D44\u6599\u4E59\u7684\u5206\u6790\u7ED3\u679C\uFF0C\u5206\u522B\u5F15\u7528\u4E24\u4EFD\u5DF2\u91C7\u7528\u4EA7\u7269\u3002"
            }
          }
        }
      ],
      externals: [],
      reviews: [
        {
          id: "review-v1",
          artifactId: "a-analyze-2-v1",
          reviewer: {
            role: "reviewer",
            source: "human",
            actorId: "expert"
          },
          status: "submitted",
          comments: [
            {
              id: "comment-v1",
              body: "\u7ED3\u8BBA\u9700\u8981\u6CE8\u660E\u8D44\u6599\u51FA\u5904\u3002",
              createdAt: "2026-10-27T13:10:00.000Z",
              severity: "blocking"
            }
          ],
          vote: {
            value: "request_changes"
          },
          createdAt: "2026-10-27T13:09:00.000Z",
          endedAt: "2026-10-27T13:10:00.000Z"
        },
        {
          id: "review-v2",
          artifactId: "a-analyze-2-v2",
          reviewer: {
            role: "reviewer",
            source: "human",
            actorId: "expert"
          },
          status: "submitted",
          comments: [],
          createdAt: "2026-10-27T13:12:00.000Z",
          vote: {
            value: "approve"
          },
          endedAt: "2026-10-27T13:13:00.000Z"
        }
      ],
      completeIds: [
        "a-prepare",
        "a-check-1",
        "a-analyze-1",
        "a-check-2",
        "a-analyze-2-v2",
        "a-check-3",
        "a-summary"
      ],
      outputArtifactIds: [
        "a-summary"
      ]
    }
  }
};

// examples/view-packages/procedure-graph-prototype/src/markup.js
var markup_default = '<div id="gm-proto" aria-label="Memsphere graph \u8BB0\u5FC6\u4E0E\u8FD0\u884C\u4EA4\u4E92\u539F\u578B">\n \n <div class="gm-layout">\n <main class="gm-main"><div class="gm-pagehead"><div class="gm-eyebrow">PROCEDURE / GRAPH</div><h2>\u9010\u4EFD\u5206\u6790\u8D44\u6599</h2><p class="gm-desc">\u51C6\u5907\u8D44\u6599\uFF0C\u9010\u4EFD\u5206\u6790\u5E76\u8BC4\u5BA1\uFF0C\u6536\u96C6\u7ED3\u679C\u540E\u5F62\u6210\u603B\u7ED3\u3002</p><div class="gm-tabs" role="tablist" aria-label="\u67E5\u770B\u89C6\u89D2"><button role="tab" id="gm-definition-tab" aria-controls="gm-shared-panel" aria-selected="true" data-view="definition">\u8BB0\u5FC6\u5B9A\u4E49</button><button role="tab" id="gm-run-tab" aria-controls="gm-shared-panel" aria-selected="false" data-view="run">\u8FD0\u884C\u5B9E\u4F8B</button></div></div>\n <section id="gm-shared-panel" role="tabpanel" aria-labelledby="gm-definition-tab"><div class="gm-meta" id="gm-meta"></div><div class="gm-workspace" style="position:relative"><section class="gm-stage" aria-label="\u6D41\u7A0B\u753B\u5E03"><div class="gm-viewport" tabindex="0" aria-label="\u6D41\u7A0B\u753B\u5E03\uFF0C\u53EF\u6EDA\u52A8\u5E76\u7528 Tab \u9009\u62E9\u8282\u70B9"><div class="gm-world"><svg class="gm-svg" viewBox="0 0 746 420" role="img" aria-label="START \u5230\u51C6\u5907\uFF0C\u518D\u68C0\u67E5\uFF1B\u6709\u5269\u4F59\u8D44\u6599\u8FDB\u5165\u5206\u6790\u5E76\u56DE\u5230\u68C0\u67E5\uFF0C\u65E0\u5269\u4F59\u5219\u6536\u96C6\u5E76\u603B\u7ED3"><defs><marker id="gm-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L8 4 L0 8 Z"></path></marker></defs><g id="gm-edges"></g></svg><span class="gm-start" data-source="Action.dependencies[].from">START</span><div id="gm-nodes"></div></div></div><div class="gm-controls"><div class="gm-legend"><span>\u2192 \u6267\u884C\u4F9D\u8D56</span><span>\u2504 \u6536\u96C6\u6765\u6E90</span></div><div class="gm-zoom"><button aria-label="\u7F29\u5C0F" data-zoom="out">\u2212</button><span id="gm-scale">100%</span><button aria-label="\u653E\u5927" data-zoom="in">\uFF0B</button><button data-zoom="fit">\u9002\u914D</button></div></div></section><aside class="gm-detail" id="gm-detail" aria-label="\u8282\u70B9\u8BE6\u60C5" aria-live="polite"></aside><div class="gm-overlay" id="gm-overlay" hidden></div></div><footer class="gm-bottom"><span id="gm-bottomtext"></span><span>\u53EA\u8BFB\u89C6\u56FE</span></footer></section></main></div>\n</div>';

// examples/view-packages/procedure-graph-prototype/src/index.js
var procedure = fixtures_default.procedure;
var snapshots = fixtures_default.snapshots;
var positions = { prepare: [26, 98], check: [280, 98], analyze: [534, 98], gather: [280, 292], summarize: [534, 292] };
var paths = {
  "START:prepare": "M48 78 L48 98",
  "prepare:check": "M204 143 L280 143",
  "check:analyze": "M458 143 L534 143",
  "analyze:check": "M623 98 L623 45 Q623 30 608 30 L384 30 Q369 30 369 45 L369 98",
  "check:gather": "M369 187 L369 292",
  "gather:summarize": "M458 337 L534 337"
};
var stepLabels = { pending: "\u5F85\u6267\u884C", running: "\u6267\u884C\u4E2D", awaiting_review: "\u5F85\u8BC4\u5BA1", done: "\u5DF2\u5B8C\u6210", failed: "\u5931\u8D25", cancelled: "\u5DF2\u53D6\u6D88" };
var runLabels = { running: "\u8FD0\u884C\u4E2D", done: "\u5DF2\u5B8C\u6210", abandoned: "\u5DF2\u5E9F\u5F03" };
var voteLabels = { approve: "\u901A\u8FC7", request_changes: "\u8981\u6C42\u4FEE\u6539", abstain: "\u5F03\u6743" };
var reviewLabels = { pending: "\u5F85\u8BC4\u5BA1", running: "\u8BC4\u5BA1\u4E2D", submitted: "\u5DF2\u63D0\u4EA4", cancelled: "\u5DF2\u53D6\u6D88" };
var artifactLabels = { draft: "\u8349\u7A3F", submitted: "\u5DF2\u63D0\u4EA4" };
var escape = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
function actionSteps(snapshot, id) {
  return snapshot.steps.filter((s) => s.source?.actionId === id).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}
function statusCounts(steps) {
  return Object.keys(stepLabels).map((status) => ({ status, count: steps.filter((s) => s.status === status).length })).filter((x) => x.count);
}
function artifactVersions(snapshot, stepId) {
  const entries = snapshot.artifacts.filter((a) => a.stepId === stepId), byId = new Map(entries.map((a) => [a.id, a]));
  const depth = (a) => {
    let n = 0, seen = /* @__PURE__ */ new Set();
    while (a?.revisedFrom && byId.has(a.revisedFrom) && !seen.has(a.id)) {
      seen.add(a.id);
      n++;
      a = byId.get(a.revisedFrom);
    }
    return n;
  };
  return entries.sort((a, b) => depth(a) - depth(b) || a.id.localeCompare(b.id));
}
var index_default = defineViewPlugin({
  name: "procedure-graph-prototype",
  apiVersion: 1,
  inject: ["slots", "router", "theme", "ui"],
  themeVersion: 1,
  uiVersion: 1,
  apply(ctx) {
    const text = (value) => ({ text: value });
    const route = ctx.router.register({ id: "prototype", path: "/" });
    ctx.slots.register(slots.navigationPrimary, { id: "navigation", order: 86, value: { label: text("Graph \u539F\u578B"), icon: { kind: "system", name: "stack" }, route: route.to() } });
    ctx.slots.register(slots.headerTitle, { id: "title", when: route.activation, value: { title: text("Graph \u8BB0\u5FC6\u4E0E\u8FD0\u884C"), breadcrumbs: [{ label: text("\u4EA4\u4E92\u539F\u578B") }] } });
    ctx.slots.register(slots.mainView, { id: "page", key: route.key, when: route.activation, value: { mount({ element }) {
      element.innerHTML = markup_default;
      const root = element.querySelector("#gm-proto"), q = (s) => root.querySelector(s), qa = (s) => [...root.querySelectorAll(s)];
      q("#gm-detail").remove();
      q("#gm-overlay").remove();
      const controller = new AbortController();
      const state = { view: "definition", node: "analyze", edge: null, scenario: "review", stepId: "s-analyze-2", artifactId: "a-analyze-2-v2", zoom: 1, sources: false };
      let opener, disposed = false, restoringFocus = false, runDialog, dialogKind, dialogStepId, dialogArtifactId, dialogPane = "content";
      const snapshot = () => snapshots[state.scenario];
      const action = () => procedure.actions.find((a) => a.id === state.node);
      const mark = (content, path) => `<span data-source="${escape(path)}" title="${escape(path)}">${escape(content)}</span><span class="gm-source">${escape(path)}</span>`;
      const value = (v, path) => mark(typeof v === "object" ? JSON.stringify(v) : v, path);
      const pill = (v, c = "", path) => `<span class="gm-pill ${c}">${path ? mark(v, path) : escape(v)}</span>`;
      const row = (label, v, path) => `<dt>${escape(label)}</dt><dd>${value(v, path)}</dd>`;
      const pre = (v, path) => `<pre class="gm-record" data-source="${escape(path)}">${escape(typeof v === "string" ? v : JSON.stringify(v, null, 2))}</pre><span class="gm-source">${escape(path)}</span>`;
      const button = (label, attr) => `<button class="gm-link" ${attr}>${escape(label)}</button>`;
      const displayRef = (id) => id === "START" ? "\u5F00\u59CB" : id;
      q(".gm-start").textContent = "\u5F00\u59CB";
      q(".gm-start").setAttribute("aria-label", "\u5F00\u59CB");
      const preview = document.createElement("div");
      preview.className = "gm-edge-preview";
      preview.hidden = true;
      preview.setAttribute("role", "tooltip");
      q(".gm-stage").append(preview);
      function edges() {
        return procedure.actions.flatMap((a) => [
          ...a.dependencies.flatMap((dependency, index) => (Array.isArray(dependency.from) ? dependency.from : [dependency.from]).map((from) => ({ id: `${a.id}:${index}:${from}`, from, to: a.id, index, dependency, path: paths[`${from}:${a.id}`], kind: "dependency" }))),
          ...(a.collect ?? []).map((from, index) => ({ id: `${a.id}:collect:${from}`, from, to: a.id, index, kind: "collect", path: "M623 187 L623 252 Q623 265 610 265 L468 265 Q450 265 442 292" }))
        ]);
      }
      function edgeContent(edge) {
        const source = edge.kind === "collect" ? "Action.collect" : `Action.dependencies[${edge.index}].from`;
        let html = `<h3>${edge.kind === "collect" ? "\u6536\u96C6\u5173\u7CFB" : "\u6267\u884C\u4F9D\u8D56"}</h3><dl class="gm-dl">${row("\u6765\u81EA", displayRef(edge.from), source)}${row("\u6307\u5411", edge.to, "Action.id")}</dl>`;
        if (edge.dependency?.when) html += "<h4>\u6761\u4EF6</h4>" + pre(edge.dependency.when, `Action.dependencies[${edge.index}].when`);
        if (Array.isArray(edge.dependency?.from)) html += "<h4>\u5171\u540C\u7B49\u5F85</h4>" + pre(edge.dependency.from, source);
        return html;
      }
      function highlightEdge(id) {
        const edge = edges().find((e) => e.id === id);
        qa("[data-edge-line]").forEach((line) => line.dataset.highlighted = String(line.dataset.edgeLine === edge?.id));
        qa(".gm-edge-condition").forEach((label) => label.dataset.highlighted = String(label.dataset.edge === edge?.id));
        qa("[data-node]").forEach((node) => node.dataset.edgeHighlighted = String(!!edge && [edge.from, edge.to].includes(node.dataset.node)));
        q(".gm-start").dataset.edgeHighlighted = String(edge?.from === "START");
      }
      function showEdgePreview(id, target, event) {
        const edge = edges().find((e) => e.id === id);
        if (!edge) return;
        highlightEdge(id);
        preview.innerHTML = `<strong>${escape(displayRef(edge.from))} \u2192 ${escape(edge.to)}</strong>` + (edge.dependency?.when ? "<div>\u6761\u4EF6</div><code>" + escape(edge.dependency.when) + "</code>" : "");
        const stage = q(".gm-stage").getBoundingClientRect(), box = target.getBoundingClientRect();
        const x = event?.clientX ?? box.x + box.width / 2, y = event?.clientY ?? box.y + box.height / 2;
        preview.hidden = false;
        preview.style.left = Math.max(8, Math.min(x - stage.x + 12, stage.width - preview.offsetWidth - 8)) + "px";
        preview.style.top = Math.max(8, Math.min(y - stage.y + 12, stage.height - preview.offsetHeight - 8)) + "px";
      }
      function hideEdgePreview() {
        preview.hidden = true;
        highlightEdge();
      }
      function selectEdge(id) {
        opener = q(`[data-edge="${id}"]`);
        state.edge = id;
        hideEdgePreview();
        renderNodes();
        highlightEdge();
        dialogKind = "edge";
        renderRunDialog();
      }
      q("h2").innerHTML = value(procedure.names[1] ?? procedure.names[0], "Procedure.names");
      q(".gm-desc").innerHTML = procedure.defines.map((v) => value(v, "Procedure.defines")).join("<br>");
      q(".gm-eyebrow").replaceChildren(ctx.ui.badge(text("\u539F\u578B \xB7 \u793A\u4F8B\u6570\u636E")));
      function renderNodes() {
        q("#gm-nodes").innerHTML = procedure.actions.map((a) => {
          const [x, y] = positions[a.id], steps = actionSteps(snapshot(), a.id);
          const badges = state.view === "definition" ? a.collect ? pill("collect", "neutral", "Action.collect") : pill(a.actor ?? "agent", "neutral", "Action.actor (default: agent)") : statusCounts(steps).map((s) => pill(`${stepLabels[s.status]} ${s.count}`, s.status === "awaiting_review" ? "wait" : "", "count(Step.status; source.actionId = " + a.id + ")")).join("");
          const sub = state.view === "definition" ? a.artifact ? value(a.artifact.name, "Action.artifact.name") : value(a.collect, "Action.collect") : value(`${steps.length} \u6B21\u6267\u884C`, "count(Step where source.actionId = " + a.id + ")");
          return `<button class="gm-node" style="left:${x}px;top:${y}px" data-node="${a.id}"><div class="gm-node-top"><span class="gm-type">${escape(a.id)}</span>${badges}</div><b>${value(a.description, "Action.description")}</b><small>${sub}</small></button>`;
        }).join("");
      }
      function renderEdges() {
        q("#gm-edges").innerHTML = edges().filter((e) => e.path).map((edge) => `<path d="${edge.path}" marker-end="url(#gm-arrow)" data-edge-line="${edge.id}" ${edge.kind === "collect" ? 'stroke-dasharray="5 5"' : ""}></path><path d="${edge.path}" class="gm-edge-hit" data-edge="${edge.id}" role="button" tabindex="0" aria-label="${escape(`${displayRef(edge.from)} \u6307\u5411 ${edge.to}${edge.dependency?.when ? "\uFF0C\u6761\u4EF6\uFF1A" + edge.dependency.when : ""}`)}"></path>`).join("");
        qa(".gm-edge-condition").forEach((e) => e.remove());
        for (const a of procedure.actions) a.dependencies.forEach((d, index) => {
          if (!d.when) return;
          const b = document.createElement("button");
          b.className = "gm-edge-condition";
          b.textContent = "\u6761\u4EF6";
          b.dataset.edge = `${a.id}:${index}:${Array.isArray(d.from) ? d.from[0] : d.from}`;
          b.setAttribute("aria-label", "\u6761\u4EF6\uFF1A" + d.when);
          b.style.left = (a.id === "analyze" ? 478 : 386) + "px";
          b.style.top = (a.id === "analyze" ? 122 : 230) + "px";
          q(".gm-world").append(b);
        });
        qa("[data-edge]").forEach((target) => {
          target.addEventListener("pointerenter", (event) => showEdgePreview(target.dataset.edge, target, event));
          target.addEventListener("pointerleave", hideEdgePreview);
          target.addEventListener("focus", () => {
            if (!restoringFocus) showEdgePreview(target.dataset.edge, target);
          });
          target.addEventListener("blur", hideEdgePreview);
        });
        highlightEdge();
      }
      function renderDefinition(a) {
        let html = `<dl class="gm-dl">${a.actor ? row("\u6267\u884C\u8005", a.actor, "Action.actor") : ""}${a.artifact ? row("\u4EA7\u7269", a.artifact.name, "Action.artifact.name") + row("\u5185\u5BB9\u7C7B\u578B", a.artifact.payload.contentType, "Action.artifact.payload.contentType") : row("\u6536\u96C6\u6765\u6E90", a.collect, "Action.collect")}</dl>`;
        html += "<h4>\u4F9D\u8D56</h4>" + a.dependencies.map((d, i) => `<div class="gm-row"><dl class="gm-dl">${row("\u6765\u81EA", Array.isArray(d.from) ? d.from.map(displayRef) : displayRef(d.from), `Action.dependencies[${i}].from`)}${d.when ? row("\u6761\u4EF6", d.when, `Action.dependencies[${i}].when`) : ""}</dl></div>`).join("");
        if (a.artifact?.review) html += "<h4>\u8BC4\u5BA1</h4>" + value(a.artifact.review, "Action.artifact.review");
        if (a.asserts) html += "<h4>\u6267\u884C\u7EA6\u675F</h4>" + pre(a.asserts, "Action.asserts");
        if (a.artifact?.model) {
          let definition = a.artifact.model.definition;
          try {
            definition = JSON.parse(definition);
          } catch {
          }
          html += "<h4>\u4EA7\u7269\u6A21\u578B</h4>" + value(a.artifact.model.definedBy, "Action.artifact.model.definedBy") + '<details class="gm-model-definition"><summary>\u6A21\u578B\u5B9A\u4E49</summary>' + pre(definition, "Action.artifact.model.definition") + "</details>";
        }
        html += "<h4>\u5B9A\u4E49</h4>" + button("\u67E5\u770B\u5B8C\u6574\u5B9A\u4E49", 'data-modal="source"');
        return html;
      }
      function artifactBody(artifact) {
        const payload = artifact.content?.payload;
        if (!payload) return pre(artifact.contentRef, "Artifact.contentRef");
        let body = payload.content;
        if (payload.contentType.split(";")[0] === "application/json") try {
          body = JSON.parse(body);
        } catch {
        }
        return pre(body, "Artifact.content.payload.content");
      }
      function artifactLinks(refs) {
        return refs.map((ref) => {
          const artifact = snapshot().artifacts.find((a) => a.id === ref.id);
          return artifact ? `<button class="gm-related-artifact" data-dialog-artifact="${escape(artifact.id)}">${value(artifact.name, "Artifact.name")}<small>${value(artifact.id, "Artifact.id")}</small></button>` : pre(ref, "Step.inputs");
        }).join("");
      }
      function reviewPane(artifact) {
        const entries = snapshot().reviews.filter((r) => r.artifactId === artifact.id);
        return "<h3>\u8BC4\u5BA1</h3>" + (entries.length ? entries.map((r) => '<article class="gm-dialog-review"><dl class="gm-dl">' + row("\u53C2\u4E0E\u8005", r.reviewer.actorId ?? r.reviewer.role, "Review.reviewer") + row("\u72B6\u6001", reviewLabels[r.status] ?? r.status, "Review.status") + (r.vote ? row("\u6295\u7968", voteLabels[r.vote.value] ?? r.vote.value, "Review.vote.value") : "") + "</dl>" + r.comments.map((c) => "<p>" + value(c.body, "Review.comments[].body") + "</p>").join("") + "</article>").join("") : '<div class="gm-dialog-empty">' + value("0 \u6761\u8BC4\u5BA1", "count(Review where artifactId = Artifact.id)") + "</div>");
      }
      function executionInfo(step) {
        if (!step) return "";
        const inputs = Object.entries(step.inputs ?? {});
        return '<details class="gm-execution-info"><summary>\u6267\u884C\u4FE1\u606F</summary><dl class="gm-dl">' + row("\u6807\u8BC6", step.id, "Step.id") + row("\u72B6\u6001", stepLabels[step.status], "Step.status") + row("\u521B\u5EFA\u65F6\u95F4", step.createdAt, "Step.createdAt") + (step.startedAt ? row("\u5F00\u59CB\u65F6\u95F4", step.startedAt, "Step.startedAt") : "") + (step.endedAt ? row("\u7ED3\u675F\u65F6\u95F4", step.endedAt, "Step.endedAt") : "") + "</dl><h3>\u56FA\u5B9A\u8F93\u5165</h3>" + (inputs.length ? inputs.map(([from, refs]) => '<section class="gm-input-group"><h4>\u6765\u81EA ' + escape(displayRef(from)) + "</h4>" + artifactLinks(refs) + "</section>").join("") : pre(step.inputs ?? {}, "Step.inputs")) + "</details>";
      }
      function renderRunDialog(focusSelector) {
        const snap = snapshot();
        let title, metadata, left, right, secondLabel;
        const compact = ["definition", "edge", "source", "empty"].includes(dialogKind);
        if (compact) {
          const a = action(), edge = edges().find((e) => e.id === state.edge);
          title = dialogKind === "edge" ? edge.kind === "collect" ? "\u6536\u96C6\u5173\u7CFB" : "\u6267\u884C\u4F9D\u8D56" : a.description;
          metadata = dialogKind === "edge" ? "" : value(a.id, "Action.id");
          left = dialogKind === "edge" ? edgeContent(edge).replace(/^<h3>.*?<\/h3>/, "") : dialogKind === "source" ? pre(a, "Procedure.actions[]") : (dialogKind === "empty" ? '<div class="gm-dialog-empty">' + value("0 \u6B21\u6267\u884C", "count(Step where source.actionId = " + a.id + ")") + "</div>" : "") + renderDefinition(a);
        } else if (dialogKind === "artifact") {
          const artifact = snap.artifacts.find((a) => a.id === dialogArtifactId);
          if (!artifact) return;
          const step = snap.steps.find((s) => s.id === artifact.stepId);
          const versions = artifactVersions(snap, artifact.stepId), index = versions.findIndex((a) => a.id === artifact.id);
          title = artifact.name;
          metadata = value(artifact.id, "Artifact.id") + pill(artifactLabels[artifact.status], "", "Artifact.status");
          const adopted = snap.steps.find((s) => s.id === artifact.stepId)?.artifact;
          if (adopted?.mode === "produce" && adopted.id === artifact.id) metadata += pill("\u5DF2\u91C7\u7528", "", "Step.artifact.id = Artifact.id");
          left = '<div class="gm-dialog-versionbar"><select id="gm-dialog-version" aria-label="\u4EA7\u7269\u7248\u672C">' + versions.map((a, i) => `<option value="${escape(a.id)}" ${a.id === artifact.id ? "selected" : ""}>v${i + 1} \xB7 ${escape(a.name)}</option>`).join("") + `</select><button data-dialog-version="${escape(versions[index - 1]?.id ?? "")}" data-version-action="older" ${index === 0 ? "disabled" : ""}>\u4E0A\u4E00\u7248</button><button data-dialog-version="${escape(versions[index + 1]?.id ?? "")}" data-version-action="newer" ${index === versions.length - 1 ? "disabled" : ""}>\u4E0B\u4E00\u7248</button></div>`;
          if (artifact.revisedSummary) left += '<div class="gm-dialog-revision">' + value(artifact.revisedSummary, "Artifact.revisedSummary") + "</div>";
          left += executionInfo(step);
          left += '<h3>\u4EA7\u7269\u5185\u5BB9</h3><article class="gm-dialog-document">' + artifactBody(artifact) + "</article>";
          right = reviewPane(artifact);
          secondLabel = "\u8BC4\u5BA1";
        } else {
          const step = snap.steps.find((s) => s.id === dialogStepId);
          if (!step) return;
          const definition = procedure.actions.find((a) => a.id === step.source?.actionId);
          title = definition?.description ?? step.id;
          metadata = value(step.id, "Step.id") + pill(stepLabels[step.status], "", "Step.status");
          left = executionInfo(step);
          if (step.artifact?.mode === "collect") left += "<h3>\u5DF2\u6536\u96C6\u6210\u5458</h3>" + Object.entries(step.artifact.items).map(([from, ids]) => "<h4>" + value(from, "Step.artifact.items key") + "</h4>" + artifactLinks(ids.map((id) => ({ kind: "artifact", id })))).join("");
          else left += '<h3>\u4EA7\u7269\u5185\u5BB9</h3><div class="gm-dialog-empty">' + value("0 \u4EFD\u4EA7\u7269", "count(Artifact where stepId = Step.id)") + "</div>";
          right = '<h3>\u8BC4\u5BA1</h3><div class="gm-dialog-empty">' + value("0 \u6761\u8BC4\u5BA1", "count(Review for Artifact where stepId = Step.id)") + "</div>";
          secondLabel = "\u8BC4\u5BA1";
        }
        if (!runDialog) {
          runDialog = document.createElement("dialog");
          runDialog.className = "gm-run-dialog";
          root.append(runDialog);
          runDialog.addEventListener("cancel", (event) => {
            event.preventDefault();
            closeRunDialog();
          }, { signal: controller.signal });
        }
        let stepPicker = "";
        if (!compact) {
          const step = snap.steps.find((s) => s.id === (dialogKind === "artifact" ? snap.artifacts.find((a) => a.id === dialogArtifactId)?.stepId : dialogStepId));
          if (step) {
            const group = actionSteps(snap, step.source.actionId);
            stepPicker = '<label class="gm-dialog-step-picker">\u6267\u884C\u5B9E\u4F8B <select id="gm-dialog-step" aria-label="\u6267\u884C\u5B9E\u4F8B">' + group.map((s, i) => `<option value="${escape(s.id)}" ${s.id === step.id ? "selected" : ""}>\u7B2C ${i + 1} \u6B21 \xB7 ${escape(stepLabels[s.status])} \xB7 ${escape(s.id)}</option>`).join("") + "</select></label>";
          }
        }
        runDialog.dataset.kind = dialogKind;
        runDialog.dataset.layout = compact ? "compact" : "wide";
        runDialog.dataset.pane = dialogPane;
        const label = dialogKind === "edge" ? "\u8FB9\u8BE6\u60C5" : compact ? "\u8282\u70B9\u8BE6\u60C5" : "\u8FD0\u884C\u8BE6\u60C5";
        runDialog.setAttribute("aria-label", label);
        runDialog.innerHTML = '<header class="gm-dialog-head"><div><div class="gm-eyebrow">' + label + "</div><h2>" + escape(title) + '</h2><div class="gm-dialog-metadata">' + metadata + '</div></div><div class="gm-dialog-head-actions"><button data-run-close>\u5173\u95ED</button></div></header>' + stepPicker + (!compact ? '<div class="gm-dialog-mobile-tabs"><button data-dialog-pane="content" aria-pressed="' + (dialogPane === "content") + '">\u5185\u5BB9</button><button data-dialog-pane="review" aria-pressed="' + (dialogPane === "review") + '">' + secondLabel + "</button></div>" : "") + '<div class="gm-dialog-columns"><section class="gm-dialog-pane gm-dialog-content" aria-label="\u5185\u5BB9">' + left + "</section>" + (!compact ? '<section class="gm-dialog-pane gm-dialog-reviews" aria-label="' + secondLabel + '">' + right + "</section>" : "") + "</div>";
        if (!runDialog.open) runDialog.showModal();
        const target = focusSelector ? runDialog.querySelector(focusSelector) : runDialog.querySelector("[data-run-close]");
        (target?.disabled ? runDialog.querySelector("#gm-dialog-version") : target)?.focus();
      }
      function openStepDialog(id) {
        dialogStepId = id;
        const step = snapshot().steps.find((s) => s.id === id), versions = artifactVersions(snapshot(), id);
        const artifactId = step?.artifact?.mode === "produce" ? step.artifact.id : versions.at(-1)?.id;
        if (artifactId) {
          openArtifactDialog(artifactId);
          return;
        }
        dialogKind = "step";
        dialogPane = "content";
        renderRunDialog();
      }
      function openArtifactDialog(id) {
        dialogArtifactId = id;
        dialogKind = "artifact";
        dialogPane = "content";
        renderRunDialog();
      }
      function closeRunDialog() {
        restoringFocus = true;
        runDialog?.close();
        dialogKind = null;
        dialogStepId = null;
        state.edge = null;
        (opener?.isConnected ? opener : q(`[data-node="${state.node}"]`))?.focus();
        restoringFocus = false;
        hideEdgePreview();
      }
      function render() {
        root.dataset.sources = String(state.sources);
        qa("[data-view]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.view === state.view)));
        q("#gm-shared-panel").setAttribute("aria-labelledby", state.view === "run" ? "gm-run-tab" : "gm-definition-tab");
        q("#gm-meta").innerHTML = (state.view === "definition" ? pill(procedure.mode, "", "Procedure.mode") + value(`${procedure.actions.length} \u4E2A Action`, "count(Procedure.actions)") + value(`${procedure.actions.filter((a) => a.collect).length} \u4E2A collect`, "count(Action with collect)") : pill(runLabels[snapshot().run.status], "", "Run.status") + value(snapshot().run.name, "Run.name") + '<select aria-label="\u793A\u4F8B\u8BB0\u5F55" id="gm-scenario"><option value="fresh">\u521D\u59CB\u6837\u4F8B</option><option value="review">\u8BC4\u5BA1\u6837\u4F8B</option><option value="done">\u5B8C\u6210\u6837\u4F8B</option></select>') + `<label class="gm-source-toggle"><input id="gm-sources" type="checkbox" ${state.sources ? "checked" : ""}>\u5B57\u6BB5\u6765\u6E90</label>`;
        if (q("#gm-scenario")) q("#gm-scenario").value = state.scenario;
        q("#gm-bottomtext").textContent = state.view === "definition" ? "Procedure" : "Run / Step / Artifact / Review";
        renderNodes();
        renderEdges();
      }
      function modal(kind) {
        if (kind === "artifact") {
          openArtifactDialog(state.artifactId);
          return;
        }
        dialogKind = "source";
        renderRunDialog();
      }
      function zoom(mode) {
        const viewport = q(".gm-viewport");
        state.zoom = mode === "fit" ? Math.min(1, viewport.clientWidth / 746) : Math.max(0.5, Math.min(1.5, state.zoom + (mode === "in" ? 0.1 : -0.1)));
        q(".gm-world").style.transform = `scale(${state.zoom})`;
        q(".gm-world").style.marginBottom = `${420 * (state.zoom - 1)}px`;
        q("#gm-scale").textContent = Math.round(state.zoom * 100) + "%";
      }
      root.addEventListener("click", (e) => {
        const edge = e.target.closest("[data-edge]");
        if (edge) {
          selectEdge(edge.dataset.edge);
          return;
        }
        const b = e.target.closest("button");
        if (!b) return;
        if (b.dataset.view) {
          state.view = b.dataset.view;
          render();
        } else if (b.dataset.node) {
          opener = b;
          state.edge = null;
          state.node = b.dataset.node;
          hideEdgePreview();
          renderNodes();
          if (state.view === "definition") {
            dialogKind = "definition";
            renderRunDialog();
          } else {
            const steps = actionSteps(snapshot(), state.node);
            if (steps.length) {
              state.stepId = steps.at(-1).id;
              openStepDialog(state.stepId);
            } else {
              dialogKind = "empty";
              renderRunDialog();
            }
          }
        } else if (b.dataset.stepId) {
          opener = b;
          state.stepId = b.dataset.stepId;
          openStepDialog(state.stepId);
        } else if (b.dataset.artifactId) {
          opener = b;
          state.artifactId = b.dataset.artifactId;
          dialogStepId = state.stepId;
          openArtifactDialog(state.artifactId);
        } else if (b.dataset.dialogArtifact) {
          openArtifactDialog(b.dataset.dialogArtifact);
        } else if (b.dataset.dialogVersion) {
          dialogArtifactId = b.dataset.dialogVersion;
          renderRunDialog(`[data-version-action="${b.dataset.versionAction}"]`);
        } else if (b.hasAttribute("data-run-close")) closeRunDialog();
        else if (b.dataset.dialogPane) {
          dialogPane = b.dataset.dialogPane;
          runDialog.dataset.pane = dialogPane;
          runDialog.querySelectorAll("[data-dialog-pane]").forEach((tab) => tab.setAttribute("aria-pressed", String(tab.dataset.dialogPane === dialogPane)));
        } else if (b.dataset.zoom) zoom(b.dataset.zoom);
        else if (b.dataset.modal) {
          opener = b;
          modal(b.dataset.modal);
        }
      }, { signal: controller.signal });
      root.addEventListener("change", (e) => {
        if (e.target.id === "gm-scenario") {
          state.scenario = e.target.value;
          render();
        } else if (e.target.id === "gm-sources") {
          state.sources = e.target.checked;
          root.dataset.sources = String(state.sources);
        } else if (e.target.id === "gm-dialog-version") {
          dialogArtifactId = e.target.value;
          renderRunDialog("#gm-dialog-version");
        } else if (e.target.id === "gm-dialog-step") {
          state.stepId = e.target.value;
          openStepDialog(state.stepId);
        }
      }, { signal: controller.signal });
      root.addEventListener("keydown", (e) => {
        if (e.target.matches(".gm-edge-hit") && ["Enter", " "].includes(e.key)) {
          e.preventDefault();
          selectEdge(e.target.dataset.edge);
        }
        if (e.target.dataset.view && ["ArrowLeft", "ArrowRight"].includes(e.key)) {
          e.preventDefault();
          state.view = state.view === "run" ? "definition" : "run";
          render();
          q(`[data-view="${state.view}"]`).focus();
        }
      }, { signal: controller.signal });
      render();
      requestAnimationFrame(() => {
        if (!disposed) zoom("fit");
      });
      return () => {
        disposed = true;
        runDialog?.close();
        controller.abort();
        element.replaceChildren();
      };
    } } });
  }
});
export {
  actionSteps,
  artifactVersions,
  index_default as default,
  procedure,
  snapshots,
  statusCounts
};
