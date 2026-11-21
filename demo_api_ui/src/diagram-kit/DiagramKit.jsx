// The React half of the diagram kit. See README.md for how a lab wires it in (about ten lines).
//
//   ArrowNoLabel    an edge type that draws the curve only; the labels are drawn by EdgeLabels, above the boxes
//   EdgeLabels      every arrow's label, in a layer above the boxes, each on the first spot along its arrow that touches no other
//                   label and no box (diagramKit.js placeLabels); the label of the active arrow is marked and raised
//   Passport        the details of one expanded box (group, code pointers, reach, arrows in and out)
//   PassportActions the context an expanded box uses: open another box, close itself, make a link to itself
//   FitOpen         brings an expanded box fully into view; collapsing it fits the whole diagram again
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { BaseEdge, ViewportPortal, getBezierPath, useReactFlow, useStore } from "@xyflow/react";
import { placeLabels } from "./diagramKit.js";

/* ---------------------------------------------------------------- the arrow */

/** The curve only. An SVG label would sit under the boxes, so the label is not drawn here. Register as edgeTypes={{ arrow: ArrowNoLabel }}. */
export function ArrowNoLabel({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data: _data, label: _label, labelX: _lx, labelY: _ly, ...rest }) {
  const [path] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  return <BaseEdge path={path} {...rest} />;
}

/* ---------------------------------------------------------------- the labels */

// The boxes as React Flow measured them. (A lab's nodes are controlled, so the sizes are not on them: they are read from the store.)
const boxesOf = (fallback) => (s) => [...s.nodeLookup.values()].map((n) => ({ id: n.id, x: n.internals.positionAbsolute.x, y: n.internals.positionAbsolute.y, w: n.measured?.width ?? fallback.w, h: n.measured?.height ?? fallback.h }));
const sameBoxes = (a, b) => a.length === b.length && a.every((n, i) => n.id === b[i].id && n.x === b[i].x && n.y === b[i].y && n.w === b[i].w && n.h === b[i].h);

/**
 * Render inside <ReactFlow>.
 * @param items     [{ id, text, source, target, sourceHandle, targetHandle, active?, dim?, selected?, prefer? }] one per arrow, in drawing order
 * @param pointFor  (box, handleId) => [x, y, Position] | null : slotPoint / sidePoint / inOutPoint from diagramKit.js, or your own
 * @param present   true in presenter mode (bigger type)
 * @param onSelect  (item) => void : makes a label clickable (it then takes clicks); without it labels take none, so boxes under them stay draggable
 * @param fallback  { w, h } the size to assume for a box React Flow has not measured yet
 */
export function EdgeLabels({ items, pointFor, present = false, onSelect, fallback = { w: 180, h: 60 } }) {
  const boxes = useStore(useMemo(() => boxesOf(fallback), [fallback.w, fallback.h]), sameBoxes); // eslint-disable-line react-hooks/exhaustive-deps
  const els = useRef(new Map());
  const observer = useRef(null);
  const [sizes, setSizes] = useState(() => new Map()); // label id -> { w, h } as drawn; until then the placement estimates
  useEffect(() => {
    observer.current = new ResizeObserver((entries) => setSizes((prev) => {
      let next = null;
      for (const { target: el } of entries) {
        const w = el.offsetWidth; const h = el.offsetHeight; const old = prev.get(el.dataset.labelId);
        if (w > 0 && h > 0 && (!old || old.w !== w || old.h !== h)) { next ||= new Map(prev); next.set(el.dataset.labelId, { w, h }); }
      }
      return next || prev;
    }));
    for (const el of els.current.values()) observer.current.observe(el);
    return () => observer.current.disconnect();
  }, []);
  const placed = useMemo(() => {
    const by = new Map(boxes.map((b) => [b.id, b]));
    const input = items.flatMap((e) => {
      const a = by.get(e.source); const b = by.get(e.target);
      const from = a && pointFor(a, e.sourceHandle); const to = b && pointFor(b, e.targetHandle);
      return from && to && e.text ? [{ id: e.id, text: e.text, from, to, prefer: e.prefer ?? 0, size: sizes.get(e.id) }] : [];
    });
    return placeLabels({ edges: input, boxes, fontPx: present ? 14 : 11 });
  }, [boxes, items, present, sizes, pointFor]);
  return (
    <ViewportPortal>
      {items.filter((e) => placed.has(e.id)).map((e) => {
        const at = placed.get(e.id);
        const cls = `dk-label${e.active ? " dk-label--on" : ""}${e.dim ? " dk-label--dim" : ""}${e.selected ? " dk-label--sel" : ""}${onSelect ? " dk-label--click" : ""}`;
        return (
          <div key={e.id} ref={(el) => { if (el) { els.current.set(e.id, el); observer.current?.observe(el); } else els.current.delete(e.id); }} data-label-id={e.id} data-testid={`dk-label-${e.id}`}
            className={cls} style={{ transform: `translate(-50%, -50%) translate(${at.x}px, ${at.y}px)`, zIndex: e.active ? 3 : 1 }} onClick={onSelect ? () => onSelect(e) : undefined}>{e.text}</div>
        );
      })}
    </ViewportPortal>
  );
}

/* ---------------------------------------------------------------- the view */

/** An expanded box is brought fully into view (zoomed in, up to 100%, so its details are readable); collapsing it fits everything again. */
export function FitOpen({ open, closePadding = 0.12 }) {
  const rf = useReactFlow();
  const was = useRef(null);
  useEffect(() => {
    const before = was.current; was.current = open;
    if (!open && !before) return undefined;
    const t = setTimeout(() => rf.fitView(open ? { nodes: [{ id: open }], padding: 0.2, maxZoom: 1, duration: 250 } : { padding: closePadding, duration: 250 }), 120); // after the box has been re-measured
    return () => clearTimeout(t);
  }, [open, rf, closePadding]);
  return null;
}

/* ---------------------------------------------------------------- the box details */

/** What an expanded box can do: open another box (an arrow's far end), close itself, and build a link to itself. */
export const PassportActions = createContext({ open: () => {}, close: () => {}, link: () => "" });

/**
 * The details of one box (a boxPassport result), drawn inside the box when it is expanded. Text is React text only; the one link is
 * built from a validated GitHub URL. The whole block stops clicks and drags (nodrag nopan nowheel) so using it never moves the box,
 * pans the canvas or collapses the box.
 */
export function Passport({ p }) {
  const { open, close, link } = useContext(PassportActions);
  const [copy, setCopy] = useState({ state: "", url: "" });
  const copyLink = async () => {
    const url = link(p.id);
    try { await navigator.clipboard.writeText(url); setCopy({ state: "Copied", url: "" }); return; } catch { /* not a secure page, or no permission */ }
    try {
      const t = document.createElement("textarea"); t.value = url; t.setAttribute("readonly", ""); t.style.position = "fixed"; t.style.opacity = "0";
      document.body.appendChild(t); t.select(); const ok = document.execCommand("copy"); t.remove();
      if (ok) { setCopy({ state: "Copied", url: "" }); return; }
    } catch { /* fall through: show the link to copy by hand */ }
    setCopy({ state: "", url });
  };
  const list = (title, items, testId) => (
    <section aria-label={title} data-testid={testId} className={`dk-sec dk-sec--${title === "Outgoing" ? "out" : "in"}`}>
      <h4>{title} · {items.length}</h4>
      {items.length === 0 ? <p className="dk-passport-none">none</p> : (
        <ul className="dk-passport-list">{items.map((x, i) => (
          <li key={i} className="dk-passport-row"><button type="button" className="dk-passport-go" onClick={() => open(x.id)}>{x.label}</button>{x.arrow && <span className="dk-passport-arrow" title={x.arrow}>{x.arrow}</span>}</li>
        ))}</ul>
      )}
    </section>
  );
  return (
    <div className="dk-passport nodrag nopan nowheel" data-testid={`dk-passport-${p.id}`} onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      {p.group && <div><span className="dk-passport-chip">{p.group.label}</span></div>}
      {p.sources.length > 0 && (
        <section aria-label="Source" data-testid="dk-passport-sources" className="dk-sec dk-sec--source">
          <h4>Source</h4>
          {p.repo && <p className="dk-passport-repo">{p.repo.name} @ {p.repo.rev}</p>}
          <ul>{p.sources.map((s, i) => (
            <li key={i}>{s.label && <span>{s.label}: </span>}{s.href ? <a href={s.href} target="_blank" rel="noopener noreferrer">{s.text}</a> : <code>{s.text}</code>}</li>
          ))}</ul>
        </section>
      )}
      <section aria-label="Reach" data-testid="dk-passport-reach" className="dk-sec dk-sec--reach"><h4>Reach</h4><p><span className="dk-up">Upstream {p.upstream}</span> · <span className="dk-down">Downstream {p.downstream}</span></p></section>
      {list("Outgoing", p.outgoing, "dk-passport-outgoing")}
      {list("Incoming", p.incoming, "dk-passport-incoming")}
      <div className="dk-passport-actions">
        <button type="button" onClick={copyLink} data-testid="dk-passport-copy">{copy.state || "Copy link"}</button>
        <button type="button" onClick={close} data-testid="dk-passport-close">Close</button>
      </div>
      {copy.url && <input className="dk-passport-url" readOnly value={copy.url} aria-label="Link to this box" onFocus={(e) => e.target.select()} data-testid="dk-passport-url" />}
    </div>
  );
}
