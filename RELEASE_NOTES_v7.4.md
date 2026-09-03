# AuditFlow v7.4.0 Release Notes

AuditFlow v7.4 把项目阶段导航、证据文件、文档条目和外部 Codex 评审统一到可复核的 ASPICE 工作流中。

## 主要变化

- 评估流程导航固定在每个项目阶段顶部。除项目概况外，各阶段不再重复项目总体信息。
- 范围与资料按真实来源文件归并；点击文件行右侧按钮可展开内部需求、观察和表格记录。
- 需求 DOCX 按稳定需求 ID 拆分，并保留章节、定位、Allocation、ASIL、Origin、Product variant 和 Status。
- 逐条评审按过程域显示所有文档条目，支持审核员修正过程分类与 Direct / Corroborating / Index-only 证据角色。
- aspice-audit-master 可导出 `auditflow-ai-review/v1` 文件；AI 评审页导入后只更新未人工复核的候选，正式结论仍需审核员确认。

## 迁移与安装

工作区数据库从 29 升级到 30。迁移保留现有项目、证据、人工评分、记录、追溯和历史版本，只补充 7.4 所需字段。升级前建议导出工作区备份，并在 `edge://extensions` 对原解压扩展选择新目录或重新加载；不要先移除旧扩展。
