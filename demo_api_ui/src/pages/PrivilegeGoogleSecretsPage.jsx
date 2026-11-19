// /privilege-google-secrets — Secrets Hub with Google Secret Manager.
//
// What the hub ACTUALLY does (measured 2026-10-04, runbook partly verified live
// 2026-10-13/14): Privilege inventories an external secret store, grants named
// users time-boxed access through a policy, and reads a value from Google only
// when someone views it — with two independent audit trails. It is a console
// flow for people, not a gateway-brokered agent flow; the "does not" list is
// served as data and shown verbatim. Tenant state comes from the console-API
// export of 2026-11-17 (snapshot), served read-only by the BFF.

import { useEffect, useState } from 'react';
import PageHeader from '../components/common/PageHeader';
import {
  PingPage, SimBanner, PageFrame, Section, CardGrid, Card, StatusChip, KvList,
} from '../components/pingUi';
import './PrivilegeGoogleSecretsPage.css';

export default function PrivilegeGoogleSecretsPage() {
  const [hub, setHub] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    fetch('/api/privilege-google-secrets/hub', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : r.json().then((b) => { throw new Error(b.error || `HTTP ${r.status}`); })))
      .then((d) => { if (alive) setHub(d); })
      .catch((e) => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, []);

  return (
    <PingPage className="pgs-page">
      <SimBanner data-testid="pgs-banner">
        <strong>SNAPSHOT + RUNBOOK</strong> — the tenant state below is a console-API export of{' '}
        {hub?.snapshotDate ?? '2026-11-17'} (read-only; no live console call, no secret values, no
        service-account credentials on the page). The runbook steps are the measured flow from
        2026-10-04, partly verified live on 2026-10-13/14. This page demos the Secrets Hub as it
        actually works today: a console flow for people — not an agent-broker flow.
      </SimBanner>
      <PageHeader
        eyebrow="Ping products · Privilege · Secrets Hub · Google Secret Manager"
        title="Secrets Hub: your secret store, governed"
        summary="Privilege connects to a secret store you already run, lets an admin see what's in it, and turns “who may read this secret, for how long” into a time-boxed, audited grant through a policy."
      />
      <PageFrame>
        <Section
          id="pgs-state"
          kicker="1 · State on our tenant"
          title="A hub is already connected"
          lede="Read live from the console API on 2026-10-13; shown here from the 2026-11-17 snapshot."
        >
          {error && <p data-testid="pgs-error"><StatusChip tone="bad">{error}</StatusChip></p>}
          {hub && (
            <CardGrid>
              <Card title="The hub" data-testid="pgs-hub">
                <KvList
                  items={[
                    { label: 'Name', value: hub.hub.name },
                    { label: 'Provider', value: `${hub.hub.provider} — ${hub.hub.displayName}` },
                    { label: 'Project', value: hub.hub.projectId },
                    { label: 'Account type', value: hub.hub.accountType },
                    { label: 'Connected', value: hub.hub.createdAt },
                    { label: 'Last sync', value: hub.hub.lastSync },
                    { label: 'Roles granted', value: hub.hub.roles.join(', ') },
                  ]}
                />
              </Card>
              <Card title="Secrets visible in Privilege" data-testid="pgs-secrets">
                <KvList
                  items={hub.secrets.map((s) => ({ label: s.id, value: s.path }))}
                />
                <p className="pgs-note">
                  A sync reads names and versions, never values. One of these two names looks like
                  a real key — the runbook says don&apos;t click View on it live.
                </p>
              </Card>
              <Card title="The existing grant" data-testid="pgs-grant">
                <KvList
                  items={[
                    { label: 'Policy', value: hub.grant.name },
                    { label: 'Permission', value: hub.grant.permission },
                    { label: 'Covers', value: hub.grant.coversSecret },
                    { label: 'Granted to', value: `${hub.grant.grantedTo.length} users` },
                    { label: 'Time-boxed', value: hub.grant.timeBoxed ? 'Yes' : 'No — long-lived (made 2026-10-04)' },
                  ]}
                />
              </Card>
            </CardGrid>
          )}
        </Section>

        {hub && (
          <Section
            id="pgs-run"
            kicker="2 · The run"
            title="Four steps, and what to say at each"
            lede="Everything below is the measured flow — the “say” lines are the demo script."
          >
            <div className="pgs-run">
              {hub.run.map((r) => (
                <Card key={r.step} title={`${r.step} · ${r.title}`}>
                  <p className="pgs-say" data-testid={`pgs-say-${r.step}`}>“{r.say}”</p>
                  <p className="pgs-note">{r.detail}</p>
                </Card>
              ))}
            </div>
          </Section>
        )}

        {hub && (
          <Section
            id="pgs-audit"
            kicker="3 · The dual audit trail"
            title="Every view is recorded twice, by two independent systems"
            lede="A view reads the value from Google at that moment — nothing sits in Privilege waiting to be read."
          >
            <CardGrid>
              {hub.auditTrail.map((a) => (
                <Card key={a.side} title={`${a.side} side`}>
                  <KvList
                    items={[
                      { label: 'Event', value: a.event },
                      { label: 'Where', value: a.where },
                    ]}
                  />
                </Card>
              ))}
            </CardGrid>
          </Section>
        )}

        {hub && (
          <Section
            id="pgs-uncomfortable"
            kicker="4 · The uncomfortable line"
            title="The key ends up in the audit log — in clear text"
            lede="Saying this out loud in the demo is the credibility move, not a risk to hide."
          >
            <Card tone="warn">
              <p className="pgs-fact" data-testid="pgs-uncomfortable-fact">{hub.uncomfortable.fact}</p>
              <p className="pgs-note">{hub.uncomfortable.why}</p>
              <ul className="pgs-remediation">
                {hub.uncomfortable.remediation.map((r) => <li key={r}>{r}</li>)}
              </ul>
            </Card>
          </Section>
        )}

        {hub && (
          <Section
            id="pgs-not"
            kicker="5 · What not to claim"
            title="What the hub does not do"
            lede="Verified live — present these as boundaries, not gaps you forgot."
          >
            <ul className="pgs-doesnot" data-testid="pgs-doesnot">
              {hub.doesNot.map((d) => <li key={d}>{d}</li>)}
            </ul>
          </Section>
        )}
      </PageFrame>
    </PingPage>
  );
}
