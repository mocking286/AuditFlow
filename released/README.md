# released/ — JEAuditFlow 发布归档

本目录是 **JEAuditFlow**（ASPICE 内审桌面工作台，Windows 便携版 + 后端服务端）的发布归档索引。
二进制安装包托管在 **GitHub Releases**，本目录只存放可版本化、可 diff、可校验的文本元数据。

## 为什么二进制不在本目录里

| 约束 | 数值 | 结论 |
| --- | --- | --- |
| GitHub 单文件 push 硬上限 | 100 MB | 便携包 181 MB，直接 push 会被服务端拒绝 |
| Git LFS 免费额度 | 1 GB 存储 + 1 GB/月流量 | 每版约 180 MB，约 5 个版本即耗尽并弹出付费墙 |
| GitHub Release 附件 | 单文件 2 GB，公开仓库总量不限 | 免费、不占 LFS 额度、不拖慢 `git clone` |

因此大包一律以 **Release 附件**分发；仓库 `.gitignore` 已忽略 `*.zip`，本目录另加 `.gitignore` 兜底，
防止误将安装包提交入库。

## 目录结构

```
released/
├── README.md             # 本文件：归档说明、版本索引、发布流程
├── SHA256SUMS.txt        # 累积校验和清单（严格 sha256sum -c 格式，逐版本追加）
├── manifest.json         # 机器可读版本索引（供构建脚本 / 更新器消费）
├── v<version>.md         # 每版发布说明（与 Release 正文同源）
└── scripts/
    └── publish-release.sh # 一键发布新版本（校验 → 打 tag → 上传 → 更新索引 → 提交）
```

## 版本索引

<!-- BEGIN RELEASE INDEX
（本表由 `released/scripts/publish-release.sh` 自动生成，请勿手工编辑）

| 版本 | 发布日期 | 渠道 | 文件 | 大小 | SHA256（前 16 位） | 下载 |
| --- | --- | --- | --- | --- | --- | --- |
| 7.5.0 | 2026-11-10 | installation-guide | `INSTALL-7.5-ZH.md` | 0.00 MiB | `e48b66aa06945533` | [下载](https://github.com/mocking286/AuditFlow/releases/download/JEAuditFlow-v7.5.0/INSTALL-7.5-ZH.md) |
| 7.5.0 | 2026-11-10 | backend-server | `JEAuditFlow-7.5.0-Backend.zip` | 0.89 MiB | `f9975648d1528036` | [下载](https://github.com/mocking286/AuditFlow/releases/download/JEAuditFlow-v7.5.0/JEAuditFlow-7.5.0-Backend.zip) |
| 7.5.0 | 2026-11-10 | release-manifest | `JEAuditFlow-7.5.0-Browser-Extension.manifest.json` | 0.00 MiB | `179fd8c41c28c48d` | [下载](https://github.com/mocking286/AuditFlow/releases/download/JEAuditFlow-v7.5.0/JEAuditFlow-7.5.0-Browser-Extension.manifest.json) |
| 7.5.0 | 2026-11-10 | browser-extension | `JEAuditFlow-7.5.0-Browser-Extension.zip` | 68.61 MiB | `e2ec4d0b4c57cead` | [下载](https://github.com/mocking286/AuditFlow/releases/download/JEAuditFlow-v7.5.0/JEAuditFlow-7.5.0-Browser-Extension.zip) |
| 7.5.0 | 2026-11-10 | complete-install | `JEAuditFlow-7.5.0-Complete-Install.zip` | 145.99 MiB | `b8183a265dba071f` | [下载](https://github.com/mocking286/AuditFlow/releases/download/JEAuditFlow-v7.5.0/JEAuditFlow-7.5.0-Complete-Install.zip) |
| 7.5.0 | 2026-11-10 | database-initialization | `JEAuditFlow-7.5.0-Database.tar.gz` | 0.01 MiB | `6b1204b0f7ada254` | [下载](https://github.com/mocking286/AuditFlow/releases/download/JEAuditFlow-v7.5.0/JEAuditFlow-7.5.0-Database.tar.gz) |
| 7.5.0 | 2026-11-10 | database-initialization | `JEAuditFlow-7.5.0-Database.zip` | 0.02 MiB | `dd3fa98c9e31e603` | [下载](https://github.com/mocking286/AuditFlow/releases/download/JEAuditFlow-v7.5.0/JEAuditFlow-7.5.0-Database.zip) |
| 7.5.0 | 2026-11-10 | release-manifest | `JEAuditFlow-7.5.0-Deployment-Support.manifest.json` | 0.00 MiB | `c4b6049b633b2f5c` | [下载](https://github.com/mocking286/AuditFlow/releases/download/JEAuditFlow-v7.5.0/JEAuditFlow-7.5.0-Deployment-Support.manifest.json) |
| 7.5.0 | 2026-11-10 | deployment-support | `JEAuditFlow-7.5.0-Deployment-Support.zip` | 0.13 MiB | `068e160769730166` | [下载](https://github.com/mocking286/AuditFlow/releases/download/JEAuditFlow-v7.5.0/JEAuditFlow-7.5.0-Deployment-Support.zip) |
| 7.5.0 | 2026-11-10 | web-client | `JEAuditFlow-7.5.0-Web-Client.zip` | 74.90 MiB | `ebe9d9c9e2890047` | [下载](https://github.com/mocking286/AuditFlow/releases/download/JEAuditFlow-v7.5.0/JEAuditFlow-7.5.0-Web-Client.zip) |
| 7.5.0 | 2026-11-10 | macos-launcher | `JEAuditFlow-7.5.0-macOS-Launcher.app.zip` | 1.39 MiB | `be2f0cfc29897c01` | [下载](https://github.com/mocking286/AuditFlow/releases/download/JEAuditFlow-v7.5.0/JEAuditFlow-7.5.0-macOS-Launcher.app.zip) |
| 7.5.0 | 2026-11-10 | release-manifest | `JEAuditFlow-7.5.0-macOS-Launcher.manifest.json` | 0.00 MiB | `15d758661dc550bc` | [下载](https://github.com/mocking286/AuditFlow/releases/download/JEAuditFlow-v7.5.0/JEAuditFlow-7.5.0-macOS-Launcher.manifest.json) |
| 7.5.0 | 2026-11-10 | release-notes | `RELEASE-NOTES-7.5-ZH.md` | 0.00 MiB | `c0096e8fd95b9cf1` | [下载](https://github.com/mocking286/AuditFlow/releases/download/JEAuditFlow-v7.5.0/RELEASE-NOTES-7.5-ZH.md) |
| 7.5.0 | 2026-11-10 | checksums | `SHA256SUMS.txt` | 0.00 MiB | `11e88ed866d6e683` | [下载](https://github.com/mocking286/AuditFlow/releases/download/JEAuditFlow-v7.5.0/SHA256SUMS.txt) |
| 7.5.0 | 2026-11-10 | verification | `VERIFICATION-7.5.0.json` | 0.00 MiB | `ad1d937cd812d56a` | [下载](https://github.com/mocking286/AuditFlow/releases/download/JEAuditFlow-v7.5.0/VERIFICATION-7.5.0.json) |
| 7.5.0 | 2026-11-10 | release-manifest | `release-manifest.json` | 0.00 MiB | `e03f099901d0dec7` | [下载](https://github.com/mocking286/AuditFlow/releases/download/JEAuditFlow-v7.5.0/release-manifest.json) |
| 7.4.0 | 2026-11-06 | backend-server | `JEAuditFlow-7.4.0-Backend.zip` | 0.89 MiB | `d74ce9842f24e916` | [下载](https://github.com/mocking286/AuditFlow/releases/download/JEAuditFlow-v7.4.0/JEAuditFlow-7.4.0-Backend.zip) |
| 7.4.0 | 2026-11-06 | browser-extension | `JEAuditFlow-7.4.0-Browser-Extension.zip` | 68.59 MiB | `576e7f2ff5a6cb3d` | [下载](https://github.com/mocking286/AuditFlow/releases/download/JEAuditFlow-v7.4.0/JEAuditFlow-7.4.0-Browser-Extension.zip) |
| 7.4.0 | 2026-11-06 | installation-guide | `JEAuditFlow-7.4.0-Installation-Guide.md` | 0.01 MiB | `91650a515b39d04f` | [下载](https://github.com/mocking286/AuditFlow/releases/download/JEAuditFlow-v7.4.0/JEAuditFlow-7.4.0-Installation-Guide.md) |
| 5.55.0 | 2026-10-09 | backend-server | `JEAuditFlow-5.55.0-Backend.zip` | 27.87 MiB | `c3d250d21c5eccdd` | [下载](https://github.com/mocking286/AuditFlow/releases/download/JEAuditFlow-v5.55.0/JEAuditFlow-5.55.0-Backend.zip) |
| 5.55.0 | 2026-10-09 | generic | `JEAuditFlow-5.55.0-Browser-Extension.zip` | 13.07 MiB | `ba0b069e43c45ed5` | [下载](https://github.com/mocking286/AuditFlow/releases/download/JEAuditFlow-v5.55.0/JEAuditFlow-5.55.0-Browser-Extension.zip) |
| 4.2.0 | 2026-09-22 | backend-server | `JEAuditFlow-4.2.0-Backend.zip` | 11.27 MiB | `35d7aea5568f2817` | [下载](https://github.com/mocking286/AuditFlow/releases/download/JEAuditFlow-v4.2.0/JEAuditFlow-4.2.0-Backend.zip) |
| 4.2.0 | 2026-09-22 | windows-portable | `JEAuditFlow-4.2.0-Portable-win-x64.zip` | 180.78 MiB | `193783b0cc8f5f52` | [下载](https://github.com/mocking286/AuditFlow/releases/download/JEAuditFlow-v4.2.0/JEAuditFlow-4.2.0-Portable-win-x64.zip) |

<!-- END RELEASE INDEX -->

发布日期取构建清单 `generatedAt`；归档入库日期见 `manifest.json` 的 `archivedAt`。

## tag 与命名规范

- **tag**：`JEAuditFlow-v<version>`，例如 `JEAuditFlow-v4.2.0`
  - tag 由 `gh release create --target main` 在创建 Release 时自动创建，因此指向的是**当时默认分支的尖端提交**。
    由于脚本采用「先上传附件、后提交索引」的顺序（上传失败时不会留下指向空 Release 的坏索引），
    tag 可能比记录本版元数据的索引提交**早一个提交**。这是刻意的取舍：宁可 tag 位置略旧，也不要出现索引残缺或附件丢失。
  - 如需精确对应，可在发布后手动 `git tag -f -a <tag> <索引提交> && git push -f origin <tag>`
    —— 但已公开的 tag 不建议重写，这里仅作说明。
- **文件名**：`JEAuditFlow-<version>-<channel>.zip`，`channel` 取值 `Portable-win-x64` / `Backend`
- **发布说明**：`released/v<version>.md`，正文与 GitHub Release 描述保持一致
- **提交信息**：`release(jeauditflow): v<version>`（遵循仓库既有的 Conventional Commits 风格）

## 发布新版本

前置：`gh` 已登录（`gh auth status`）、本地已有构建产物。

```bash
# 1. 写发布说明
$EDITOR released/v4.3.0.md

# 2. 预演（只打印计划，不做任何写操作）
released/scripts/publish-release.sh \
    --version 4.3.0 \
    --notes-file released/v4.3.0.md \
    --asset /path/to/JEAuditFlow-4.3.0-Portable-win-x64.zip \
    --asset /path/to/JEAuditFlow-4.3.0-Backend.zip \
    --dry-run

# 3. 正式发布
released/scripts/publish-release.sh \
    --version 4.3.0 \
    --notes-file released/v4.3.0.md \
    --asset /path/to/JEAuditFlow-4.3.0-Portable-win-x64.zip \
    --asset /path/to/JEAuditFlow-4.3.0-Backend.zip
```

脚本会依次完成：校验文件存在与大小上限 → 计算 SHA256 → 打 tag 并创建 Release（附件上传）
→ 追加 `SHA256SUMS.txt` → 更新 `manifest.json` → 提交并推送 `released/`。

## 校验下载的安装包

```bash
# 方式一：比对仓库内校验和清单
grep 'JEAuditFlow-4.2.0-Portable-win-x64.zip' released/SHA256SUMS.txt
shasum -a 256 JEAuditFlow-4.2.0-Portable-win-x64.zip

# 方式二：直接读取 GitHub 侧记录的摘要（无需重新下载）
gh api repos/mocking286/AuditFlow/releases/tags/JEAuditFlow-v4.2.0 \
  --jq '.assets[] | "\(.name)\t\(.size)\t\(.digest)"'
```

## 相关链接

- 仓库：<https://github.com/mocking286/AuditFlow>
- 全部发布：<https://github.com/mocking286/AuditFlow/releases>
- 版本记录（Web 工作台线）：[`CHANGELOG.md`](../CHANGELOG.md)
