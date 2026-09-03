# AuditFlow v8.3.0

## Trace 交互

- 三栏 Evidence Trace 工作台的目录、关系列表和 Evidence Inventory 都可独立上下滚动；小屏自动恢复页面纵向滚动。
- Evidence Inventory 的 `Confirm link` 按钮移动到 `ID / locator` 单元格下方并放大，关系标记保留在 Action 区。
- 备注、收藏、浏览中、差评、好评、有疑问六种标记都写入当前项目的关系记录。备注会打开内置表单，保存后直接显示在关系卡片中，并写入操作日志。

## English surface

- 扩展页增加刷新后的实时翻译进度条，完成 100% 后自动隐藏。
- 增加 Trace、文件类别、关系标记和报告常用术语翻译；原始证据仍保留在中文模式和本地数据中，未知业务文本在英文模式显示为 `Original-language content`，避免把未经验证的机器翻译当作审计证据。

## ASPICE 护栏

- 关系备注和六种标记属于评审工作台记录，不改变 Direct / Corroborating / Index-only 证据角色，不改变人工评级和关闭门禁。
- 版本升级为 `8.3.0`，数据库迁移版本升级为 `41`。

## 验证

- `npm run check`：发布 smoke、协作 smoke 和语法检查全部通过。
