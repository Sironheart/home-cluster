import * as onepassword from "@1password/pulumi-onepassword";
import { ClusterConfig } from "./types";

export default function homeCluster(): ClusterConfig {
  return {
    secretStoreVault: onepassword.getVaultOutput({ name: "Home Cluster" }).uuid,
    k8sCluster: {
      clusterName: "home",
      endpoint: "https://talos.home:6443",
      talosVersion: "1.10.5",
      cni: "cilium",
    },
    nodes: [
      {
        hostname: "talos01",
        ip: "192.168.0.11",
        talos: {
          controlPlane: true,
        },
      },
      {
        hostname: "talos02",
        ip: "192.168.0.12",
        talos: {
          controlPlane: true,
        },
      },
      {
        hostname: "talos03",
        ip: "192.168.0.13",
        talos: {
          controlPlane: true,
        },
      },
    ],
  };
}
