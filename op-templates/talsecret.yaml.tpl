# vim: set filetype=yaml
---
cluster:
  id: op://Home Cluster/talos-secrets/cluster/id
  secret: op://Home Cluster/talos-secrets/cluster/secret
secrets:
  bootstraptoken: op://Home Cluster/talos-secrets/secrets/bootstraptoken
  secretboxencryptionsecret: op://Home Cluster/talos-secrets/secrets/secretboxencryptionsecret
trustdinfo:
  token: op://Home Cluster/talos-secrets/trustdinfo/token
certs:
  etcd:
    crt: op://Home Cluster/talos-secrets/certs-etcd/crt
    key: op://Home Cluster/talos-secrets/certs-etcd/key
  k8s:
    crt: op://Home Cluster/talos-secrets/certs-k8s/crt
    key: op://Home Cluster/talos-secrets/certs-k8s/key
  k8saggregator:
    crt: op://Home Cluster/talos-secrets/certs-k8saggregator/crt
    key: op://Home Cluster/talos-secrets/certs-k8saggregator/key
  k8sserviceaccount:
    key: op://Home Cluster/talos-secrets/certs-k8sserviceaccount/key
  os:
    crt: op://Home Cluster/talos-secrets/certs-os/crt
    key: op://Home Cluster/talos-secrets/certs-os/key
