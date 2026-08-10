#!/usr/bin/env bash
set -Eeuo pipefail

POOL_NAME="${POOL_NAME:-zfs-pool}"
PARTLABEL="${PARTLABEL:-r-zfs-pool}"
POOL_DISK="/dev/disk/by-partlabel/${PARTLABEL}"
KUBE_DEBUG_IMAGE="${KUBE_DEBUG_IMAGE:-busybox:1.36}"

usage() {
  cat <<EOF
Usage: $0 [--yes] [node ...]

Create ${POOL_NAME} on ${POOL_DISK}. Without node arguments, targets every
Kubernetes node.

Environment overrides:
  POOL_NAME
  PARTLABEL
  KUBE_DEBUG_IMAGE
EOF
}

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

assume_yes=0
nodes=()

while (( $# > 0 )); do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    -y|--yes)
      assume_yes=1
      ;;
    --)
      shift
      nodes+=("$@")
      break
      ;;
    -*)
      die "Unknown option: $1"
      ;;
    *)
      nodes+=("$1")
      ;;
  esac
  shift
done

command -v kubectl >/dev/null 2>&1 || die "kubectl is required"
: "${KUBECONFIG:?KUBECONFIG must be set; run through mise exec}"

if (( ${#nodes[@]} == 0 )); then
  node_resources="$(kubectl get nodes -o name)"
  while IFS= read -r node_resource; do
    [[ -n "$node_resource" ]] && nodes+=("${node_resource#node/}")
  done <<< "$node_resources"
fi

(( ${#nodes[@]} > 0 )) || die "No Kubernetes nodes found"

printf 'Pool:      %s\nPartition: %s\nNodes:\n' "$POOL_NAME" "$POOL_DISK"
printf '  %s\n' "${nodes[@]}"

if (( assume_yes == 0 )); then
  printf 'Type "yes" to create missing pools: '
  read -r answer || die "Confirmation required"
  [[ "$answer" == "yes" ]] || die "Aborted"
fi

for node in "${nodes[@]}"; do
  printf '\n[%s] Ensuring ZFS pool %s exists\n' "$node" "$POOL_NAME"

  kubectl debug \
    "node/${node}" \
    --namespace=kube-system \
    --image="$KUBE_DEBUG_IMAGE" \
    --profile=sysadmin \
    --quiet \
    -i \
    -- \
    sh -ec '
      pool_name=$1
      pool_disk=$2

      if chroot /host zpool list -H -o name "$pool_name" >/dev/null 2>&1; then
        echo "ZFS pool $pool_name already exists; skipping"
        chroot /host zpool status "$pool_name"
        exit 0
      fi

      if [ ! -b "/host${pool_disk}" ]; then
        echo "ERROR: Block device $pool_disk does not exist" >&2
        exit 1
      fi

      chroot /host zpool create \
        -m legacy \
        -o ashift=12 \
        -O compression=on \
        -O atime=off \
        "$pool_name" \
        "$pool_disk"

      chroot /host zpool status "$pool_name"
    ' sh "$POOL_NAME" "$POOL_DISK"
done
