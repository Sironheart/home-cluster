# Rook/Ceph → miroir: rebuild the cluster from scratch

Take final backups, record the exact kopia snapshot of every volume, wipe all
three nodes and bootstrap a new cluster from Git and 1Password. Every Kopiur
volume is restored from its recorded snapshot before the workload that owns it
starts; PostgreSQL recovers from Barman. Stateful apps stay offline from
phase 2 until phase 6.

Kanidm gets extra care: its restore is proven on the old cluster before
anything is wiped, and Kaniop only starts once the restored volume matches
that proof file for file. An empty Kanidm volume would force every user to
re-enroll their credentials.

Run every block in fish from the repository root with mise active
(`mise.toml` provides the tools and the Kubernetes/Talos configs), in one
session: later blocks use variables set by earlier ones.

## Target layout

- **miroir** 0.12.9, three data replicas, `freeze` quorum, RWX gateway on.
  DRBD replicates between nodes; **ZFS** is each node's backing pool
  (`miroir` zpool on the whole SN700, zvols under `miroir/volumes`, zstd).
- Talos image ships `siderolabs/drbd` **and** `siderolabs/zfs`; ARC capped at 8GiB.
- Crucial system disk: EPHEMERAL + 128GiB `local-hostpath` only, no ZFS partition.
- `miroir-replicated` (default class) for all app claims, `miroir-staging`
  (one replica, RWO) for Kopiur's short-lived backup clones.
- PostgreSQL stays on `openebs-hostpath` and recovers from its existing Barman bucket.
- Flux follows the GitHub mirror while Forgejo is offline.

| Node | Address | SN700 serial | Crucial serial |
| --- | --- | --- | --- |
| talos01 | 192.168.1.11 | 25284Z800387 | 25044DB42AA3 |
| talos02 | 192.168.1.12 | 241759801274 | 25044DB4D162 |
| talos03 | 192.168.1.13 | 241759800670 | 25034DB48A0A |

## Claim dispositions

| Claim(s) | Recovery |
| --- | --- |
| bookorbit, shelfmark, forgejo, jellyfin, radarr, sabnzbd, seerr, sonarr, gotosocial, continuwuity | `restore.yaml` from the recorded snapshot |
| sso `kanidm-data-sso-default-0` | `restore.yaml`, proven before the wipe and diffed before Kaniop starts |
| immich, karakeep (RWX) | `restore.yaml` into an RWO `*-seed`, `rwx-clone.yaml` clones it into the RWX claim |
| database `postgres-{1,2}` | CNPG `bootstrap.recovery` from Barman |
| `*-cache`, konflate, languagetool, grafana, victoria-logs/metrics, alertmanager | No backup; recreated empty |

The Git gates that hold workloads back in the new cluster:

- `cluster-apps` (`k8s/flux/cluster/ks.yaml`) and `sso/kaniop-instance`
  (`k8s/base/sso/kaniop/ks.yaml`) carry `suspend: true`. Removing them is the
  last step. `flux resume` does not stick, because the parent Kustomization
  re-applies `suspend: true` from Git.
- `k8s/base/flux-system/flux-instance/app/helm/values.yaml` syncs from GitHub.

```fish
set -gx M $PWD/migrations/rook-ceph-to-miroir
set -gx T $PWD/.tmp/ceph-to-miroir
mkdir -p $T
kubectl get pvc -A -o custom-columns=NS:.metadata.namespace,NAME:.metadata.name,SC:.spec.storageClassName,SIZE:.spec.resources.requests.storage
```

Refresh the inventory and update the dispositions if anything is missing.

## 0. Prepare (cluster untouched)

1. `mise run config-gen`, then check each `k8s/talos/clusterconfig/talosXX.yaml`:
   hostname/IP, control-plane role, installer image with the new schematic ID,
   install selector `CT1000P3PSSD8`, no `zfs-pool` volume.
2. Download the matching Image Factory ISO (Talos v1.14.5, same schematic) onto
   a USB stick; make sure the console of every node is reachable.
3. Confirm every policy has a recent `Succeeded` backup:
   `kubectl get snapshots.kopiur.home-operations.com -A`.
4. Make sure you can push to `github.com/sironheart/home-cluster` directly;
   phase 6 does that while Forgejo is down.

## 1. Freeze Flux and publish this branch (Forgejo still up)

The old cluster must never apply this branch: it removes Rook, and the prune
would delete the Ceph claims. Suspend every Kustomization first:

```fish
kubectl get ks -A -o jsonpath='{range .items[*]}{.metadata.namespace} {.metadata.name}{"\n"}{end}' \
    | while read ns name
        flux suspend ks -n $ns $name
    end
kubectl get ks -A -o json | jq -r '.items[] | select(.spec.suspend != true) | .metadata.name'   # must be empty
```

Merge this branch into `main` and push it to Forgejo. Wait until the GitHub
mirror shows the same commit
(`git ls-remote https://github.com/sironheart/home-cluster refs/heads/main`).
Forgejo's final snapshot then contains this commit too.

## 2. Stop writers, take final backups, prove the Kanidm restore

Scale operators that would recreate workloads first (Kaniop in `sso`,
grafana-operator and victoria-metrics-operator in `observability`), then every
workload in the app namespaces (all database clients included).

Before scaling Kanidm down, record the owners of its data files from the live
pod (`kubectl -n sso exec sso-default-0 -c kanidm -- ls -lan /data`) and save
them to `$T/kanidm-live-owners.txt`.

```fish
for ns in (ls k8s/apps) sso observability
    kubectl -n $ns scale deploy,sts --all --replicas=0
end
# Only database pods may still mount a PVC.
kubectl get pods -A -o json \
    | jq -r '.items[] | select(any(.spec.volumes[]?; .persistentVolumeClaim)) | "\(.metadata.namespace)/\(.metadata.name)"'
```

Final Kopiur snapshots, pinned and retained:

```fish
kubectl get snapshotpolicies.kopiur.home-operations.com -A \
    -o jsonpath='{range .items[*]}{.metadata.namespace} {.metadata.name}{"\n"}{end}' \
    | while read -gx NS POLICY
        flux envsubst --strict < $M/final-snapshot.yaml | kubectl apply -f -
    end
kubectl get snapshots.kopiur.home-operations.com -A | grep migration-final
```

Require `Succeeded` for every one. Then record what the new cluster restores:
namespace, policy, source PVC, kopia snapshot ID, size and access mode.

```fish
kubectl get pvc -A -o json > $T/pvcs.json
kubectl get snapshots.kopiur.home-operations.com -A -o json \
  | jq -r --slurpfile p $T/pvcs.json '
      ($p[0].items | map({key: "\(.metadata.namespace)/\(.metadata.name)", value: .spec}) | from_entries) as $pvc
      | .items[]
      | select(.metadata.name | endswith("-migration-final"))
      | (.status.snapshot.identity.sourcePath | ltrimstr("/pvc/")) as $src
      | $pvc["\(.metadata.namespace)/\($src)"] as $c
      | [.metadata.namespace, .spec.policyRef.name, $src, .status.snapshot.kopiaSnapshotID,
         $c.resources.requests.storage, $c.accessModes[0]]
      | @tsv' \
  > $T/snapshots.tsv
column -t $T/snapshots.tsv
wc -l < $T/snapshots.tsv   # must equal the number of SnapshotPolicies
```

No column may be empty. Copy `snapshots.tsv` somewhere off this laptop
(e.g. a 1Password note): it is the only record of which snapshot is final.

Prove the Kanidm restore on the old cluster: restore the recorded snapshot
into a scratch Ceph volume and fingerprint it.

```fish
awk -F'\t' '$1 == "sso"' $T/snapshots.tsv \
    | read -gx --delimiter \t NS POLICY SOURCE SNAPSHOT_ID CAPACITY ACCESS
set -gx PVC kanidm-verify
STORAGECLASS=ceph-block flux envsubst --strict < $M/restore.yaml | kubectl apply -f -
kubectl -n sso wait restores.kopiur.home-operations.com/kanidm-verify-migration --for=jsonpath='{.status.phase}'=Completed --timeout=30m
flux envsubst --strict < $M/verify-pod.yaml | kubectl apply -f -
kubectl -n sso wait pod/kanidm-verify-verify --for=jsonpath='{.status.phase}'=Succeeded --timeout=10m
kubectl -n sso logs kanidm-verify-verify > $T/kanidm-before.txt
cat $T/kanidm-before.txt
```

`kanidm-before.txt` must list `kanidm.db` with a plausible size. Compare its
owner column (`uid:gid`) with `$T/kanidm-live-owners.txt`: if they differ,
Kanidm would start on files it cannot write. Stop and fix the restore's
ownership before going further. Then clean up:

```fish
kubectl -n sso delete pod kanidm-verify-verify
kubectl -n sso delete restores.kopiur.home-operations.com kanidm-verify-migration
kubectl -n sso delete pvc kanidm-verify
```

Then PostgreSQL:

```fish
kubectl apply -f $M/postgres-backup.yaml
kubectl -n database wait backup/postgres-migration-final --for=jsonpath='{.status.phase}'=completed --timeout=1h
```

## 3. Wipe all nodes — irreversible from here

Everything on the cluster is destroyed. Only the NAS (Kopiur), Hetzner S3
(Barman), Git and 1Password survive.

Record each node's SN700 path while the old cluster still answers:

```fish
printf '%s\n' \
    'talos01 192.168.1.11 25284Z800387' \
    'talos02 192.168.1.12 241759801274' \
    'talos03 192.168.1.13 241759800670' \
    > $T/nodes.txt
cat $T/nodes.txt | while read NODE IP SERIAL
    set disk (talosctl -e $IP -n $IP get disks -o yaml | yq "select(.spec.serial == \"$SERIAL\") | .spec.dev_path")
    echo $NODE $IP $disk
end | tee $T/disks.txt
```

Every line needs a `/dev/nvme…` path. Then reset talos03, talos02 and talos01
last. Each node wipes its system disk and SN700 and shuts down. Etcd quorum is
gone after the second reset, which is expected.

```fish
# DESTRUCTIVE: whole system disk plus the SN700, on every node.
sort -r $T/disks.txt | while read NODE IP DATA_DISK
    talosctl -e $IP -n $IP reset --graceful=false --reboot=false \
        --wipe-mode=all --user-disks-to-wipe=$DATA_DISK --wait=false
end
```

## 4. Install and bootstrap the new cluster

Boot each node from the ISO and apply its config in maintenance mode:

```fish
set NODE talos01
set MAINT_IP ...                                    # shown on the node console
talosctl -n $MAINT_IP get disks --insecure
talosctl -n $MAINT_IP apply-config --insecure --file k8s/talos/clusterconfig/$NODE.yaml
```

Once all three are installed and rebooted, remove the ISO so they boot from
the Crucial disk, then bootstrap etcd **exactly once, on one node**:

```fish
talosctl -e 192.168.1.11 -n 192.168.1.11 bootstrap
talosctl -e 192.168.1.11 -n 192.168.1.11 etcd members   # 3 voters, may take a few minutes
mise run prepare-cluster
op inject -i bootstrap/other-resources.yaml | kubectl apply --server-side -f -
mise exec -- helmfile sync -f bootstrap/helmfile.d/02-finish-installation.yaml
kubectl wait nodes --all --for=condition=Ready --timeout=15m
```

Flux now reconciles `cluster-base` from GitHub. `cluster-apps` and
`sso/kaniop-instance` stay suspended.

Create the ZFS pools once the nodes are Ready. `bootstrap-zfs.sh` asks for
confirmation, so its stdin comes from the terminal, not from `nodes.txt`:

```fish
cat $T/nodes.txt | while read NODE IP SERIAL
    talosctl -n $IP get extensions                    # drbd and zfs
    talosctl -n $IP read /sys/module/drbd/version     # >= 9.3.1
    mise exec -- scripts/bootstrap-zfs.sh $NODE /dev/disk/by-id/nvme-WD_Red_SN700_1000GB_$SERIAL < /dev/tty
end
kubectl get miroirnodes -o yaml                       # drbdVersion set, pool "default" with capacity
```

If a pool still reports an error after the zpool exists, delete that node's
`miroir-agent` pod so it re-runs setup.

```fish
flux get ks -n miroir-system miroir-storage           # Ready once all three pools exist
flux get ks -A                                        # all Ready except the two suspended ones
kubectl get clusterrepositories.kopiur.home-operations.com nas
kubectl -n database wait cluster/postgres --for=condition=Ready --timeout=1h
```

Smoke-test one RWO and one RWX PVC (write, reschedule to another node, read)
before restoring anything.

## 5. Restore volumes

Recreate the app namespaces (Flux adopts them later) and restore every
recorded snapshot. RWX claims are restored into an RWO `*-seed` first:
`fsGroup` does not apply to miroir RWX (NFS) volumes, so the non-root mover
cannot write a fresh RWX root.

```fish
cat $T/snapshots.tsv | while read -gx --delimiter \t NS POLICY SOURCE SNAPSHOT_ID CAPACITY ACCESS
    set -gx PVC $SOURCE
    test $ACCESS = ReadWriteMany; and set -gx PVC $SOURCE-seed
    kubectl create namespace $NS --dry-run=client -o yaml | kubectl apply --server-side -f -
    flux envsubst --strict < $M/restore.yaml | kubectl apply -f -
end
kubectl wait restores.kopiur.home-operations.com -A --all --for=jsonpath='{.status.phase}'=Completed --timeout=6h
```

Every restore must have used the recorded snapshot (no output means it did):

```fish
kubectl get restores.kopiur.home-operations.com -A -o json \
    | jq -r '.items[] | [.metadata.namespace, .status.resolved.kopiaSnapshotID] | @tsv' | sort \
    | diff (cut -f1,4 $T/snapshots.tsv | sort | psub) -
```

Clone the seeds into the RWX claims. Each clone binds when the app pod first
mounts it:

```fish
awk -F'\t' '$6 == "ReadWriteMany"' $T/snapshots.tsv \
    | while read -gx --delimiter \t NS POLICY SOURCE SNAPSHOT_ID CAPACITY ACCESS
        set -gx APP $SOURCE
        flux envsubst --strict < $M/rwx-clone.yaml | kubectl apply -f -
    end
```

Kanidm: the restored volume must match the pre-wipe proof exactly.

```fish
set -gx NS sso
set -gx PVC kanidm-data-sso-default-0
flux envsubst --strict < $M/verify-pod.yaml | kubectl apply -f -
kubectl -n sso wait pod/$PVC-verify --for=jsonpath='{.status.phase}'=Succeeded --timeout=10m
kubectl -n sso logs $PVC-verify > $T/kanidm-after.txt
diff $T/kanidm-before.txt $T/kanidm-after.txt; and echo "kanidm OK"
kubectl -n sso delete pod $PVC-verify
kubectl -n sso get pvc $PVC -o jsonpath='{.metadata.uid}' > $T/kanidm-pvc-uid.txt
```

Do not continue without `kanidm OK`.

## 6. Resume

Remove both `suspend: true` gates (`k8s/flux/cluster/ks.yaml`,
`k8s/base/sso/kaniop/ks.yaml`), commit, and push **to GitHub directly**,
because Forgejo is still down. Then:

```fish
flux reconcile source git flux-system -n flux-system
flux get ks -A
```

Kaniop's StatefulSet adopts `kanidm-data-sso-default-0`. Every other app
finds its claim already present: Flux leaves it alone (`ssa: IfNotPresent`),
and the component's `*-restore` populator stays unused.

Check Kanidm before anything else:

```fish
kubectl -n sso wait pod/sso-default-0 --for=condition=Ready --timeout=15m
diff (kubectl -n sso get pvc kanidm-data-sso-default-0 -o jsonpath='{.metadata.uid}' | psub) $T/kanidm-pvc-uid.txt; and echo "same claim"
```

Then log in at `https://sso.siron.casa` with an existing account and its
existing credential. If that fails, scale Kaniop and Kanidm to zero
immediately. Writes against a wrongly initialised database are what would
force a reset for everyone.

As soon as Forgejo is up, push `main` to Forgejo. Its restored repository
lacks the phase-6 commit, and until it has it, a push-mirror run would rewind
GitHub and re-suspend the gates. Nothing is pruned in that case, but
everything stops reconciling.

## 7. Clean up

- Switch Flux back to Forgejo in `k8s/base/flux-system/flux-instance/app/helm/values.yaml`.
- Delete the `*-seed` PVCs and their retained PVs once immich/karakeep are verified.
- Delete the `*-migration` Restores.
- Keep `snapshots.tsv` until the recovery window is over. The
  `*-migration-final` `pin` was a field on the old cluster's Snapshot CRs, and
  those CRs no longer exist. In the new cluster, catalog discovery decides
  whether GFS retention eventually prunes those snapshots.

## Rollback

- **Before phase 3:** nothing is lost. Revert `main`, resume the suspended
  Kustomizations and scale the workloads back up.
- **From phase 3 on:** there is no undo. Keep apps suspended, fix the new
  cluster and retry the restores from `snapshots.tsv` and the Barman backup.
