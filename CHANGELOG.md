# Changelog

## 0.4.0

- Changed the default inference base URL to `https://api.trustedrouter.com/v1`.
- Added `DEFAULT_CONTROL_BASE_URL` and the `controlBaseUrl` client option for metadata, OAuth, billing, credits, activity, and broadcast routes.
- Routed inference methods and control methods to their respective planes while keeping regional failover inference-only.
- Regional failover now re-requests `api.trustedrouter.com` (global LB); per-region hostnames and region pinning options were removed.
