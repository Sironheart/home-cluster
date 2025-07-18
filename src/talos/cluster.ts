import * as pulumi from "@pulumi/pulumi";
import * as talos from "@pulumiverse/talos";
import * as yaml from "yaml";
import * as local from "@pulumi/local";
import path = require("node:path");
import { ClusterConfig } from "..";

export function setupCluster(clusterConfig: ClusterConfig) {
  const secrets = new talos.machine.Secrets(
    "home-secrets",
    {
      talosVersion: "v1.3",
    },
    { protect: true },
  );

  const configuration = talos.machine.getConfigurationOutput({
    clusterName: "home",
    machineType: "controlplane",
    clusterEndpoint: "https://talos.home:6443",
    machineSecrets: secrets.machineSecrets,
    talosVersion: "v1.10.5",
    configPatches: [
      JSON.stringify({
        cluster: {
          allowSchedulingOnControlPlanes: true,
        },
        machine: {
          install: {
            disk: "/dev/nvme0n1",
            image: getImageUrl(),
            wipe: true,
          },
          kubelet: {
            extraConfig: {
              serverTLSBootstrap: true,
            },
          },
        },
        // cluster: {
        //   allowSchedulungOnControlPlanes: true,
        // },
      }),
    ],
  });

  const talos01 = new talos.machine.ConfigurationApply("talos-01", {
    clientConfiguration: secrets.clientConfiguration,
    machineConfigurationInput: configuration.machineConfiguration,
    configPatches: [
      JSON.stringify({
        machine: {
          network: {
            hostname: "talos01",
          },
        },
      }),
    ],
    node: "192.168.0.11",
  });

  const talos02 = new talos.machine.ConfigurationApply("talos-02", {
    clientConfiguration: secrets.clientConfiguration,
    machineConfigurationInput: configuration.machineConfiguration,
    configPatches: [
      JSON.stringify({
        machine: {
          network: {
            hostname: "talos02",
          },
        },
      }),
    ],
    node: "192.168.0.12",
  });

  const talos03 = new talos.machine.ConfigurationApply("talos-03", {
    clientConfiguration: secrets.clientConfiguration,
    machineConfigurationInput: configuration.machineConfiguration,
    configPatches: [
      JSON.stringify({
        machine: {
          network: {
            hostname: "talos03",
          },
        },
      }),
    ],
    node: "192.168.0.13",
  });

  new talos.machine.Bootstrap(
    "talos-01",
    {
      node: talos01.node,
      clientConfiguration: secrets.clientConfiguration,
      endpoint: configuration.clusterEndpoint,
    },
    {
      dependsOn: [talos01],
      protect: true,
    },
  );

  new talos.machine.Bootstrap(
    "talos-02",
    {
      node: talos02.node,
      clientConfiguration: secrets.clientConfiguration,
      endpoint: configuration.clusterEndpoint,
    },
    {
      dependsOn: [talos02],
      protect: true,
    },
  );

  new talos.machine.Bootstrap(
    "talos-03",
    {
      node: talos03.node,
      clientConfiguration: secrets.clientConfiguration,
      endpoint: configuration.clusterEndpoint,
    },
    {
      dependsOn: [talos03],
      protect: true,
    },
  );

  const clientConfiguration = talos.client.getConfigurationOutput({
    clusterName: configuration.clusterName,
    clientConfiguration: secrets.clientConfiguration,
    nodes: [talos01.endpoint, talos02.endpoint, talos03.endpoint],
    endpoints: [configuration.clusterEndpoint],
  });

  // const kubeconfig = talos.cluster.getKubeconfigOutput({
  //   clientConfiguration: clientConfiguration.clientConfiguration,
  //   node: talos01.node,
  //   endpoint: configuration.clusterEndpoint,
  // });

  // const kubeconfig = new talos.cluster.Kubeconfig("kubeconfig", {
  //   clientConfiguration: clientConfiguration.clientConfiguration,
  //   node: talos01.node,
  //   endpoint: configuration.clusterEndpoint,
  // });
  // console.log(kubeconfig.kubeconfigRaw);

  // return kubeconfig;

  return clientConfiguration.talosConfig;
}

function getImageUrl() {
  const schematic = new talos.imagefactory.Schematic("schema", {
    schematic: yaml.stringify(
      {
        customization: {
          // systemExtensions: {
          //   officialExtensions: ["siderolabs/tailscale"],
          // },
        },
      },
      {},
    ),
  });

  const imageUrls = talos.imagefactory.getUrlsOutput({
    schematicId: schematic.id,
    talosVersion: "v1.10.5",
    platform: "metal",
  });

  return imageUrls.urls.installer;
}
