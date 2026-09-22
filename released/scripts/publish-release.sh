#!/usr/bin/env bash
#
# released/scripts/publish-release.sh — JEAuditFlow 一键发布
#
# 一次完成：校验产物 → 计算 SHA256 → 打 tag 建 Release 上传附件
#           → 更新 SHA256SUMS.txt → 更新 manifest.json → 重建 README 版本索引
#           → 提交并推送 released/（纯文本，可 diff、可追溯）
#
# 用法:
#   released/scripts/publish-release.sh \
#       --version 4.3.0 \
#       --notes-file released/v4.3.0.md \
#       --asset /path/JEAuditFlow-4.3.0-Portable-win-x64.zip \
#       --asset /path/JEAuditFlow-4.3.0-Backend.zip \
#       [--tag JEAuditFlow-v4.3.0] [--repo owner/name] \
#       [--dry-run] [--replace] [--skip-push]
#
set -Eeuo pipefail

REPO_DEFAULT="mocking286/AuditFlow"
PRODUCT="JEAuditFlow"
MAX_ASSET_BYTES=$((2 * 1024 * 1024 * 1024))   # GitHub Release 单附件上限 2 GiB

VERSION=""; TAG=""; REPO="$REPO_DEFAULT"
NOTES=""; NOTES_FILE=""
DRY_RUN=0; REPLACE=0; SKIP_PUSH=0
ASSETS=()

die()  { printf '\033[31m[错误]\033[0m %s\n' "$*" >&2; exit 1; }
info() { printf '\033[36m[信息]\033[0m %s\n' "$*"; }
ok()   { printf '\033[32m[完成]\033[0m %s\n' "$*"; }
warn() { printf '\033[33m[警告]\033[0m %s\n' "$*" >&2; }

usage() { sed -n '3,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version)     VERSION="${2:-}"; shift 2 ;;
    --tag)         TAG="${2:-}"; shift 2 ;;
    --repo)        REPO="${2:-}"; shift 2 ;;
    --notes)       NOTES="${2:-}"; shift 2 ;;
    --notes-file)  NOTES_FILE="${2:-}"; shift 2 ;;
    --asset)       ASSETS+=("${2:-}"); shift 2 ;;
    --dry-run)     DRY_RUN=1; shift ;;
    --replace)     REPLACE=1; shift ;;
    --skip-push)   SKIP_PUSH=1; shift ;;
    -h|--help)     usage ;;
    *)             die "未知参数: $1（用 --help 查看用法）" ;;
  esac
done

# ---------- 1. 参数与前置校验 ----------
[[ -n "$VERSION" ]] || die "缺少 --version"
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.]+)?$ ]] \
  || die "版本号格式不合法: $VERSION（期望 主.次.修，如 4.3.0）"
[[ ${#ASSETS[@]} -gt 0 ]] || die "至少需要一个 --asset"
[[ -n "$TAG" ]] || TAG="${PRODUCT}-v${VERSION}"

command -v gh  >/dev/null 2>&1 || die "未找到 gh，请先安装 GitHub CLI"
command -v git >/dev/null 2>&1 || die "未找到 git"
command -v python3 >/dev/null 2>&1 || die "未找到 python3（用于更新索引文件）"
gh auth status >/dev/null 2>&1 || die "gh 未登录，请先执行: gh auth login"

REPO_ROOT="$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)" \
  || die "无法定位仓库根目录（本脚本需位于 git 仓库内）"
RELEASED_DIR="$REPO_ROOT/released"
[[ -f "$RELEASED_DIR/manifest.json" ]] || die "缺少 $RELEASED_DIR/manifest.json"

BRANCH="$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD)"
[[ "$BRANCH" == "HEAD" ]] && die "当前处于 detached HEAD，请先切到 main"

# NOTES 解析
NOTES_FILE_ABS=""
if [[ -n "$NOTES_FILE" ]]; then
  [[ -f "$NOTES_FILE" ]] || die "发布说明文件不存在: $NOTES_FILE"
  NOTES_FILE_ABS="$(cd "$(dirname "$NOTES_FILE")" && pwd)/$(basename "$NOTES_FILE")"
elif [[ -n "$NOTES" ]]; then
  NOTES_FILE_ABS="$(mktemp -t jeauditflow-notes-XXXXXX)"
  printf '%s\n' "$NOTES" > "$NOTES_FILE_ABS"
else
  CAND="$RELEASED_DIR/v${VERSION}.md"
  [[ -f "$CAND" ]] && NOTES_FILE_ABS="$CAND" \
    || die "缺少发布说明：请用 --notes-file 指定，或用 --notes 直接给出"
fi

# 产物校验（存在性 / 非空 / 大小上限）+ 计算摘要
TMP_TS="$(mktemp -t jeauditflow-assets-XXXXXX)"
trap 'rm -f "$TMP_TS"' EXIT

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
  else shasum -a 256 "$1" | awk '{print $1}'; fi
}
human() { awk -v b="$1" 'BEGIN{printf "%.2f MiB", b/1048576}'; }
channel_of() {
  case "$(basename "$1")" in
    *Backend*)  echo "backend-server" ;;
    *Portable*) echo "windows-portable" ;;
    *)          echo "generic" ;;
  esac
}

info "校验 ${#ASSETS[@]} 个产物…"
: > "$TMP_TS"
for a in "${ASSETS[@]}"; do
  [[ -f "$a" ]] || die "产物不存在: $a"
  abs="$(cd "$(dirname "$a")" && pwd)/$(basename "$a")"
  size="$(wc -c < "$abs" | tr -d ' ')"
  [[ "$size" -gt 0 ]] || die "产物为空文件: $a"
  if [[ "$size" -gt "$MAX_ASSET_BYTES" ]]; then
    die "$(basename "$a") 为 $(human "$size")，超过 Release 单附件 2 GiB 上限"
  fi
  [[ "$size" -gt 104857600 ]] && warn "$(basename "$a") 为 $(human "$size")（>100MB，故不入 git 库，走 Release 附件）"
  sha="$(sha256_of "$abs")"          # 只算一次，避免对大包重复哈希
  printf '%s\t%s\t%s\t%s\t%s\n' \
    "$(basename "$abs")" "$(channel_of "$abs")" "$size" "$sha" "$abs" >> "$TMP_TS"
  ok "$(basename "$abs")  $(human "$size")  sha256=$(printf '%s' "$sha" | cut -c1-16)…"
done

# tag 冲突检查
TAG_EXISTS=0
if gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1; then
  TAG_EXISTS=1
  if [[ "$REPLACE" -eq 0 ]]; then
    die "Release $TAG 已存在。若确要覆盖，加 --replace"
  fi
  warn "Release $TAG 已存在，--replace 生效：将覆盖同名附件"
fi

ARCHIVED_AT="$(date -u +%Y-%m-%d)"
ARCHIVED_AT_ISO="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
PUBLISHED_AT="${ARCHIVED_AT_ISO}"

# ---------- 2. dry-run 计划 ----------
if [[ "$DRY_RUN" -eq 1 ]]; then
  echo
  info "===== DRY RUN（未做任何写操作）====="
  printf '  仓库      : %s\n  分支      : %s\n  版本      : %s\n  tag       : %s\n' "$REPO" "$BRANCH" "$VERSION" "$TAG"
  printf '  发布说明  : %s\n  归档日期  : %s\n  覆盖已有  : %s\n' "$NOTES_FILE_ABS" "$ARCHIVED_AT" "$([[ $REPLACE -eq 1 ]] && echo 是 || echo 否)"
  echo "  附件:"
  while IFS=$'\t' read -r f ch sz sh _; do printf '    - %-46s %-18s %s\n' "$f" "$ch" "$(human "$sz")"; done < "$TMP_TS"
  echo "  将更新: released/SHA256SUMS.txt, released/manifest.json, released/README.md"
  echo "  将提交: release(jeauditflow): v${VERSION}"
  echo
  ok "计划检查通过。去掉 --dry-run 即正式发布。"
  exit 0
fi

# ---------- 3. 创建 / 更新 Release ----------
# tag 由 gh 在创建 Release 时自动指向默认分支当前提交（macOS 自带 bash 3.2，
# 故不使用 mapfile 等 bash 4+ 内建命令）。
collect_asset_paths() {
  ASSET_PATHS=()
  local p
  while IFS= read -r p; do
    [[ -n "$p" ]] && ASSET_PATHS+=("$p")
  done < <(cut -f5 "$TMP_TS")
}
collect_asset_paths
[[ ${#ASSET_PATHS[@]} -gt 0 ]] || die "未解析到任何待上传产物"

echo
if [[ "$TAG_EXISTS" -eq 1 ]]; then
  info "覆盖已有 Release $TAG …"
  gh release edit "$TAG" --repo "$REPO" \
    --title "${PRODUCT} v${VERSION}" --notes-file "$NOTES_FILE_ABS"
  gh release upload "$TAG" --repo "$REPO" --clobber "${ASSET_PATHS[@]}"
else
  info "创建 Release $TAG 并上传附件（大包可能耗时数分钟）…"
  gh release create "$TAG" --repo "$REPO" \
    --title "${PRODUCT} v${VERSION}" \
    --notes-file "$NOTES_FILE_ABS" \
    --target "$BRANCH" \
    "${ASSET_PATHS[@]}"
fi
ok "Release 已就绪: https://github.com/${REPO}/releases/tag/${TAG}"

# 回读 GitHub 侧摘要，与本地比对（不重新下载）
info "校验 GitHub 侧附件摘要…"
while IFS=$'\t' read -r f ch sz sh _; do
  remote="$(gh api "repos/${REPO}/releases/tags/${TAG}" \
            --jq ".assets[] | select(.name==\"${f}\") | \"\(.size)\t\(.digest // \"\")\"" 2>/dev/null || true)"
  [[ -n "$remote" ]] || die "GitHub 上未找到附件 $f"
  rsize="${remote%%$'\t'*}"; rdig="${remote##*$'\t'}"
  [[ "$rsize" == "$sz" ]] || die "$f 大小不一致：本地 $sz / 远端 $rsize"
  if [[ -n "$rdig" && "$rdig" != "sha256:${sh}" ]]; then
    die "$f 摘要不一致：本地 sha256:${sh} / 远端 ${rdig}"
  fi
  ok "$f 远端比对通过（大小${rdig:+, 摘要}一致）"
done < "$TMP_TS"

# ---------- 4. 更新索引文件（manifest / SHA256SUMS / README） ----------
echo
info "更新归档索引…"
REL_VERSION="$VERSION" REL_TAG="$TAG" REL_REPO="$REPO" \
REL_NOTES_FILE="${NOTES_FILE_ABS#$REPO_ROOT/}" REL_NOTES="$NOTES" \
REL_PUBLISHED_AT="$PUBLISHED_AT" REL_ARCHIVED_AT="$ARCHIVED_AT" \
REL_ARCHIVED_AT_ISO="$ARCHIVED_AT_ISO" \
python3 "$RELEASED_DIR/scripts/update_index.py" "$REPO_ROOT" "$TMP_TS" \
  || die "索引更新失败（已上传的 Release 不受影响，修正后可重跑）"
ok "索引已更新"

# ---------- 5. 提交并推送 ----------
cd "$REPO_ROOT"
git add released
if git diff --cached --quiet; then
  warn "release/ 无变化，跳过提交"
else
  git commit -q -m "release(jeauditflow): v${VERSION}

- 归档 ${PRODUCT} v${VERSION} 至 GitHub Release 附件（tag: ${TAG}）
- 更新 released/SHA256SUMS.txt 与 released/manifest.json
- 发布说明: ${REL_NOTES_FILE:-released/v${VERSION}.md}"
  ok "已提交: $(git log -1 --pretty=%h) $(git log -1 --pretty=%s | head -1)"
fi

if [[ "$SKIP_PUSH" -eq 1 ]]; then
  warn "--skip-push 生效，请手动推送: git push origin ${BRANCH}"
  exit 0
fi

info "推送 ${BRANCH} …"
git fetch -q origin "$BRANCH"
if ! git merge-base --is-ancestor "origin/$BRANCH" HEAD; then
  info "远端有新提交，先 rebase…"
  git pull -q --rebase origin "$BRANCH"
fi
git push -q origin "$BRANCH"
ok "已推送 origin/${BRANCH}"

echo
ok "发布完成"
printf '  版本页 : https://github.com/%s/releases/tag/%s\n' "$REPO" "$TAG"
printf '  全部发布: https://github.com/%s/releases\n' "$REPO"
