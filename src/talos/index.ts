import { ClusterConfig } from "..";
import { setupCluster } from "./cluster";
import * as onepassword from "@1password/pulumi-onepassword";
import * as pulumi from "@pulumi/pulumi";

export function setupTalosSetup(clusterConfig: ClusterConfig) {
  const talosConfig = setupCluster(clusterConfig);

  pulumi.output(talosConfig);

  new onepassword.Item("talosConfig", {
    vault: clusterConfig.secretStoreVault,
    title: "Talosconfig",
    category: "secure_note",
    noteValue: talosConfig,
    tags: ["talos"],
    sections: [],
  });
}
