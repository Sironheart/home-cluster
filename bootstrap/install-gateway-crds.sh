#!/usr/bin/env bash

set -Eeuo pipefail

function apply_crds() {
	local -r crds=(
		# renovate: datasource=github-releases depName=prometheus-operator/prometheus-operator
		https://github.com/prometheus-operator/prometheus-operator/releases/download/v0.86.1/stripped-down-crds.yaml
		# renovate: datasource=github-releases depName=kubernetes-sigs/gateway-api
		https://github.com/kubernetes-sigs/gateway-api/releases/download/v1.4.0/experimental-install.yaml
	    )

	    for crd in "${crds[@]}"; do
	if kubectl diff --filename "${crd}" &>/dev/null; then
		    echo "INFO: CRDs are up-to-date crd=${crd}"
		    continue
		fi
		if kubectl apply --server-side --filename "${crd}" &>/dev/null; then
		    echo "INFO: CRDs applied crd=${crd}"
		else
		    echo "ERROR: Failed to apply CRDs crd=${crd}"
		fi
	done
}

function main() {
	apply_crds
}

main "$@"
