export default function ServerTopologyExportControls() {
  return (
    <details className="stm-export-controls stm-export-menu">
      <summary className="stm-export-menu__trigger">Export</summary>
      <div className="stm-export-menu__panel" role="group" aria-label="Export server topology">
        <button type="button" onClick={() => window.print()}>Save as PDF</button>
        <a href="/exports/server-topology-lucidchart.csv" download="server-topology-lucidchart.csv">
          Download Lucidchart CSV
        </a>
        <a href="/exports/server-topology-details.csv" download="server-topology-details.csv">
          Download details CSV
        </a>
        <span className="stm-export-hint">Lucidchart: Shapes → Import Data → Process diagram</span>
      </div>
    </details>
  );
}
