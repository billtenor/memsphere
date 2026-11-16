import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { createHttpInvoker, createRecordEditor } from "./record-editor.mjs";

const [baseUrl, project, id] = process.argv.slice(2);
if (!baseUrl || !project || !id) {
  console.error("用法：node client.mjs <View地址> <Project名称> <记录ID>");
  process.exitCode = 2;
} else {
  const terminal = createInterface({ input: stdin, output: stdout });
  const editor = createRecordEditor({
    invoke: createHttpInvoker({ baseUrl, project }),
    notify: message => console.log(message),
    showRecord: current => console.log(`当前记录：${JSON.stringify({ storeId: current.storeId, record: current.record })}`),
    confirmTarget: async ({ operation, storeId }) => {
      const answer = await terminal.question(`确认在 ${storeId} ${operation === "save" ? "保存" : "删除"}？输入 yes 确认：`);
      return answer.trim() === "yes";
    }
  });
  try {
    await editor.load(id);
    console.log("命令：read / save <JSON> / delete / quit");
    while (true) {
      const command = (await terminal.question("命令> ")).trim();
      if (command === "quit") break;
      try {
        if (command === "read") await editor.load(id);
        else if (command.startsWith("save ")) await editor.save(JSON.parse(command.slice(5)));
        else if (command === "delete") await editor.remove();
        else console.log("请输入 read、save <JSON>、delete 或 quit。");
      } catch (error) { console.error(`${error.code ?? "APP_ERROR"}: ${error.message}`); }
    }
  } catch (error) {
    console.error(`${error.code ?? "APP_ERROR"}: ${error.message}`);
    process.exitCode = 1;
  } finally { terminal.close(); }
}
