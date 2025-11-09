<div align="center">
## Home Cluster

_... managed using Flux and Renovate
</div>

---

This is my homelab setup repository. It's a mono repository to provide a simple setup to recreate a cluster in a simple fashion!

I try to follow Infrastructure as Code (IaC) and GitOps guidelines, using tools such as:

- [Kubernetes](https://kubernetes.io/)
- [Flux](https://fluxcd.io/)
- [Github Actions](https://github.com/features/actions)

### General setup

My setup relies on my Home network. That being managed by a Unifi Dreamrouter, along several Unifi switches.

The basics of this cluster rely on:

- [Talos](https://talos.dev/)
- [Cilium](https://cilium.io/)
- [Spegel](https://spegel.dev/)
- [Cert-Manager](https://cert-manager.io/)
- [Rook](https://rook.io/)
- [External DNS](https://kubernetes-sigs.github.io/external-dns)
- [External Secrets](https://external-secrets.io/latest/)
- [1password Connect](https://developer.1password.com/docs/connect/)
- [Grafana Operator](https://grafana.com/docs/grafana-cloud/developer-resources/infrastructure-as-code/grafana-operator/)
- [VictoriaMetrics](https://victoriametrics.com/)
- [Volsync](https://github.com/backube/volsync) with [Kopia](https://kopia.io/)
- [Tailscale](https://tailscale.com/)
- [Envoy Gateway](https://gateway.envoyproxy.io/)
- [Cloudflared](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/)
