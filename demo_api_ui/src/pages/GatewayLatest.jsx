// /gateway-claims parts 6 and 7: gateway v1.261029, v1.261030 and v1.261102 read from the binary (UNVERIFIED), and the 2026-11-02
// release features we have not measured on our tenant. Nothing here runs; it states what we know and what a test needs.
// Ping UI primitives (docs/ping-ui-primitives.md): sections, cards, chips with a word. The tables keep the page's stacked-table pattern.
import { Section, Card } from '../components/pingUi';
import { Caveat, EvidenceTag as Tag } from '../components/gatewayClaims/parts';
import {
  BASELINE_VERSION, CHECKED_ON, IMAGE_COMPARE, LATEST_FACTS, NOT_MEASURED, RECHECK_STEPS, RELEASE_DATE, RELEASE_TABLE, SINCE_ROWS, VERSION_LATEST, VERSION_MIDDLE, VERSION_THIRD,
} from '../config/gatewayLatest';

export default function GatewayLatest() {
  return (
    <>
      <div data-testid="gwc-since">
        <Section
          id="gwc-p6"
          kicker="Part 6 · Read from the binary and the registry"
          title={<>6. Since {BASELINE_VERSION}: {VERSION_MIDDLE}, {VERSION_THIRD} and {VERSION_LATEST} <Tag kind="unverified" /></>}
        >
          <Caveat>
            We found no Ping release notes for these tags (checked {CHECKED_ON}) and tried none of their features; the only runs are the {VERSION_LATEST} pod
            on gateway 2 of our SE mesh and a tools/list sent straight to it. Every change below is our reading of the gateway binary, UNVERIFIED. The three tags are small steps on {BASELINE_VERSION}.
          </Caveat>
          <Card tone="neutral" title="What we know">
            <ul className="gwc-list">{LATEST_FACTS.map((f) => <li key={f.text}><Tag kind={f.evidence} /> {f.text}</li>)}</ul>
          </Card>
          <Card tone="neutral" title="The four builds">
            <table className="gwc-table gwc-table--stack" aria-label="Gateway builds" data-testid="gwc-builds">
              <thead><tr><th>Tag</th><th>Built (UTC)</th><th>mcpgw binary (bytes)</th><th>Symbols against the tag before</th></tr></thead>
              <tbody>
                {RELEASE_TABLE.map((r) => (
                  <tr key={r.tag}><td data-label="Tag"><code>{r.tag}</code></td><td data-label="Built (UTC)">{r.built}</td><td data-label="mcpgw binary (bytes)">{r.binary}</td><td data-label="Symbols against the tag before">{r.symbols}</td></tr>
                ))}
              </tbody>
            </table>
            <p className="pu-note gwc-muted">Symbol counts include compiler temporaries. They show how big the step was, not how many features changed.</p>
          </Card>
          <Card tone="neutral" title={<>The two newest images, from the registry <Tag kind="verified" /></>}>
            <table className="gwc-table gwc-table--stack" aria-label={`${VERSION_THIRD} and ${VERSION_LATEST} images`} data-testid="gwc-image-compare">
              <thead><tr><th>Registry fact</th><th>{VERSION_THIRD}</th><th>{VERSION_LATEST}</th></tr></thead>
              <tbody>
                {IMAGE_COMPARE.map((r) => (
                  <tr key={r.id} data-testid={`gwc-image-${r.id}`}>
                    <td data-label="Registry fact">{r.item}</td>
                    <td data-label={VERSION_THIRD}>{r.id === 'digest' ? <code>{r.a}</code> : r.a}</td>
                    <td data-label={VERSION_LATEST}>{r.id === 'digest' ? <code>{r.b}</code> : r.b}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="pu-note gwc-muted">These are facts about the image files. They say nothing about what the gateway does.</p>
          </Card>
          <Card tone="neutral" title={<>What changed since {BASELINE_VERSION} <Tag kind="unverified" /></>}>
            <table className="gwc-table gwc-table--stack" aria-label={`Changes since ${BASELINE_VERSION}`} data-testid="gwc-since-diff">
              <thead><tr><th>Tag</th><th>Change</th><th>Symbols and messages</th><th>Our reading</th></tr></thead>
              <tbody>
                {SINCE_ROWS.map((r) => (
                  <tr key={r.id} data-testid={`gwc-since-${r.id}`}>
                    <td data-label="Tag"><code>{r.version}</code></td>
                    <td data-label="Change">{r.change}</td>
                    <td data-label="Symbols and messages"><code>{r.symbols}</code></td>
                    <td data-label="Our reading">{r.reading}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </Section>
      </div>

      <div data-testid="gwc-not-measured">
        <Section
          id="gwc-p7"
          kicker="Part 7 · Named to us, not yet tried"
          title={<>7. Not yet measured on our tenant: the {RELEASE_DATE} release <Tag kind="unverified" /></>}
        >
          <Caveat>
            Ping&apos;s public release notes do not describe the {RELEASE_DATE} Agent Privilege release (checked {CHECKED_ON}), and we have not confirmed that {VERSION_LATEST},
            the tag dated that day, is that release. Gateway 2 of our SE mesh ran {VERSION_LATEST} and gateway 1 still runs {VERSION_THIRD}; only that pod becoming ready and the same 6 tools from tools/list were observed. The five features below were named to us;
            none is described in Ping&apos;s public notes and none has been tried here. Each stays UNVERIFIED until a test in the last column has been run.
          </Caveat>
          <Card tone="neutral" title="Release features not yet measured">
            <table className="gwc-table gwc-table--stack" aria-label="Release features not yet measured" data-testid="gwc-not-measured-table">
              <thead><tr><th>Feature</th><th>Status</th><th>Our reading of the name</th><th>What a test needs</th></tr></thead>
              <tbody>
                {NOT_MEASURED.map((r) => (
                  <tr key={r.id} data-testid={`gwc-nm-${r.id}`}>
                    <td data-label="Feature"><strong>{r.feature}</strong></td>
                    <td data-label="Status"><Tag kind="unverified" /></td>
                    <td data-label="Our reading of the name">{r.reading}</td>
                    <td data-label="What a test needs">{r.test}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <Card tone="neutral" title="When the release is confirmed">
            <ol className="gwc-list">{RECHECK_STEPS.map((s) => <li key={s}>{s}</li>)}</ol>
          </Card>
        </Section>
      </div>
    </>
  );
}
