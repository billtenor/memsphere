#!/usr/bin/env bash
memsphere run start --name '团队复盘清单' --output json > run-receipt.json
node -e 'const fs=require("fs"); const r=JSON.parse(fs.readFileSync("run-receipt.json")); fs.writeFileSync("current-run.txt",r.runId||r.id||r.run?.id)'
