#!/usr/bin/env bash
set -euo pipefail

mode="dry-run"
restart=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      mode="dry-run"
      ;;
    --apply)
      mode="apply"
      ;;
    --restart)
      restart=1
      ;;
    --help|-h)
      echo "Usage: scripts/deploy-toolforge.sh [--dry-run|--apply] [--restart]"
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 2
      ;;
  esac
  shift
done

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

toolforge_login="${TOOLFORGE_LOGIN:-schiste}"
toolforge_tool="${TOOLFORGE_TOOL:-maphue}"
toolforge_host="${TOOLFORGE_HOST:-login.toolforge.org}"
toolforge_ssh_key="${TOOLFORGE_SSH_KEY:-}"

if ! [[ "$toolforge_login" =~ ^[A-Za-z0-9._@-]+$ ]]; then
  echo "Invalid TOOLFORGE_LOGIN: $toolforge_login" >&2
  exit 2
fi

if ! [[ "$toolforge_tool" =~ ^[a-z0-9][a-z0-9-]*$ ]]; then
  echo "Invalid TOOLFORGE_TOOL: $toolforge_tool" >&2
  exit 2
fi

if [[ -n "$toolforge_ssh_key" && ! -f "$toolforge_ssh_key" ]]; then
  echo "TOOLFORGE_SSH_KEY does not point to a readable file." >&2
  exit 2
fi

remote="${toolforge_login}@${toolforge_host}"
remote_project="/data/project/${toolforge_tool}"
webservice_dir="${remote_project}/public_html"

ssh_options=(-o ConnectTimeout=15)
if [[ -n "$toolforge_ssh_key" ]]; then
  ssh_options=(-i "$toolforge_ssh_key" -o IdentitiesOnly=yes "${ssh_options[@]}")
fi

ssh_transport="ssh"
for option in "${ssh_options[@]}"; do
  printf -v quoted_option "%q" "$option"
  ssh_transport+=" ${quoted_option}"
done

rsync_options=(-az --chmod=Du=rwx,Dgo=rx,Fu=rw,Fgo=r --delete --delete-excluded)
if [[ "$mode" == "dry-run" ]]; then
  rsync_options+=(--dry-run --itemize-changes)
fi

site_filters=(
  --include=/index.html
  --include=/styles.css
  --include=/robots.txt
  --include=/healthz
  --include=/assets/
  --include=/assets/***
  --include=/data/
  --include=/data/***
  --include=/js/
  --include=/js/***
  --exclude=*
)

run_as_tool() {
  ssh "${ssh_options[@]}" "$remote" become "$toolforge_tool" "$@"
}

if [[ "$mode" == "apply" ]]; then
  run_as_tool mkdir -p "$webservice_dir"
else
  echo "Dry run: checking ${remote}:${webservice_dir}"
  run_as_tool test -d "$webservice_dir" || echo "Remote directory will be created during deployment."
fi

echo "Syncing Maphue browser assets (${mode})"
rsync \
  "${rsync_options[@]}" \
  "${site_filters[@]}" \
  --rsync-path="become ${toolforge_tool} rsync" \
  -e "$ssh_transport" \
  ./ \
  "${remote}:${webservice_dir}/"

if [[ "$mode" == "apply" ]]; then
  echo "Installing service.template"
  rsync \
    -az \
    --chmod=Fu=rw,Fgo=r \
    --rsync-path="become ${toolforge_tool} rsync" \
    -e "$ssh_transport" \
    toolforge/service.template \
    "${remote}:${remote_project}/service.template"
fi

if [[ "$restart" -eq 1 ]]; then
  if [[ "$mode" == "dry-run" ]]; then
    echo "Dry run: would restart the ${toolforge_tool} webservice."
  else
    echo "Restarting the ${toolforge_tool} webservice"
    run_as_tool toolforge webservice restart || run_as_tool toolforge webservice start
  fi
fi

if [[ "$mode" == "dry-run" ]]; then
  echo "Dry run complete."
else
  echo "Deployed: https://${toolforge_tool}.toolforge.org/"
fi
