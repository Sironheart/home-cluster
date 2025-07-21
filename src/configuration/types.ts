import * as pulumi from "@pulumi/pulumi";

export interface ClusterConfig {
  secretStoreVault: pulumi.Input<string>;
  nodes: NodeConfiguration[];
  k8sCluster: K8sClusterConfig;
}

export interface NodeConfiguration {
  hostname: string;
  ip: IpAddress;
  talos?: TalosConfig;
}

export type IpAddress =
  | `${number}.${number}.${number}.${number}`
  | `${string}:${string}`;

export interface TalosConfig {
  controlPlane?: true;
}

export interface K8sClusterConfig {
  clusterName: string;
  endpoint: `https://${string}:${number}`;
  talosVersion: `${number}.${number}.${number}`;
  cni?: "cilium" | "istio";
}
