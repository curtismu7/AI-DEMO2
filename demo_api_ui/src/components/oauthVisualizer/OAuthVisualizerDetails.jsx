export default function OAuthVisualizerDetails({ detail }) {
  if (!detail) return <div className="ov-empty-detail">Select a step to inspect its request, response, or notes.</div>;
  return (
    <div className="ov-details">
      <div className="ov-detail-heading">{detail.title}</div>
      {detail.request && <section><h4>Request</h4><pre>{JSON.stringify(detail.request, null, 2)}</pre></section>}
      {detail.response && <section><h4>Response</h4><pre>{JSON.stringify(detail.response, null, 2)}</pre></section>}
      {detail.notes && <section><h4>Notes</h4><p>{detail.notes}</p></section>}
      {detail.error && <section className="ov-detail-error"><h4>Error</h4><p>{detail.error}</p></section>}
    </div>
  );
}
