import { useEffect, useState } from "react";
import { getAll, subscribe } from "../../services/apiTrafficStore";

const SHOWN = 8;

/** One plain-words line per call, so a viewer can tell why something did not work. */
export function describeCall(e) {
  if (e.status === 401) return "Not signed in, or the session expired";
  if (e.status === 403) return "Signed in, but not allowed";
  if (e.status === 0) return `No response${e.error ? `: ${e.error}` : ""}`;
  if (e.status >= 500) return "Server error";
  if (e.status >= 400) return "Request rejected";
  return "OK";
}

export function ShellActivity() {
  const [entries, setEntries] = useState(getAll);
  useEffect(() => subscribe(setEntries), []);
  const rows = entries.slice(0, SHOWN);
  return (
    <details className="pvs-activity" open>
      <summary>ACTIVITY</summary>
      {rows.length === 0 ? <div className="pvs-activity__empty">No API calls yet</div> : (
        <ul aria-label="Recent API calls">
          {rows.map((e) => (
            <li key={e.id} className={e.status >= 400 || e.status === 0 ? "pvs-activity__row pvs-activity__row--bad" : "pvs-activity__row"}>
              <span>{e.method}</span> <span>{e.url}</span> <span>{e.status || "ERR"}</span>
              {typeof e.duration === "number" ? <span>{e.duration}ms</span> : null}
              <em>{describeCall(e)}</em>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}
