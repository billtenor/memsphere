import { defineViewPlugin, portableSlots } from "@memsphere/view-sdk";
export default defineViewPlugin({
  apiVersion: 1,
  inject: ["slots", "ui"],
  uiVersion: 1,
  apply(ctx) {
    if (!ctx.module.appId || !ctx.ui) throw new Error("App settings context required");
    ctx.slots.register(portableSlots.appSettingsConfiguration, {
      id: "expense-settings",
      key: ctx.module.appId,
      value: { render(context) {
        return ctx.ui.settingsForm({ context, sections: [{
          id: "expense-defaults",
          title: {text: "费用偏好 / Expense preferences"},
          description: {text: "配置由框架持久化；费用业务与设置页使用同一份 App 配置。"},
          fields: [
            {kind:"text",path:["ledgerDirectory"],label:{text:"账本目录 / Ledger directory"}}
          ]
        }] });
      }}
    });
  }
});
