# Project Store example

This trusted App expects the current Project to register a ValueStore using model `example/expense.json`. Create that model and Store before installing; the Store may already contain records. The App does not create or own either asset. It includes a backend and a small terminal caller, with no View page.

For a Store ID `business/expenses`, save `{"expensesStore":"business/expenses"}` in a JSON file and run `memsphere app install <this-directory> --config <file>`, `memsphere app check org.example.project-store`, and `memsphere app enable org.example.project-store`. Use `memsphere app show org.example.project-store` to inspect its target. `app configure` replaces the complete configuration.

A View may call `read` with `{id}` and pass its returned `token` with `{id,value,token}` to `save`, or `{id,token}` to `remove`. The response includes `storeId` so the caller can display the actual target.

To try the caller against a running local Memsphere View service:

```sh
node examples/apps/project-store/client.mjs http://127.0.0.1:<port> <project-name> <record-id>
```

The terminal displays the source Store and record. Enter `save {"amount":8}`, `delete`, `read`, or `quit`. If another window or Agent rebinds the App before saving or deleting, it displays “数据来源已改变，请刷新并重新确认目标后再保存或删除。”, reads and displays the new target, and leaves both Stores unchanged. It does not automatically retry. The next save/delete asks for `yes` to confirm the displayed Store; any other answer cancels it. A further binding change is rejected again. This prevents silently applying an edit to a newly selected source.

`record-editor.mjs` demonstrates the caller-side refresh and confirmation contract through supplied display and confirmation callbacks. The terminal caller is for a local View service; deployments requiring additional operator credentials should supply the appropriate headers through `createHttpInvoker` rather than print credentials. See [the App contract](../../../docs/app-contract.en.md) for concurrency, cancellation and operation-lifetime constraints.
