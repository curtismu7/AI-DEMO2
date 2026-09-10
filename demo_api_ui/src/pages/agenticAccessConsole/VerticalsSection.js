import React from "react";

const VERTICALS = [
  { name: "Super Banking", level: "user" },
  { name: "Super Sports", level: "user" },
  { name: "Abercrombie & Fitch", level: "user" },
  { name: "United Airlines", level: "user" },
  { name: "CivicPermit", level: "user" },
  { name: "CareConnect", level: "user" },
  { name: "Meridian Wealth", level: "user" },
  { name: "Precision Works", level: "user" },
  { name: "Great Buy", level: "user" },
  { name: "Super University", level: "user" },
  { name: "WX Workforce", level: "user" },
  { name: "OAuth Academy", level: "public" },
  { name: "Admin Portal", level: "admin" },
  { name: "Admin Console", level: "admin" },
  { name: "PingOne Admin", level: "admin" },
];

export default function VerticalsSection() {
  return (
    <div>
      <p className="aac-section-intro">
        Auth level, per verticals and reserved routes.
      </p>

      <div className="aac-legend">
        <span className="aac-legend-item"><span className="aac-badge aac-badge--user">user</span> default — requires signed-in session</span>
        <span className="aac-legend-item"><span className="aac-badge aac-badge--public">public</span> no session — weather, guest chat, Learning Hub UC-LEARN1-9, PAM setup/script</span>
        <span className="aac-legend-item"><span className="aac-badge aac-badge--admin">admin</span> Admin Portal/Console use cases ADMIN1-13, plus UC-NHI2</span>
      </div>

      <div className="aac-vertical-grid">
        {VERTICALS.map((v) => (
          <div key={v.name} className="aac-vertical-tile">
            <span>{v.name}</span>
            <span className={`aac-badge aac-badge--${v.level}`}>{v.level}</span>
          </div>
        ))}
      </div>

      <div className="aac-section-block">
        <h3>Monitoring</h3>
        <div className="aac-card">
          <div className="aac-card-body">
            Grafana / Prometheus / Jaeger, source <code>monitoring/</code>, scraping
            PingGateway's admin connector. Alert rules evaluate but there is no
            Alertmanager to route them to — anything numeric on a live monitoring
            page should be read as illustrative, not a real-time count.
          </div>
        </div>
      </div>
    </div>
  );
}
