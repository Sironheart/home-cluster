import homeCluster from "./configuration/home-cluster";
import { setupTalosSetup } from "./talos";

export function setupCluster() {
  const clusterConfig = homeCluster();

  setupTalosSetup(clusterConfig);
}
