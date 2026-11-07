# Project Store example

This trusted backend-only App expects the current Project to register a ValueStore using model `example/expense.json`. Create that model and Store before installing; the Store may already contain records. The App does not create or own either asset.

For a Store ID `business/expenses`, save `{"expensesStore":"business/expenses"}` in a JSON file and run `memsphere app install <this-directory> --config <file>`, `memsphere app check org.example.project-store`, and `memsphere app enable org.example.project-store`. Use `memsphere app show org.example.project-store` to inspect its target. `app configure` replaces the complete configuration.

A View may call the `read` operation with `{id}` and then pass the returned `token` with `{id,value,token}` to `save`. After rebinding or removing/re-registering the Store, discard the old response and read again. The example has no View; callers must handle errors and refresh. See [the App contract](../../../docs/app-contract.en.md) for concurrency, cancellation and operation-lifetime constraints.
