#!/usr/bin/env bash
set -Eeuo pipefail

POOL_NAME="${POOL_NAME:-miroir}"
KUBE_DEBUG_IMAGE="${KUBE_DEBUG_IMAGE:-busybox:1.36}"

usage() {
  cat <<EOF
Usage: $0 [--yes] <node> <device>

Create the ZFS pool ${POOL_NAME} for miroir on a whole, wiped disk.
<device> must be a /dev/disk/by-id/ path. Without -f, zpool create refuses
disks that still carry partitions or filesystems.

Environment overrides:
  POOL_NAME
  KUBE_DEBUG_IMAGE
EOF
}

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

assume_yes=0
args=()

while (( $# > 0 )); do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    -y|--yes)
      assume_yes=1
      ;;
    -*)
      die "Unknown option: $1"
      ;;
    *)
      args+=("$1")
      ;;
  esac
  shift
done

(( ${#args[@]} == 2 )) || { usage >&2; exit 1; }
node="${args[0]}"
device="${args[1]}"

[[ "$device" == /dev/disk/by-id/* ]] || die "Device must be a /dev/disk/by-id/ path"
command -v kubectl >/dev/null 2>&1 || die "kubectl is required"
: "${KUBECONFIG:?KUBECONFIG must be set; run through mise exec}"

printf 'Node:   %s\nPool:   %s\nDevice: %s\n' "$node" "$POOL_NAME" "$device"

if (( assume_yes == 0 )); then
  printf 'Type "yes" to create the pool: '
  read -r answer || die "Confirmation required"
  [[ "$answer" == "yes" ]] || die "Aborted"
fi

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

    # Talos has a read-only root, so the pool itself must never mount.
    chroot /host zpool create \
      -o ashift=12 \
      -o autotrim=on \
      -O mountpoint=none \
      -O atime=off \
      "$pool_name" \
      "$pool_disk"

    chroot /host zpool status "$pool_name"
  ' sh "$POOL_NAME" "$device"
