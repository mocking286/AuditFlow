# Install AuditFlow v9.6.0 in Microsoft Edge

## 1. 加载扩展

1. 打开 edge://extensions。
2. 开启开发人员模式。
3. v9.6.0 保留现有工作区、图片证据、Trace 工具栏、项目浏览器、评分模型和证据关联；此次版本继续兼容已有本地工作区。
4. 新安装时解压 `AuditFlow-v9.6.0-extension.zip`，选择“加载解压缩的扩展”，并选择包含根级 `manifest.json` 的文件夹。
5. 固定 AuditFlow 图标。

v9.6.0 使用本机身份配置，不请求远程登录、Microsoft Entra 或云协作服务，因此不会因跨源登录请求而卡在登录页。每个本机用户都拥有管理员权限和一个可完整编辑的默认项目；仅三个获授权邮箱可看到完整的 `CEP XP ASPICE CL2 过程评估与整改` 项目。

## 2. 使用工具栏弹窗

- 点击浏览器工具栏中的 AuditFlow 图标。
- 弹窗会列出正在进行的审核项目，并显示 AI 服务和 Helix Bridge 的就绪状态。
- 选择项目可直接打开相应审核；选择进入首页可打开工作台总览。

## 3. 复核 BP / GP AI 初稿

1. 进入 ASPICE 项目并运行“AI 预评估”或打开顶部“AI 评审”。
2. 在“评定结果（BP + GP · AI 初稿，可复核改定）”按过程、指标或复核状态筛选。
3. 用评分下拉快速改定；需要补充理由、证据引用或 O/W/R 时点击“核对详情”。
4. Codex 参考评审仅使用已定稿记录，并另存版本；结果必须由评估师复核。

## 4. 使用内嵌 Audit Master 与受控基线

1. 进入项目“范围与资料”，点击右上角 `Audit Master` 小按钮。
2. 选择已上传文件或 Helix 条目，确认 Direct / Corroborating / Index-only。模型开关启用时只发送所选摘要和定位，不发送文件 Blob。
3. 点击“分析并回流意见”。结果以 Index-only 的 AI Review Opinion 保存，并自动转到 AI 评审等待人工复核。
4. 在“版本与基线”先确认全部文档条目，再创建 Draft；提交 Independent Reviewer 完成独立回复后，由 Lead Assessor 或 Configuration Manager 批准。

## 5. MAN.3 / SUP.8 支持域专项子项目

1. 在“审核总览”或“ASPICE 评估”列表中，点击父项目行的图层按钮“生成 MAN.3 / SUP.8 专项子项目”。
2. 选择 MAN.3、SUP.8 和需要继承的父项目证据；子项目只处理上传文件实际出现的问题，不生成完整 BP/GP 清单。
3. 在子项目“范围与资料 / Scope”阶段上传问题清单、项目计划或配置管理材料，点击“识别问题并配对 BP/GP”。
4. 在“评定结果（BP + GP · AI 初稿，可复核改定）”逐条核对 Issue 定位、候选 BP/GP、评分、证据作用和最小关闭证据。AI 初稿必须由评估师人工复核。
5. 全部问题复核后点击“一键回写原项目”。系统追加草稿弱项和候选追溯，保留原项目已有人工评分和正式范围；回写本身不代表过程关闭或能力等级达成。

## 6. 启动本机 bridge（可选）

扩展本身不需要 Node.js。报告、导出和评估计算直接在浏览器中执行。本机 bridge 只用于显式启用的 Codex 对话；安装包不包含 `node_modules`。

```bash
start-auditflow-codex-bridge.cmd
```

首次使用时，可先在电脑上完成 `codex login`，或在 bridge 启动后通过工作台输入 Virtual Key。随后双击 `start-auditflow-codex-bridge.cmd` 并保持该窗口运行；它只绑定 `http://127.0.0.1:4173`，不需要安装额外 Node 包。若旧 bridge 正在占用 4173 端口，请先关闭旧窗口再启动 9.6.0 bridge。`Local rules available`、`Local bridge reachable` 和 `Model session available` 是三个独立状态。Codex 意见请求最长等待 5 分钟；超过该时限时界面会明确提示模型超时，而不会误报“连接脚本未就绪”。

## 7. 配置模型复核（可选）

1. 在工作台右上角进入设置。
2. 打开 AI 与本地解析设置，再选择 Codex / Virtual Key。
3. 模型复核默认关闭；任何可能产生费用或把评估摘要发送到外部模型的配置，都必须由用户在操作当时明确授权。AuditFlow 不购买服务或资源。
4. 输入 Virtual Key 并保存。该 Key 仅保存在本机 AI 服务进程内存中，浏览器存储、扩展压缩包和日志均不会保留它。
5. AI 服务未就绪时，AuditFlow 自动使用本地规则评估；这不会阻塞文件解析、人工审核或项目操作。

## 8. 功能安全与网络安全审核

1. 打开“自定义审核”，选择“ISO 26262 功能安全审核”或“ISO/SAE 21434 网络安全审核”。
2. 依次完成范围、计划、证据、AI 分析、人工复核和关闭；上传文件后先核对抽取文本、作用域和原文定位。
3. 旧版 `.doc` 使用本地启发式抽取，可能丢失表格和页码；可转换为 `.docx` 后重新上传，正式判断必须核对原件。
4. AI 初稿受证据护栏限制，关联过程只作佐证；全部审核项人工复核、证据充分且开放弱项关闭后才允许主审核员关闭项目。

## 9. 本机单用户与项目管理

1. v9.6.0 删除多人编辑、成员切换、编辑锁、远端事件和角色配置；当前登录档案始终是本机 Administrator。
2. 所有用户登录后都能打开和完整编辑本机默认项目。创建项目后，可在项目设置中修改项目名称、受评组织、评估范围、产品/项目、PAM、目标等级及其他评估元数据。
3. `CEP XP ASPICE CL2 过程评估与整改` 只对 `yumeng.li@johnsonelectric.com`、`Anne.q.Liu@johnsonelectric.com`、`alan.wh.zhuang@johnsonelectric.com`（邮箱匹配不区分大小写）显示。

## 10. 语言与夜间模式

- 右上角月亮/太阳按钮切换白天和 GitHub Dark 夜间模式。
- 紧邻的 EN / ZH 按钮切换中文和英文。英文模式会将界面、可见评估内容和模型输出统一为英文。

## 本地数据

- 项目与评估元数据：扩展 localStorage。
- 记录附件 Blob：IndexedDB。
- 报告与备份：本机受控输出目录（仅在 AI 服务可用时生成）。
- Helix Bridge：仍可使用 helix-bridge.ps1 或 start-helix-bridge.cmd；其状态独立于 AI 服务。
