# Privilege logs in Elasticsearch and Kibana

This runbook explains how to send Privilege SIEM events to Elasticsearch and view them in Kibana.

## What each component does

```text
Privilege -> Elasticsearch -> Kibana
```

- **Privilege** produces SIEM and audit events.
- **Elasticsearch** stores and searches those events.
- **Kibana** is the browser interface for searching events and building dashboards.

Elasticsearch is the data store. Kibana is optional for ingestion, but is the easiest way to explore events and create visualizations.

## Configure Privilege

In Privilege's SIEM configuration, select **Elastic** and provide:

| Field | Value |
| --- | --- |
| URL | An HTTP Elasticsearch URL reachable from the Privilege gateway or agent |
| Index | `ping-siem-events` |
| Username | The dedicated Elasticsearch ingestion user |
| Password | The ingestion user's password |

Use the URL exactly as a URL, including the scheme. For example:

```text
http://<elasticsearch-host>:9200
```

Do not enter only `<host>:9200`; the Elastic client expects `http://` or `https://`.

The endpoint must be reachable from the component that sends events. A URL that works from a laptop may not work from a Kubernetes pod, Docker container, or mesh network. Prefer the cluster-internal service name when the sender runs in the same Kubernetes cluster; use a load balancer or other reachable endpoint only when the sender is outside the cluster.

## Verify Elasticsearch directly

Use the dedicated ingestion credentials without putting the password in a committed file:

```bash
read -s ES_PASS
export ES_PASS

ES_URL='http://<elasticsearch-host>:9200'
ES_USER='<ingestion-user>'

# Confirm the cluster is reachable.
curl -fsS -u "$ES_USER:$ES_PASS" "$ES_URL/"

# Count Privilege events.
curl -fsS -u "$ES_USER:$ES_PASS" \
  "$ES_URL/ping-siem-events/_count?pretty"

# Show the newest events.
curl -fsS -u "$ES_USER:$ES_PASS" \
  "$ES_URL/ping-siem-events/_search?pretty&size=10&sort=@timestamp:desc"
```

A successful cluster response includes `X-elastic-product: Elasticsearch`. A successful event write returns HTTP `201` and identifies the `ping-siem-events` index.

## Open Kibana locally

Forward the Kibana service in a separate terminal and leave the command running:

```bash
kubectl -n <namespace> port-forward service/kibana-siem 5601:5601
```

If PingOne-protected local access is configured, open:

```text
http://localhost:4180
```

Otherwise open the forwarded Kibana endpoint directly:

```text
http://localhost:5601
```

## Create a data view and view events

1. Open **Analytics → Discover**.
2. Open the **Data view** selector.
3. Create a data view with this index pattern:

   ```text
   ping-siem-events*
   ```

4. Select `@timestamp` as the time field.
5. Select that data view in Discover.
6. Set the time range to **Last 7 days** (or a range that includes the event timestamps).
7. Expand an event to inspect fields such as `Message`, `Status`, `Module`, `Region`, `User`, `Device`, and `@timestamp`.

Entering `ping-siem-events*` in the query bar does not select an index. It searches the currently selected data view, so the index pattern must be created or selected first.

## Build a dashboard

After events appear in Discover, use **Dashboard → Create dashboard** and add visualizations from the same data view. Useful initial panels include:

- Event count over time, using `@timestamp`.
- Events by `Module`.
- Events by `Region`.
- HTTP outcomes from `Status`.
- Activity by `User.Tenant`.
- A recent-events table showing `@timestamp`, `Message`, `Module`, `Status`, and `Region`.

The shared account used for this local setup is intentionally read-only. If **Create data view** or dashboard editing is unavailable, an administrator must create the data view and dashboards, or the account must be granted Kibana editor privileges.

## Troubleshooting

### `first path segment in URL cannot contain colon`

The URL is missing its scheme. Use `http://<host>:9200`, not `<host>:9200`.

### `no Elasticsearch node available` or `context deadline exceeded`

Test the same URL from the Privilege sender's network location. Check DNS, security-group rules, Kubernetes service discovery, load-balancer reachability, and whether Elasticsearch is listening on port 9200.

### Kibana shows no fields

Confirm that the selected data view is `ping-siem-events*`, not a generic view such as **All logs**. Clear the query bar, choose an appropriate time range, and refresh the results.

### Kibana shows an authorization error for `indices:monitor/stats`

The Kibana account needs read-only index monitoring permission for the SIEM and Kibana indices. The account also needs Kibana application permission to create data views or dashboards; a viewer-only account can inspect existing objects but cannot manage them.

## Security notes

- Use a dedicated least-privilege ingestion user, not the `elastic` administrator.
- Store credentials in Kubernetes Secrets, Docker secrets, or another secret manager.
- Do not commit credentials or place them in shell history.
- Avoid indexing SIEM configuration objects containing passwords or tokens. If a credential was indexed, rotate it and remove or restrict the affected documents.
- Prefer HTTPS and private network access for anything beyond local testing.

## Related documentation

- [Privilege demo setup](use-cases/privilege-demo-setup.md) — technical setup and environment prerequisites.
- [SE1 Privilege shared-demo guide](../privilege/SE1-Privilege-Shared-Demo.md) — presenter workflow, onboarding, and live demo steps.
- [Kibana PingOne SSO guide](kibana-pingone-sso.md) — local Kibana access through PingOne.
