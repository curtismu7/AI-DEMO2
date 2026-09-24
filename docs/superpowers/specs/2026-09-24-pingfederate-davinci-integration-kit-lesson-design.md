# PingFederate DaVinci Integration Kit lesson

## Goal

Add an in-app lesson that explains how a PingFederate authentication policy
invokes the PingOne DaVinci Integration Kit and how the widget-based and
API-based flow modes differ.

## Audience and framing

The primary audience is a PingFederate administrator. The page is an
implementation walkthrough based on the official Integration Kit, distinct
from the app's existing client-side DaVinci Widget and DaVinci SDK lessons.

PingFederate and the Integration Kit are installed in the target environment,
with the kit configured as the default PF adapter. The lesson starts sign-in
through a dedicated PF end-user client and enables the demo only when its
callback has verified a PF ID token. This proof is separate from the app's
PingOne end-user session, so a PingOne session alone never passes the gate.
The source repository itself contains no PF installation files or credentials.

## Page structure

1. **What the kit does:** PingFederate calls the DaVinci IdP Adapter as part of
   an authentication policy; DaVinci runs the configured flow and returns
   attributes to PingFederate.
2. **Install the kit:** download and deploy the kit files to the PingFederate
   server, account for cluster engine nodes, and restart as directed by the
   official guide.
3. **Configure the adapter:** set the DaVinci company and policy IDs, choose
   widget or API flow mode, and map request and response attributes.
4. **Connect the authentication policy:** place the adapter in the policy,
   connect the policy to an SP connection, and explain which returned attributes
   are available to the SP.
5. **Compare the two modes:** widget mode presents the DaVinci UI in the
   PingFederate flow; API mode runs without UI and returns flow data for the
   PingFederate policy to consume.
6. **Troubleshoot and operate:** cover invalid policy/flow references, region
   URLs, widget CSP allow-listing, adapter logs, kit upgrades, and cluster-node
   consistency.

The page should use a small sequence diagram and a mode comparison table. It
should cross-link to the existing DaVinci Widget and DaVinci SDK lessons, while
remaining independently navigable as a PingFederate demo.

## Boundaries

- The demo does not install or redeploy the PF Integration Kit; it uses the
  already-installed adapter and PF authentication policy.
- No live PingFederate or DaVinci credentials are collected or displayed.
- The browser calls only the BFF's PF login and proof-status endpoints. The BFF
  uses PF OIDC discovery, authorization-code/PKCE, token exchange, and JWKS
  verification; no PF token reaches browser JavaScript.
- Do not imply that the widget-based adapter mode is the same as this app's
  standalone DaVinci widget demo; the former runs inside PingFederate's adapter
  template.

## Acceptance criteria

- A PingFederate administrator can distinguish the kit's widget mode from its
  API mode and identify when each fits.
- The lesson shows the real sequence from SP request through PingFederate policy,
  adapter, DaVinci flow, and response attributes.
- Setup steps and constraints match current Ping documentation.
- The page explains that sign-in runs the configured PF authentication policy
  and visibly blocks the run action for a PingOne session.
- Navigation and route authorization follow the repository's existing patterns.

## Source documentation

- [PingOne DaVinci Integration Kit for PingFederate](https://docs.pingidentity.com/integrations/pingone/pingone_davinci_integration_kit/pf_p1_davinci_ik.html)
- [Deploying the integration files](https://docs.pingidentity.com/integrations/pingone/pingone_davinci_integration_kit/pf_p1_davinci_ik_deploying_the_integration_files.html)
- [Overview of the SSO flow](https://docs.pingidentity.com/integrations/pingone/pingone_davinci_integration_kit/pf_p1_davinci_ik_overview_of_the_sso_flow.html)
- [Configuring an adapter instance](https://docs.pingidentity.com/integrations/pingone/pingone_davinci_integration_kit/pf_p1_davinci_ik_configuring_an_adapter_instance.html)
- [Adapter settings reference](https://docs.pingidentity.com/integrations/pingone/pingone_davinci_integration_kit/pf_p1_davinci_ik_p1_davinci_idp_adapter_settings_reference.html)
- [Integrating DaVinci flows into applications](https://docs.pingidentity.com/davinci/integrating_flows_into_applications/davinci_how_to_implement_a_flow.html)
