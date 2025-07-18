import * as onepassword from "@1password/pulumi-onepassword";
import * as pulumi from "@pulumi/pulumi";
import { setupTalosSetup } from "./talos";

export function setupCluster() {
  const clusterConfig: ClusterConfig = {
    secretStoreVault: onepassword.getVaultOutput({ name: "Home Cluster" }).uuid,
    nodes: [
      {
        hostname: "talos01",
        talos: {
          clusterName: "home",
          controlPlane: true,
        },
      },
      {
        hostname: "talos02",
        talos: {
          clusterName: "home",
          controlPlane: true,
        },
      },
      {
        hostname: "talos03",
        talos: {
          clusterName: "home",
          controlPlane: true,
        },
      },
    ],
  };

  setupTalosSetup(clusterConfig);
}

export interface ClusterConfig {
  secretStoreVault: pulumi.Input<string>;
  nodes: NodeConfiguration[];
}

export interface NodeConfiguration {
  hostname: string;
  talos?: TalosConfig;
}

export interface TalosConfig {
  clusterName: string;
  controlPlane: boolean;
}
