import * as pulumi from "@pulumi/pulumi";
import { IpAddress } from "../../configuration/types";

export interface TalosClusterOutputs {
  clusterName: string;
  endpoint: `https://${string}:${number}`;
  talosVersion: `${number}.${number}.${number}`;
  nodes: NodeConfiguration[];
}

export interface TalosClusterInputs {
  clusterName: string;
  endpoint: `https://${string}:${number}`;
  talosVersion: `${number}.${number}.${number}`;
  nodes: NodeConfiguration[];
  secretStoreVaultUuid: pulumi.Input<string>;
}

export interface NodeConfiguration {
  hostname: string;
  ip: IpAddress;
  controlPlane?: true;
  installDisk?: string;
}
