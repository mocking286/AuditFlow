#!/usr/bin/env python3
"""released/scripts/update_index.py — 发布归档索引生成器（由 publish-release.sh 调用）

用法:
    python3 update_index.py <repo_root> <assets_tsv>

<assets_tsv> 每行: 文件名 <TAB> 渠道 <TAB> 字节数 <TAB> sha256 <TAB> 本地绝对路径

环境变量:
    REL_VERSION        版本号，如 4.3.0
    REL_TAG            git tag，如 JEAuditFlow-v4.3.0
    REL_REPO           owner/name
    REL_NOTES_FILE     发布说明在仓库内的相对路径（可空）
    REL_NOTES          简短说明（可空）
    REL_PUBLISHED_AT   发布时间 ISO8601（UTC）
    REL_ARCHIVED_AT    归档日期 YYYY-MM-DD
    REL_ARCHIVED_AT_ISO 归档时间 ISO8601（UTC）

幂等：同一版本重复执行只覆盖该版本条目，不产生重复行。
"""
import json
import os
import re
import sys
from pathlib import Path

IDX_BEGIN = "<!-- BEGIN RELEASE INDEX"
IDX_END = "<!-- END RELEASE INDEX -->"
TABLE_HEADER = (
    "| 版本 | 发布日期 | 渠道 | 文件 | 大小 | SHA256（前 16 位） | 下载 |\n"
    "| --- | --- | --- | --- | --- | --- | --- |"
)


def vkey(version: str):
    """把版本号转成可比较的元组，'4.10.0' 应大于 '4.9.0'。"""
    out = []
    for part in re.split(r"[.\-+]", version):
        out.append((0, int(part)) if part.isdigit() else (1, part))
    return out


def human(n: int) -> str:
    return f"{n / 1048576:.2f} MiB"


def load_assets(tsv: Path):
    assets = []
    for raw in tsv.read_text(encoding="utf-8").splitlines():
        if not raw.strip():
            continue
        fields = raw.split("\t")
        if len(fields) < 4:
            raise SystemExit(f"[错误] 附件清单格式异常: {raw!r}")
        name, channel, size, sha = fields[0], fields[1], int(fields[2]), fields[3]
        assets.append({"file": name, "channel": channel, "size": size, "sha256": sha})
    assets.sort(key=lambda a: a["file"])
    return assets


def update_manifest(root: Path, assets, env):
    """合并式更新：已存在版本保留其扩展字段（capabilityVersion / sourceManifests 等），
    避免自动生成时静默丢字段。"""
    path = root / "released" / "manifest.json"
    manifest = json.loads(path.read_text(encoding="utf-8"))
    version, tag, repo = env["REL_VERSION"], env["REL_TAG"], env["REL_REPO"]

    existing = next(
        (r for r in manifest.get("releases", []) if r.get("version") == version), None
    )
    old_assets = {a.get("file"): a for a in (existing or {}).get("assets", [])}

    enriched = []
    for a in assets:
        item = dict(old_assets.get(a["file"], {}))   # 先继承既有扩展字段
        item.update(a)
        item.setdefault("platform", "any")
        if item["channel"] == "windows-portable":
            item["platform"] = "win-x64"
            item.setdefault("packageType", "portable")
        elif item["channel"] == "backend-server":
            item["packageType"] = "backend-server"
        else:
            item.setdefault("packageType", "generic")
        # 首次归档时记录构建时间；重复执行时保留原值，保证幂等，
        # 也避免用一个统一时间覆盖掉各产物自身不同的构建时间。
        item.setdefault("builtAt", env["REL_PUBLISHED_AT"])
        item["url"] = f"https://github.com/{repo}/releases/download/{tag}/{a['file']}"
        enriched.append(item)

    entry = dict(existing or {})                     # 先继承既有条目字段
    entry.update({
        "version": version,
        "tag": tag,
        "releaseUrl": f"https://github.com/{repo}/releases/tag/{tag}",
        "archivedAt": env["REL_ARCHIVED_AT"],
    })
    if existing and existing.get("publishedAt"):
        entry["publishedAt"] = existing["publishedAt"]   # 保留首次构建时间
    else:
        entry["publishedAt"] = env["REL_PUBLISHED_AT"]
    if env.get("REL_NOTES_FILE"):
        entry["notesFile"] = env["REL_NOTES_FILE"]
    if env.get("REL_NOTES"):
        entry["notes"] = env["REL_NOTES"]
    entry["assets"] = enriched

    releases = [r for r in manifest.get("releases", []) if r.get("version") != version]
    releases.append(entry)
    releases.sort(key=lambda r: vkey(r.get("version", "0")), reverse=True)

    manifest["releases"] = releases
    manifest["updatedAt"] = env["REL_ARCHIVED_AT_ISO"]
    path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return releases


def update_sums(root: Path, assets):
    """严格 sha256sum -c 格式；同文件名覆盖，按文件名排序输出。"""
    path = root / "released" / "SHA256SUMS.txt"
    comments, entries = [], {}
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.startswith("#"):
                comments.append(line)
            elif line.strip():
                parts = line.split()
                if len(parts) >= 2:
                    entries[parts[-1]] = f"{parts[0]}  {parts[-1]}"
    for a in assets:
        entries[a["file"]] = f"{a['sha256']}  {a['file']}"

    if not comments:
        comments = ["# JEAuditFlow 发布归档校验和清单"]
    body = "\n".join(comments) + "\n" + "\n".join(
        entries[k] for k in sorted(entries)
    ) + "\n"
    path.write_text(body, encoding="utf-8")


def update_readme(root: Path, releases):
    path = root / "released" / "README.md"
    text = path.read_text(encoding="utf-8")
    start = text.find(IDX_BEGIN)
    end = text.find(IDX_END)
    if start == -1 or end == -1:
        raise SystemExit(
            f"[错误] {path} 缺少索引标记 {IDX_BEGIN} … {IDX_END}，无法自动重建索引表"
        )
    head_end = text.find("\n", start) + 1

    rows = [TABLE_HEADER]
    for rel in releases:
        version = rel.get("version", "")
        date = (rel.get("publishedAt") or rel.get("archivedAt") or "")[:10]
        for a in rel.get("assets", []):
            rows.append(
                "| {v} | {d} | {c} | `{f}` | {s} | `{h}` | [下载]({u}) |".format(
                    v=version,
                    d=date,
                    c=a.get("channel", ""),
                    f=a["file"],
                    s=human(a["size"]),
                    h=a["sha256"][:16],
                    u=a.get("url", ""),
                )
            )
    new_block = (
        text[start:head_end]
        + "（本表由 `released/scripts/publish-release.sh` 自动生成，请勿手工编辑）\n\n"
        + "\n".join(rows)
        + "\n\n"
    )
    path.write_text(text[:start] + new_block + text[end:], encoding="utf-8")


def main():
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    root = Path(sys.argv[1]).resolve()
    assets = load_assets(Path(sys.argv[2]))
    env = {k: os.environ.get(k, "") for k in (
        "REL_VERSION", "REL_TAG", "REL_REPO", "REL_NOTES_FILE", "REL_NOTES",
        "REL_PUBLISHED_AT", "REL_ARCHIVED_AT", "REL_ARCHIVED_AT_ISO",
    )}
    for required in ("REL_VERSION", "REL_TAG", "REL_REPO", "REL_ARCHIVED_AT_ISO"):
        if not env[required]:
            raise SystemExit(f"[错误] 缺少环境变量 {required}")

    releases = update_manifest(root, assets, env)
    update_sums(root, assets)
    update_readme(root, releases)
    print(f"[信息] manifest 现有 {len(releases)} 个版本："
          + ", ".join(r.get("version", "?") for r in releases))


if __name__ == "__main__":
    main()
