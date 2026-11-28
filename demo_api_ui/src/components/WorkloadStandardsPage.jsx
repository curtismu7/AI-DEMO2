import "./WorkloadStandardsPage.css";
import PageHeader from "./common/PageHeader";

const STANDARDS = [
  {
    key: "spiffe",
    name: "SPIFFE",
    what: "Identity format for workloads — SVIDs and trust domains",
    status: "CNCF Graduated",
    tone: "green",
    why: "The portable workload identifier platform teams ask for by name. In production at Uber, Bloomberg, GitHub and Twilio.",
  },
  {
    key: "oidc",
    name: "OIDC",
    what: "Federation at the destination",
    status: "Shipping Widely",
    tone: "green",
    why: "AWS, Google, Azure, GitHub, Snowflake and Anthropic now accept a token from an issuer you already trust, so no key is stored at all.",
  },
  {
    key: "oauth",
    name: "OAuth",
    what: "Token exchange, RFC 8693 (act / may_act)",
    status: "Stable",
    tone: "green",
    why: "How a workload acts for a named person without impersonating them — the basis of delegated agent access across applications.",
  },
  {
    key: "wimse",
    name: "WIMSE",
    what: "IETF wire format: workload identity token and proof token",
    status: "No RFC Yet",
    tone: "amber",
    why: "Eight drafts, the architecture document behind schedule, token-plus-proof self-reported as alpha. Worth tracking; nobody can honestly claim compliance.",
  },
];

function StatusBadge({ tone, children }) {
  return <span className={`workload-standards__badge workload-standards__badge--${tone}`}>{children}</span>;
}

export default function WorkloadStandardsPage() {
  return (
    <div className="workload-standards">
      <PageHeader
        className="workload-standards__hero"
        eyebrow="Standards"
        title="What we build to, and how finished it is"
        summary="Design to the concepts; several of the wire formats are still moving."
      />

      <section className="workload-standards__table-section" aria-labelledby="workload-standards-table-title">
        <h2 id="workload-standards-table-title" className="workload-standards__visually-hidden">
          Standards comparison
        </h2>
        <div className="workload-standards__table-wrap" role="region" aria-label="Workload identity standards comparison" tabIndex={0}>
          <table className="workload-standards__table">
            <thead>
              <tr>
                <th scope="col">Standard</th>
                <th scope="col">What it is</th>
                <th scope="col">Status</th>
                <th scope="col">Why it matters to you</th>
              </tr>
            </thead>
            <tbody>
              {STANDARDS.map((s) => (
                <tr key={s.key} className={`workload-standards__row workload-standards__row--${s.tone}`}>
                  <th scope="row">{s.name}</th>
                  <td>{s.what}</td>
                  <td>
                    <StatusBadge tone={s.tone}>{s.status}</StatusBadge>
                  </td>
                  <td className={s.tone === "amber" ? "workload-standards__why-amber" : undefined}>{s.why}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <footer className="workload-standards__closing">
        <strong>Where a target can federate itself, use that.</strong>
        <span>
          The hard half is everything that cannot: SSH, databases, Kubernetes and internal APIs.
        </span>
      </footer>
    </div>
  );
}
