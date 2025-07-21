import { TalosCluster } from "./componentResource/TalosCluster";
import { ClusterConfig, NodeConfiguration } from "../configuration/types";

export function setupCluster(clusterConfig: ClusterConfig) {
  const talosNodes: NodeConfiguration[] = clusterConfig.nodes
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
    nodes: talosNodes,
    secretStoreVaultUuid: clusterConfig.secretStoreVault,
  });
}
