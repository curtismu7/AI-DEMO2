import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import PageHeader from "../components/common/PageHeader";
import EmbeddedFlowDiagram from "../components/EmbeddedFlowDiagram";
import features from "../data/privilegeFeatures.json";
import { PRIVILEGE_MAP_PAGES } from "../config/privilegeMapPages";
import { buildFeatureDiagram } from "../config/privilegeFeatureDiagram";
import "./PrivilegeMapPage.css";

// A feature's own page and its diagram (the diagram opens in a new tab: same route with diagram=1).
const featureUrl = (f) => `/privilege-map?page=${f.page}&feature=${f.id}`;
const diagramUrl = (f) => `${featureUrl(f)}&diagram=1`;

function Section({ title, children }) {
  return (
    <section className="pmap-sec">
      <h4>{title}</h4>
      {children}
    </section>
  );
}

function FeatureDetail({ feature }) {
  return (
    <article className="pmap-feature" aria-labelledby={`pmap-${feature.id}`}>
      <h3 id={`pmap-${feature.id}`}>{feature.name}</h3>
      <p className="pmap-diagram-link">
        <a href={diagramUrl(feature)} target="_blank" rel="noopener noreferrer">Open the diagram in a new tab <span aria-hidden="true">&#8599;</span></a>
      </p>
      <Section title="Why we need it"><p>{feature.why}</p></Section>
      <Section title="How it works"><p>{feature.how}</p></Section>
      <Section title="Value to the end user"><p>{feature.userValue}</p></Section>
      <Section title="Components used">
        <ul className="pmap-chips">
          {feature.components.map((c) => <li key={c}>{c}</li>)}
        </ul>
      </Section>
      <details className="pmap-more">
        <summary>Sources and what is not verified</summary>
        <p className="pmap-small"><strong>Sources:</strong> {feature.sources.join("; ")}</p>
        {feature.unverified.length > 0 && (
          <>
            <p className="pmap-small"><strong>Not verified:</strong></p>
            <ul className="pmap-small">{feature.unverified.map((u) => <li key={u}>{u}</li>)}</ul>
          </>
        )}
      </details>
    </article>
  );
}

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
      <div className="pmap-page">
        <PageHeader
          eyebrow="Ping products · Privilege info · Privilege Map"
          title={`${diagramFeature.name}: what it uses`}
          summary="The feature in the middle and each component it uses, drawn from the feature's own text. Simulate walks the components one at a time."
          back={{ to: featureUrl(diagramFeature), label: "Back to the feature" }}
        />
        <div className="pmap-body">
          <EmbeddedFlowDiagram
            config={diagramConfig}
            title={`${diagramFeature.name}: components`}
            lede="Drag any box. Each step shows the sentence from How it works that mentions the component, or says so when none does."
            ariaLabel={`${diagramFeature.name} diagram`}
            testId="pmap-diagram"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="pmap-page">
      <PageHeader
        eyebrow="Ping products · Privilege info"
        title="Privilege Map"
        summary={`${features.length} Privilege features on ${PRIVILEGE_MAP_PAGES.length} pages. For each: why we need it, how it works, the value to the end user, and the components it uses.`}
        back={{ to: "/privilege-shelf", label: "Back to the Privilege shelf" }}
      />
      <div className="pmap-body">
        <nav className="pmap-tabs" aria-label="Privilege Map pages">
          {PRIVILEGE_MAP_PAGES.map((p) => (
            <button key={p.id} type="button" aria-pressed={page.id === p.id} onClick={() => go({ page: p.id })}>{p.title}</button>
          ))}
        </nav>
        <p className="pmap-purpose">{page.purpose}</p>
        <p className="pmap-draft" role="note">
          Draft content compiled from Ping documentation and our own tests. Open &ldquo;Sources and what is not verified&rdquo; on a feature before presenting it.
        </p>
        <div className="pmap-split">
          <nav className="pmap-list" aria-label={`${page.title} features`}>
            {list.map((f) => (
              <button key={f.id} type="button" aria-pressed={current.id === f.id} onClick={() => go({ page: page.id, feature: f.id })}>{f.name}</button>
            ))}
          </nav>
          <FeatureDetail key={current.id} feature={current} />
        </div>
      </div>
    </div>
  );
}
