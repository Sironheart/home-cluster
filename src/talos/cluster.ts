import { NodeConfiguration, TalosCluster } from "./TalosCluster";
import { ClusterConfig } from "../configuration/types";

export function setupCluster(clusterConfig: ClusterConfig) {
  const nodes: NodeConfiguration[] = clusterConfig.nodes
    .filter((n) => !!n.talos)
    .map((n) => {
      return {
        hostname: n.hostname,
        ip: n.ip,
        controlPlane: n.talos?.controlPlane,
      };
    });

  new TalosCluster("home", {
    clusterName: clusterConfig.k8sCluster.clusterName,
    endpoint: clusterConfig.k8sCluster.endpoint,
    talosVersion: clusterConfig.k8sCluster.talosVersion,
    nodes: nodes,
    secretStoreVaultUuid: clusterConfig.secretStoreVault,
  });
}
