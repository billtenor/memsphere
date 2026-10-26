#!/usr/bin/env bash
cp "$1/test/fixtures/legacy-general-task/2cfca6f713d106c402bd9ffa7c693129442ac30035529abc1a50ed12e0e6922d.yaml" .memsphere/memory/procedures/memsphere-general-task-execution.yaml
if [[ "$PWD" == *018-custom-legacy* ]]; then
  python3 - <<'PY'
from pathlib import Path
p=Path('.memsphere/memory/procedures/memsphere-general-task-execution.yaml')
s=p.read_text().replace('用于完成没有专用 Procedure 覆盖的一般任务。','用于为五人团队制定 30 分钟每周复盘议程的专用流程。').replace('存在适用的专用 Procedure 时，不得使用本流程。','本流程只处理每周复盘议程。')
p.write_text(s)
PY
fi
