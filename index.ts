import * as pulumi from "@pulumi/pulumi";
import { setupCluster } from "./src";

async function main() {
  setupCluster();
}

main();
