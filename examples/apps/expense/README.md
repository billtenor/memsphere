# Expense App / 费用记录

This App provides a View and an independent `expense` CLI over the same filesystem ValueStore and business rules. It is an integration example, not an accounting or reimbursement system.

费用记录 App 用同一业务实现和账本提供 View 与独立 CLI 入口，支持录入、查询和提交。它是整合示例，不包含报销审批或财务核算。

## Author build / 作者构建

At the Memsphere repository root / 在 Memsphere 仓库根目录：

```bash
npm ci
npm run build
```

Copy this entire directory to distribute the App. The build creates `cli/expense.cjs`, a standalone Node executable bundling the public `memsphere/data` APIs; it does not need the repository or a running Memsphere server. The View uses the host's public `@memsphere/view-sdk`. All backend imports are local to this directory.

复制本目录即可交付。构建后的 CLI 不依赖仓库源码或运行中的 Memsphere 服务；View 使用宿主公开 SDK，backend 仅引用目录内共享业务代码。使用者安装发行目录时不需要重新构建 Memsphere。

## Install / 安装

Obtain the built directory as `expense-app`. Install its external CLI into a directory you own / 取得构建好的 `expense-app` 目录，将 CLI 安装到自己的工具目录：

```bash
npm install --global --prefix "$HOME/.local" ./expense-app/cli
export PATH="$HOME/.local/bin:$PATH"
expense --version
```

Save `my-expense.json` with an absolute ledger path / 保存配置，填写绝对账本路径：

```json
{ "ledgerDirectory": "/absolute/path/to/my-ledger" }
```

Install Memsphere first following the [repository setup instructions](../../../README.en.md). If `my-project` does not exist, create it with `memsphere project create my-project`.

先按[仓库安装说明](../../../README.md)安装 Memsphere；尚无 `my-project` 时，执行 `memsphere project create my-project`。然后安装 App：

```bash
memsphere --project my-project app install ./expense-app --config ./my-expense.json
memsphere --project my-project app check org.memsphere.expense
memsphere --project my-project app enable org.memsphere.expense
memsphere --project my-project app show org.memsphere.expense
memsphere view restart
memsphere view status
```

Open the service URL returned by `view status`, select `my-project`, then **费用 / Expenses**; or append `/projects/my-project/modules/expense/expenses` to that URL. The App is disabled immediately after installation; enable it explicitly. If the executable is not on PATH, save `{ "schemaVersion": 1, "executable": "/absolute/path/to/expense" }` to `binding.json` and run:

安装后默认停用，需显式启用。打开 `view status` 返回的服务地址，选择 `my-project` 后点击费用导航；也可将上述页面路径拼接到服务地址后直接打开。工具不在 PATH 时可指定其绝对路径：

```bash
memsphere --project my-project cli bind org.memsphere.expense-cli --app org.memsphere.expense --binding binding.json
```

This retains the manifest's fixed ledger arguments / 该绑定保留清单中的固定账本参数。

## Agent and CLI / Agent 与工具

```bash
memsphere --project my-project memory read concepts/expense-app
memsphere --project my-project cli show org.memsphere.expense-cli --app org.memsphere.expense --output json
expense --ledger /absolute/path/to/my-ledger create --description Lunch --amount 42.5
expense --ledger /absolute/path/to/my-ledger list
expense --ledger /absolute/path/to/my-ledger submit --id RECORD_ID --revision 1
```

Use the invocation returned by `cli show`, including its working directory and fixed arguments. Amount must be positive, description nonempty, and only a draft at the expected revision may be submitted. Both entrypoints call `backend/business.mjs`. View lists up to 100 records; CLI `list --cursor <cursor>` continues pagination.

Agent 必须带上 show 返回的固定参数和工作目录。金额为正、说明非空，只有 revision 匹配的草稿可提交。CLI 写入后点击页面刷新即可看到；View 写入后 CLI list 可查到。

Use a different ledger directory for each Project to isolate business data. Disablement blocks new App requests and removes View contributions after restart, while preserving data and readable Memory. It does not disable the standalone executable. Upgrade and uninstall are outside this version.

不同 Project 应配置不同账本目录。停用立即阻止新 App 请求，重启后撤销界面贡献，保留数据与可读 Memory；独立 CLI 仍可运行。首版不支持升级或卸载。
