import * as pulumi from "@pulumi/pulumi";
import * as talos from "@pulumiverse/talos";
import * as onepassword from "@1password/pulumi-onepassword";
import * as yaml from "yaml";
import { Secrets } from "@pulumiverse/talos/machine/secrets";
import { ConfigurationApply } from "@pulumiverse/talos/machine";
import {
  NodeConfiguration,
  TalosClusterInputs,
  TalosClusterOutputs,
} from "./types";
import {
  ClusterRequiresControlPlanes,
  InvalidNodeAmountException,
} from "./errors";
import { Bootstrap } from "@pulumiverse/talos/machine/bootstrap";

const resourcePrefix = "talos-cluster";

export class TalosCluster
  extends pulumi.ComponentResource<TalosClusterOutputs>
  implements TalosClusterOutputs
{
  public readonly clusterName: string;
  public readonly endpoint: `https://${string}:${number}`;
  public readonly talosVersion: `${number}.${number}.${number}`;
  public readonly nodes: NodeConfiguration[];

  private readonly inputs: TalosClusterInputs;
  private readonly options?: pulumi.ComponentResourceOptions;

  private readonly controlPlanes: NodeConfiguration[];
  private readonly workers: NodeConfiguration[];

  private readonly imageUrl: pulumi.Input<string>;

  constructor(
    name: string,
    inputs: TalosClusterInputs,
    options?: pulumi.ComponentResourceOptions,
  ) {
    super(`${resourcePrefix}:${inputs.clusterName}`, name, inputs, {
      ...options,
    });

    this.clusterName = inputs.clusterName;
    this.endpoint = inputs.endpoint;
    this.talosVersion = inputs.talosVersion;
    this.nodes = inputs.nodes;

    this.inputs = inputs;
    this.options = options;

    if (this.inputs.nodes.length <= 0) {
      throw new InvalidNodeAmountException(
        "You can not create a cluster without nodes",
      );
    }

    this.controlPlanes = this.inputs.nodes.filter((n) => n.controlPlane);
    this.workers = this.inputs.nodes.filter((n) => !n.controlPlane);

    if (this.controlPlanes.length <= 0) {
      throw new ClusterRequiresControlPlanes(
        "A cluster needs at least one control plane!",
      );
    }

    this.imageUrl = this.getImageUrl();

    const secrets = new talos.machine.Secrets(
      `${resourcePrefix}:${inputs.clusterName}-secrets`,
      {
        talosVersion: inputs.talosVersion,
      },
      this.options,
    );

    const workplaneApplies = this.configureWorkplanes(secrets);
    const workersApplies = this.configureWorkers(secrets);

    const bootstrap = this.bootstrapNodes(secrets, [
      ...workplaneApplies,
      ...workersApplies,
    ]);

    this.storeTalosConfig(secrets, [bootstrap]);
    this.storeKubeConfig(secrets, [bootstrap]);
  }

  private configureWorkplanes(secrets: Secrets): ConfigurationApply[] {
    const config = talos.machine.getConfigurationOutput({
      clusterName: this.clusterName,
      machineType: "controlplane",
      clusterEndpoint: this.endpoint,
      machineSecrets: secrets.machineSecrets,
      talosVersion: this.talosVersion,
      configPatches: [
        JSON.stringify({
          ...this.sharedConfigurations(),
          machine: {
            kubelet: {
              disableManifestsDirectory: true,
              nodeIP: {
                validSubnets: ["192.168.0.0/24"],
              },
            },
          },
          cluster: {
            etcd: { advertisedSubnets: ["192.168.0.0/24"] },
            allowSchedulingOnControlPlanes: true,
          },
        }),
      ],
    });

    return this.controlPlanes.map(
      (node: NodeConfiguration) =>
        new talos.machine.ConfigurationApply(
          `${resourcePrefix}:config-apply:${node.hostname}`,
          {
            clientConfiguration: secrets.clientConfiguration,
            machineConfigurationInput: config.machineConfiguration,
            node: node.ip,
            configPatches: [
              JSON.stringify({
                machine: {
                  install: { disk: node.installDisk ?? "/dev/nvme0n1" },
                  network: { hostname: node.hostname },
                  certSANs: [new URL(`${this.endpoint}`).hostname, node.ip],
                },
                cluster: {
                  apiServer: {
                    certSANs: [new URL(this.endpoint).hostname, node.ip],
                  },
                },
              }),
            ],
            timeouts: { create: "1m", delete: "30s", update: "30s" },
            onDestroy: { reset: true, graceful: true, reboot: true },
          },
          this.options,
        ),
    );
  }

  private configureWorkers(secrets: Secrets): ConfigurationApply[] {
    const config = talos.machine.getConfigurationOutput({
      clusterName: this.clusterName,
      machineType: "worker",
      clusterEndpoint: this.endpoint,
      machineSecrets: secrets.machineSecrets,
      talosVersion: this.talosVersion,
      configPatches: [
        JSON.stringify({
          ...this.sharedConfigurations(),
        }),
      ],
    });

    return this.workers.map(
      (node) =>
        new talos.machine.ConfigurationApply(
          `${resourcePrefix}:config-apply:${node.hostname}`,
          {
            clientConfiguration: secrets.clientConfiguration,
            machineConfigurationInput: config.machineConfiguration,
            node: node.ip,
            configPatches: [
              JSON.stringify({
                machine: {
                  install: { disk: node.installDisk ?? "/dev/nvme0n1" },
                  network: { hostname: node.hostname },
                },
              }),
            ],
            onDestroy: { reset: true, graceful: true, reboot: true },
          },
          this.options,
        ),
    );
  }

  private bootstrapNodes(
    secrets: talos.machine.Secrets,
    dependsOn:
      | pulumi.Input<pulumi.Resource>
      | pulumi.Input<pulumi.Input<pulumi.Resource>[]>,
  ): talos.machine.Bootstrap {
    return new talos.machine.Bootstrap(
      `${resourcePrefix}:bootstrap`,
      {
        node: this.controlPlanes.at(0)!.ip,
        clientConfiguration: secrets.clientConfiguration,
        endpoint: this.endpoint,
        timeouts: { create: "5m" },
      },
      {
        dependsOn,
      },
    );
  }

  private storeKubeConfig(
    secrets: talos.machine.Secrets,
    dependsOn:
      | pulumi.Input<pulumi.Resource>
      | pulumi.Input<pulumi.Input<pulumi.Resource>[]>,
  ) {
    const kubeconfig = new talos.cluster.Kubeconfig(
      `${resourcePrefix}:kubeconfig`,
      {
        clientConfiguration: secrets.clientConfiguration,
        node: this.controlPlanes.at(0)!.ip,
        endpoint: this.endpoint,
      },
      { dependsOn },
    );

    new onepassword.Item(
      `${resourcePrefix}:kubeconfig`,
      {
        vault: this.inputs.secretStoreVaultUuid,
        title: "Kubeconfig",
        category: "secure_note",
        noteValue: kubeconfig.kubeconfigRaw,
        tags: ["talos"],
      },
      { dependsOn },
    );
  }

  private storeTalosConfig(
    secrets: talos.machine.Secrets,
    dependsOn:
      | pulumi.Input<pulumi.Resource>
      | pulumi.Input<pulumi.Input<pulumi.Resource>[]>,
  ) {
    const clientConfig = talos.client.getConfigurationOutput({
      clusterName: this.clusterName,
      clientConfiguration: secrets.clientConfiguration,
      nodes: [...this.inputs.nodes.flatMap((n) => n.ip)],
      endpoints: [this.endpoint],
    });

    new onepassword.Item(
      `${resourcePrefix}:talosConfig`,
      {
        vault: this.inputs.secretStoreVaultUuid,
        title: "Talosconfig",
        category: "secure_note",
        noteValue: clientConfig.talosConfig,
        tags: ["talos"],
        sections: [],
      },
      { dependsOn },
    );
  }

  private sharedConfigurations() {
    return {
      machine: {
        install: {
          image: this.imageUrl,
          wipe: true,
        },
        features: {
          kubePrism: {
            enabled: true,
            port: 7445,
          },
        },
      },
    };
  }

  private getImageUrl(): pulumi.Output<string> {
    const schematic = new talos.imagefactory.Schematic(
      `${resourcePrefix}:${this.inputs.clusterName}:schema`,
      {
        schematic: yaml.stringify(
          {
            customization: {
              systemExtensions: {
                officialExtensions: [
                  // "siderolabs/tailscale",
                  "siderolabs/iscsi-tools",
                ],
              },
            },
          },
          {},
        ),
      },
    );

    const imageUrls = talos.imagefactory.getUrlsOutput({
      schematicId: schematic.id,
      talosVersion: this.talosVersion,
      platform: "metal",
    });

    return imageUrls.urls.installer;
  }
}
