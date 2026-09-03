# AuditFlow v7.3.0 Release Notes

## 版本目标

v7.3 以专业 ASPICE 评估师连续工作为中心，参考 Sharpen360 Trace 的 Plan Assessment、Scope、Grid View、List View、Close Assessment 和 Reports 交互结构。它让评估师保持在同一个项目上下文中完成范围确认、资料上传、逐条评分、记录、证据关联、AI 复核、关闭和报告。

## 主要变化

- 顶部评估命令栏集成十个生命周期入口，并保存为可直接打开的阶段 URL。
- 左侧过程域轨道持续展示 SYS.1~SYS.5、SWE.1~SWE.6、MAN.3、SUP.1/SUP.8/SUP.9/SUP.10 等项目已选正式范围。
- Scope 中上传并本地解析 Office、PDF、Helix 和文本证据，同时显示当前过程的直接资料、实例和关联过程。
- Grid View 中间逐条评审 BP/GP，右侧固定显示当前指标的 AI 候选、人工评分、记录和证据关联。
- List View 并排展示 Assessment Scope、Records & confirmed links 和 Evidence Inventory，用于证据溯源与人工确认。
- 关闭评估与报告拆分；报告未过门禁时仍可预览，但明确标记 Draft。
- AI 预评估、AI 评审、评估师改定、记录合并、版本、MAN.3/SUP.8 专项子项目、Helix 导入和报告生成全部保留。

## ASPICE 评估边界

- 只有正式范围内过程的 BP/GP 进入评分和能力等级判断。
- Direct 证据必须来自目标过程、可定位并证明项目实际执行。
- Corroborating 证据只能证明接口、一致性、配置、问题或变更闭环，不替代目标过程直接实施证据。
- Index-only 只能证明资料存在。
- AI 结论始终是候选；评估师确认范围、证据强度、评分和正式结论。
- Weakness 的关闭链应覆盖问题登记、变更控制、工作产品更新、验证和受控基线。

## 数据迁移

- Extension and local backend version: `7.3.0`.
- Workspace database version: `29`.
- v7.2 数据原位保留；旧 evidence / conduct / trace 路径兼容映射到 scope / grid / list。

## 安装

解压 `AuditFlow-v7.3.0-extension.zip`，在 Microsoft Edge 的 `edge://extensions` 开启开发人员模式并选择“加载解压缩的扩展”。升级前先从旧版导出工作区备份；不要先移除已加载扩展。
