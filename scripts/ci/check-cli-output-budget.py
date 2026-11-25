#!/usr/bin/env python3
"""Replay the approved CLI scenarios using the built candidate and pinned tokenizer."""

import importlib.metadata
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile

import tiktoken

TOKENIZER_VERSION = "0.12.0"
REPO = Path(__file__).resolve().parents[2]
GRAPH = """!procedure
syntax: memsphere-20261027-stable
mode: graph
name: schema-cli
defines: [Report]
actions:
  - !action
    id: report
    description: Report
    dependencies: [!dependency {from: START}]
    artifact:
      name: Report
      model:
        definedBy: memsphere/schema.json
        definition: |
          !schema
          syntax: memsphere-20261027-stable
          type: object
          fields: [summary]
      payload: {contentType: application/json}
"""
FLOW = """!procedure
syntax: memsphere-20261027-stable
name: flow-output-audit
flow:
  - !action
    action: Produce a sample Artifact.
    artifact: !artifact
      name: sample result
"""

def check_tokenizer() -> None:
    actual = importlib.metadata.version("tiktoken")
    if actual != TOKENIZER_VERSION:
        raise RuntimeError(f"Expected tiktoken {TOKENIZER_VERSION}, found {actual}")


def replay(language, tokenizer):
    with tempfile.TemporaryDirectory(prefix="memsphere-output-check-") as directory:
        temporary = Path(directory)
        workspace = temporary / "workspace"
        home = temporary / "home"
        workspace.mkdir()
        (workspace / "graph.yaml").write_text(GRAPH, encoding="utf-8")
        (workspace / "flow.yaml").write_text(FLOW, encoding="utf-8")
        env = {key: value for key, value in os.environ.items()
               if not key.startswith(("MEMSPHERE_", "GIT_CONFIG_KEY_", "GIT_CONFIG_VALUE_"))
               and key not in {"CODEX_THREAD_ID", "TRAECLI_THREAD_ID", "NODE_OPTIONS"}}
        env.update(MEMSPHERE_HOME=str(home), GIT_CONFIG_COUNT="2",
                   GIT_CONFIG_KEY_0="user.name", GIT_CONFIG_VALUE_0="Fixture",
                   GIT_CONFIG_KEY_1="user.email", GIT_CONFIG_VALUE_1="fixture@example.invalid")

        def invoke(*args, project=True):
            scope = ["--project", "prompt-audit"] if project else []
            result = subprocess.run(["node", str(REPO / "dist/cli.js"), *scope, *args],
                                    cwd=workspace, env=env, capture_output=True, check=True, timeout=25)
            if result.stderr:
                raise RuntimeError(result.stderr.decode())
            return result.stdout

        def measured(name, stdout, budgets):
            raw = stdout.decode("utf-8")
            normalized = raw.replace(str(temporary), "<FIXTURE>")
            normalized = re.sub(r"run-\d{8}-\d{6}z-[0-9a-f]{8}", "run-20000101-000000z-00000000", normalized)
            normalized = re.sub(r"[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}",
                                "00000000-0000-0000-0000-000000000000", normalized)
            normalized = re.sub(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z",
                                "2000-01-01T00:00:00.000Z", normalized)
            tokens = tokenizer.encode_ordinary(normalized)
            if not tokens or len(stdout) > budgets[0] or len(tokens) > budgets[1]:
                raise RuntimeError(f"{language} {name}: {len(stdout)} bytes and {len(tokens)} tokens exceed {budgets}")
            print(json.dumps({"language": language, "case": name, "bytes": len(stdout), "tokens": len(tokens)}))

        invoke("project", "create", "prompt-audit", "--bind", project=False)
        config_file = home / "config.json"
        config = json.loads(config_file.read_text(encoding="utf-8")) if config_file.exists() else {}
        config_file.write_text(json.dumps({**config, "language": language}), encoding="utf-8")
        invoke("run", "start", "--name", "fixture")
        exploration = json.loads(invoke("run", "start", "--name", "fixture-json", "--output", "json"))["runId"]
        invoke("run", "report", "--run", exploration, "--name", "example", "--artifact", "hello", "--output", "json")
        graph = json.loads(invoke("run", "start", "--file", "graph.yaml", "--name", "graph-schema", "--output", "json"))
        flow = json.loads(invoke("run", "start", "--file", "flow.yaml", "--name", "flow audit", "--output", "json"))
        for name, args, text_budget, json_budget in [
            ("run list", ["run", "status"], (350, 125), (700, 200)),
            ("graph status", ["run", "status", "--run", graph["runId"]], (950, 300), (1100, 325)),
            ("exploration status", ["run", "status", "--run", exploration], (600, 210), (600, 210)),
        ]:
            text = invoke(*args)
            raw_json = invoke(*args, "--output", "json")
            measured(name + " text", text, text_budget)
            measured(name + " JSON", raw_json, json_budget)
            public = json.loads(raw_json)
            if name == "run list":
                assert len(public["runs"]) == 4
                assert all(row["runId"].encode() in text for row in public["runs"])
            elif name == "graph status":
                assert public["status"] == "running" and public["schemaPhase"] == "not_started"
                assert public["nextAction"]["args"] == ["--project", "prompt-audit", "run", "enter-schema",
                    "--run", graph["runId"], "--step", graph["stepId"]]
                assert b"enter-schema" in text and b"schema report" not in text
            else:
                assert public["runId"] == exploration and public["completedSteps"] == 1
                assert b"hello" not in text and b"hello" not in raw_json
        assert json.loads(invoke("run", "status", "--run", flow["runId"], "--output", "json"))["runId"] == flow["runId"]


if __name__ == "__main__":
    check_tokenizer()
    encoding = tiktoken.get_encoding("o200k_base")
    for locale in ("zh-CN", "en"):
        replay(locale, encoding)
