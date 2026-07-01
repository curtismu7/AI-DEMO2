// demo_api_ui/src/components/authz/DemoForm.jsx
import "./DemoForm.css";

export default function DemoForm({ fields, values, onChange }) {
  if (!fields || fields.length === 0) return null;
  return (
    <div className="demo-form">
      {fields.map((f) => {
        const id = `df-${f.name}`;
        const value = values[f.name] ?? f.default ?? "";
        return (
          <div className="demo-form-row" key={f.name}>
            <label htmlFor={id}>{f.label}</label>
            {f.type === "select" ? (
              <select className="form-select" id={id} value={value} onChange={(e) => onChange(f.name, e.target.value)}>
                {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : (
              <input className="form-input" id={id} type={f.type === "number" ? "number" : "text"} value={value}
                onChange={(e) => onChange(f.name, e.target.value)} />
            )}
          </div>
        );
      })}
    </div>
  );
}
