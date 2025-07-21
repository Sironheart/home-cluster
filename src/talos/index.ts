import { ClusterConfig } from "../configuration/types";
import { setupCluster } from "./cluster";

export function setupTalosSetup(clusterConfig: ClusterConfig) {
  setupCluster(clusterConfig);
}
