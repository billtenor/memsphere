# Run、CommandState 模型与辅助读取

模型 ID：memsphere/command-state.json。保存有状态命令组的一次连续执行所需信息，本轮只接自由探索。

## Run的成果人工调整

Run模型ID为memsphere/context_control/run.json。只持久化人工增删，不保存可推导的完整成果集合。完整定义及示例见run.schema.json，与reserved-models/context-control/run.json一致。

| 字段 | 类型 | 作用 |
| --- | --- | --- |
| outputOverrides | object，可省略 | 未人工调整时不填写；普通report及redo不写Run |
| outputOverrides.addedArtifactIds | array<string>，去重 | 明确保留为成果入口的完整submitted产物，直到手动移除 |
| outputOverrides.removedArtifactIds | array<string>，去重 | 明确隐藏的产物ID，直到手动添加；不删除产物或依赖 |

两组ID不得重叠。人工添加是显式保留，即使后来被依赖或修订仍保留；人工移除只针对具体ID，新修订ID可自动成为成果。

自动成果＝完整submitted产物中，未被其他完整产物依赖、也未被revisedFrom替换的产物。实际成果＝（自动成果∪人工添加）－人工移除。Snapshot.outputArtifactIds、View/API和outputs list均返回同一次Snapshot计算的结果，不回写Run或CommandState。

```json
{
  "id": "run-design",
  "name": "技术方案共创",
  "status": "running",
  "createdAt": "2026-10-25T08:00:00Z",
  "language": "zh-CN",
  "outputOverrides": {
    "addedArtifactIds": ["artifact-comparison"],
    "removedArtifactIds": ["artifact-intermediate"]
  }
}
```

finish显式确认最终根，在结束Run的同一次更新中写入相对自动成果的增删差值，不再保存第二份完整列表。终态不接受后续产物或人工调整，推导结果因此固定。已有finalArtifactIds／outputArtifactIds记录通过受限升级转换，保持原可见成果，历史Artifact和Review不变。CommandState的六字段及辅助state不变。

## CommandState六个字段

| 字段 | 类型 | 作用 |
| --- | --- | --- |
| id | string | 这份命令状态的稳定ID，也是data_id，对外作为前文ID |
| commandGroup | string | 命令组；Run相关统一为run，处理器按真实运行类型路由 |
| groupId | string | 关联业务实例ID；run组为Run ID，不在parameters.run重复保存 |
| status | active / closed | 命令状态进行中／已结束 |
| parameters | map<string,string> | 可承接的其余公共参数，本轮为project |
| state | object | 命令组解释的内部信息，不自动成为CLI参数 |

字段均必填；没有内部信息可用空对象。业务状态、可用命令和产物仍由原业务模型负责。当前操作对象、正文、评论、标签及依赖继续显式填写。

## Run组的辅助state

只保存可选lastArtifactId与reads：

```json
{
  "id": "context-001",
  "commandGroup": "run",
  "groupId": "run-001",
  "status": "active",
  "parameters": {
    "project": "memsphere"
  },
  "state": {
    "lastArtifactId": "artifact-A",
    "reads": {
      "external:source-D": {
        "readAt": "2026-10-25T06:01:00Z"
      }
    }
  }
}
```

lastArtifactId在首次report前省略，只作候选，不伪造成读取。reads以artifact:ID或external:ID为键，值保留实际readAt，同一材料去重。

能可靠识别前文才辅助记账；按已明确项目及Run查询唯一active记录时可归属，零条或多条不猜测。普通读取正文成功不依赖记账，不补读、不增加--for。

report捕获辅助快照和revision，沿原业务流程提交。真实读取可尽力归入Step.reads，上一份产物只加入候选，与实际dependencies比较；正常路径有未覆盖候选必须非阻断提醒。成功后尝试一次CAS更新lastArtifactId并清空reads；失败report不结转。

CAS冲突或辅助保存失败保留当前记录，不强制覆盖、不重跑已成功业务、不拒绝下一次正常提交。异常允许遗漏或过期候选；产物及真实依赖保持业务权威。业务redo由现有执行器负责，窗口不增加恢复身份、产物预留或提交日志。

## 存储与查找

Home级JSON ValueStore，data_id=id。Continue先按ID读记录，再定位project与groupId；status按commandGroup、groupId及project分页筛选全部匹配项，首版不加索引或重复的Run关联列表。多记录互相隔离，查询不创建新记录。

记录revision和时间使用ValueStore元数据，不在模型复制。更新使用单记录CAS。模型定义随内置资源发布，Home适配器复用现有Runtime及Store接口；物理目录不进入模型，不新增全局管理UI。

run start自动建立初始记录，后续沿用；本轮不做ACP、环境默认ID或Runner分配。finish／abandon使业务结束后尝试关闭命令状态；即使关闭辅助写入失败，仍根据真实Run状态阻止新的业务写入。保留已结束记录，不增加手动关闭或重开。

state顶层为明确object，动态JSON由命令组校验；当前Runtime能原样保存，但不提供动态子字段反射。不使用oneOf、跨模型引用或新的元模型。

## 完整Schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "title": "CommandState · 命令状态",
  "description": "有状态命令组的一次连续执行所持有的状态，区分业务实例关联、公共参数和命令组内部状态。",
  "properties": {
    "id": {
      "type": "string",
      "title": "命令状态标识",
      "description": "入口自动生成的稳定标识，对外作为前文 ID 使用；后续查询和继续执行沿用同一 ID。",
      "minLength": 1,
      "pattern": "\\S"
    },
    "commandGroup": {
      "type": "string",
      "title": "命令组",
      "description": "解释这份前文的命令组标识，用于选择参数校验、业务状态读取和后续命令处理逻辑。",
      "minLength": 1,
      "pattern": "\\S"
    },
    "groupId": {
      "type": "string",
      "title": "业务实例标识",
      "description": "命令组关联的业务实例 ID；run 命令组填写 Run ID。由命令组映射为相应 CLI 定位参数，不在 parameters 再保存一份。",
      "minLength": 1,
      "pattern": "\\S"
    },
    "status": {
      "type": "string",
      "title": "生命周期状态",
      "description": "这条命令状态是否仍在进行。active 为进行中，closed 为已结束；具体命令组负责结束规则。",
      "enum": [
        "active",
        "closed"
      ]
    },
    "parameters": {
      "type": "object",
      "title": "公共参数",
      "description": "可自动承接的其余公共命令参数；本轮保存 project，Run ID 使用 groupId。键为参数名，不带 -- 前缀，值为字符串。",
      "additionalProperties": {
        "type": "string"
      }
    },
    "state": {
      "type": "object",
      "title": "命令组状态",
      "description": "由 commandGroup 解释和校验的内部状态。通用 Runtime 保留整个 JSON 对象，动态子字段不提供字段级反射；不自动转为 CLI 参数。",
      "properties": {},
      "additionalProperties": true
    }
  },
  "required": [
    "id",
    "commandGroup",
    "groupId",
    "status",
    "parameters",
    "state"
  ],
  "additionalProperties": false,
  "examples": [
    {
      "id": "context-001",
      "commandGroup": "run",
      "groupId": "run-001",
      "status": "active",
      "parameters": {
        "project": "memsphere"
      },
      "state": {
        "lastArtifactId": "artifact-A",
        "reads": {
          "external:source-D": {
            "readAt": "2026-10-25T06:01:00Z"
          }
        }
      }
    }
  ]
}
```
