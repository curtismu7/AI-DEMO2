// /privilege-map — Privilege Map: for each Privilege feature, why we need it, how it works, the value to the
// end user and the components it uses, plus a generated diagram of those components (?diagram=1).
//
// Honesty: this page is reference text compiled from Ping documentation and our own tests
// (data/privilegeFeatures.json). Nothing on it calls Privilege or a gateway, and there is no live check. The
// diagram is drawn from the feature's own wording; its Simulate button walks the boxes in order as a teaching aid.
//
// Layout follows the standalone Ping UI Standard (AI-DEMO-Standalone/shared/STANDALONE-UI-PATTERNS.md) through
// the shared primitives (components/pingUi, docs/ping-ui-primitives.md): P2 banner first, P3 frame and sections,
// P4 cards, P5 key-value, P7 chips, P9 buttons. Skipped: P6 (no inspector: this is a reading page) and P8 (the
// diagram's boxes belong to the shared EmbeddedFlowDiagram, which this page does not restyle).
//
// P9 primary per view state: the feature view's primary is "Open the diagram in a new tab" (the one action that
// leads somewhere new; it stays a real link so it opens in a new tab and can be copied). The diagram view's
// primary is the diagram's own Simulate button (shared DiagramStepBar, restyled here to the fixed Ping Red
// tokens). The page and feature pickers are selectors, so they are secondary buttons that show their selection
// with a heavier edge, a fill and a check mark, never a primary colour.

import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import PageHeader from "../components/common/PageHeader";
import EmbeddedFlowDiagram from "../components/EmbeddedFlowDiagram";
import {
  PingPage, SimBanner, PageFrame, Section, Card, StatusChip, KvList,
} from "../components/pingUi";
import features from "../data/privilegeFeatures.json";
import { PRIVILEGE_MAP_PAGES } from "../config/privilegeMapPages";
import { buildFeatureDiagram } from "../config/privilegeFeatureDiagram";
import "./PrivilegeMapPage.css";

// A feature's own page and its diagram (the diagram opens in a new tab: same route with diagram=1).
const featureUrl = (f) => `/privilege-map?page=${f.page}&feature=${f.id}`;
const diagramUrl = (f) => `${featureUrl(f)}&diagram=1`;

export default function PrivilegeMapPage() {
  const [params, setParams] = useSearchParams();
  const page = PRIVILEGE_MAP_PAGES.find((p) => p.id === params.get("page")) || PRIVILEGE_MAP_PAGES[0];
  const list = features.filter((f) => f.page === page.id);
  const current = list.find((f) => f.id === params.get("feature")) || list[0];

  const go = (next) => setParams(next, { replace: true });

  // The diagram view: ?feature=<id>&diagram=1. The config is built once per feature so dragged boxes stay put.
  const diagramFeature = params.get("diagram") === "1" ? features.find((f) => f.id === params.get("feature")) : null;
  const diagramConfig = useMemo(
    () => (diagramFeature ? buildFeatureDiagram(diagramFeature, PRIVILEGE_MAP_PAGES.find((p) => p.id === diagramFeature.page)?.title) : null),
    [diagramFeature],
  );

  if (diagramFeature) {
    return (
      <PingPage className="pmap-page">
        <SimBanner data-testid="pmap-banner">
          <strong>GENERATED FROM TEXT</strong> — The boxes and arrows are drawn from this feature&apos;s own wording,
          not from a trace of a real call. Simulate steps through the components in order as a teaching aid.
          Nothing on this page calls Privilege or a gateway.
        </SimBanner>
        <PageHeader
          eyebrow="Ping products · Privilege info · Privilege Map"
          title={`${diagramFeature.name}: what it uses`}
          summary="The feature in the middle and each component it uses, drawn from the feature's own text. Simulate walks the components one at a time."
          back={{ to: featureUrl(diagramFeature), label: "Back to the feature" }}
        />
        <PageFrame>
          <Section id="pmap-diagram-h" kicker="1 · Diagram" title="How the pieces connect">
            <EmbeddedFlowDiagram
              config={diagramConfig}
              title={`${diagramFeature.name}: components`}
              lede="Drag any box. Each step shows the sentence from How it works that mentions the component, or says so when none does."
              ariaLabel={`${diagramFeature.name} diagram`}
              testId="pmap-diagram"
            />
          </Section>
        </PageFrame>
      </PingPage>
    );
  }

  return (
    <PingPage className="pmap-page">
      <SimBanner data-testid="pmap-banner">
        <strong>DRAFT, NOT LIVE</strong> — Draft content compiled from Ping documentation and our own tests. Nothing
        on this page calls Privilege or a gateway, and no check runs here. Open &ldquo;Sources and what is not
        verified&rdquo; on a feature before presenting it.
      </SimBanner>
      <PageHeader
        eyebrow="Ping products · Privilege info"
        title="Privilege Map"
        summary={`${features.length} Privilege features on ${PRIVILEGE_MAP_PAGES.length} pages. For each: why we need it, how it works, the value to the end user, and the components it uses.`}
        back={{ to: "/privilege-shelf", label: "Back to the Privilege shelf" }}
      />
      <PageFrame>
        <Section id="pmap-pick-h" kicker="1 · Choose" title="Pick a page, then a feature" lede={page.purpose}>
          <Card tone="neutral" className="pmap-pick">
            <p className="pu-label">Page</p>
            <nav className="pu-actions" aria-label="Privilege Map pages">
              {PRIVILEGE_MAP_PAGES.map((p) => (
                <PickButton key={p.id} selected={page.id === p.id} onClick={() => go({ page: p.id })}>{p.title}</PickButton>
              ))}
            </nav>
            <p className="pu-label">{`Features on ${page.title} (${list.length})`}</p>
            <nav className="pu-actions" aria-label={`${page.title} features`}>
              {list.map((f) => (
                <PickButton key={f.id} selected={current.id === f.id} onClick={() => go({ page: page.id, feature: f.id })}>{f.name}</PickButton>
              ))}
            </nav>
          </Card>
        </Section>
        <FeatureDetail key={current.id} feature={current} pageTitle={page.title} />
      </PageFrame>
    </PingPage>
  );
}

// A selector button (secondary, never primary): aria-pressed carries the state, the check mark and heavier edge show it.
function PickButton({ selected, onClick, children }) {
  return (
    <button type="button" className="pu-btn" aria-pressed={selected} onClick={onClick}>
      {selected ? <span className="pmap-check" aria-hidden="true">&#10003; </span> : null}
      {children}
    </button>
  );
}

function FeatureDetail({ feature, pageTitle }) {
  const open = feature.unverified.length;
  return (
    <>
      <Section id={`pmap-${feature.id}`} kicker={`2 · Read · ${pageTitle}`} title={feature.name}>
        <p className="pu-status-line">
          <StatusChip tone="warn">Draft</StatusChip>
          <StatusChip tone={open > 0 ? "warn" : "neutral"}>{open > 0 ? `${open} not verified` : "No unverified items listed"}</StatusChip>
        </p>
        <KvList
          items={[
            { label: "Page", value: pageTitle },
            { label: "Components used", value: String(feature.components.length) },
            { label: "Sources", value: String(feature.sources.length) },
          ]}
        />
        <p className="pu-actions pmap-diagram-link">
          <a className="pu-btn pu-btn--primary" href={diagramUrl(feature)} target="_blank" rel="noopener noreferrer">
            Open the diagram in a new tab <span aria-hidden="true">&#8599;</span>
          </a>
        </p>
        <Card title="Why we need it"><p className="pmap-prose">{feature.why}</p></Card>
        <Card title="How it works"><p className="pmap-prose">{feature.how}</p></Card>
        <Card title="Value to the end user"><p className="pmap-prose">{feature.userValue}</p></Card>
        <Card title="Components used">
          <ul className="pmap-chips">
            {feature.components.map((c) => <li key={c}><StatusChip>{c}</StatusChip></li>)}
          </ul>
        </Card>
      </Section>
      <Section id={`pmap-${feature.id}-sources`} kicker="3 · Check" title="Check before you present it">
        <Card tone={open > 0 ? "warn" : "neutral"}>
          <details className="pmap-more">
            <summary>Sources and what is not verified</summary>
            <KvList
              items={[
                { label: "Sources", value: feature.sources.join("; ") },
                {
                  label: "Not verified",
                  value: open > 0
                    ? <ul className="pmap-unverified">{feature.unverified.map((u) => <li key={u}>{u}</li>)}</ul>
                    : "Nothing listed.",
                },
              ]}
            />
          </details>
        </Card>
      </Section>
    </>
  );
}
