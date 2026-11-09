// whereRunsModel.js - turns an env-map/1 snapshot into the two arrangements /where-everything-runs draws, and
// lays them out as ReactFlow nodes and edges. A trimmed in-app copy of the logic in the standalone env-map-LAB
// (server/src/view.js, roles.js, web/src/lib/layout.js); nothing is imported across repos. Pure functions, no I/O.
//
// Today = what the snapshot says. After = Kubernetes for servers only, every front end in Docker on the Mac:
//   server on k8s            stays; at 0 replicas it is listed "to scale up"
//   server only on local     "to deploy on Kubernetes" (placed in the first k8s environment); a stopped one is not planned
//   server on local with a server of a matching name on k8s: already there, it leaves local
//   frontend / lab on local  stays
//   frontend / lab on k8s    "removed" from k8s; moves to the local environment unless it is at 0 or local already has that name
export const ROLE_LABEL = { server: "Servers", frontend: "Front ends", lab: "Labs", external: "External services" };
export const ROLE_WORD = { server: "server", frontend: "front end", lab: "lab", external: "external" };

// Two workloads are "the same thing" when the names are equal or one ends with the other after a dash (ai-api vs api).
export function nameMatches(a, b) {
  const x = String(a).toLowerCase();
  const y = String(b).toLowerCase();
  return x === y || x.endsWith(`-${y}`) || y.endsWith(`-${x}`);
}

export function stateOf(w) {
  if (w.want === undefined) return "na";
  if (w.want === 0) return "off";
  if (w.ready >= w.want) return "up";
  return w.ready === 0 ? "down" : "partial";
}

function prepare(snapshot) {
  return snapshot.environments.map((e) => ({
    id: e.id, label: e.label, kind: e.kind,
    workloads: e.workloads.map((w) => {
      const eff = { env: e.id, envLabel: e.label, envKind: e.kind, name: w.name, kind: w.kind, ready: w.ready, want: w.want, group: w.group, role: w.role || (e.kind === "saas" ? "external" : "server") };
      eff.state = stateOf(eff);
      return eff;
    }),
  }));
}

const rowLabel = (w) => w.group || ROLE_LABEL[w.role];
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "x";
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}...` : s);
const compact = (item) => {
  const w = item.w;
  const o = { name: w.name, kind: w.kind, ready: w.ready, want: w.want, state: w.state, role: w.role, group: w.group };
  if (item.movedFrom) o.movedFrom = item.movedFrom;
  if (item.plan) o.plan = item.plan;
  return o;
};

const SPECIAL = {
  deploy: { key: "~deploy", title: "To deploy on Kubernetes", rank: 1, off: false, note: "These servers run only on the Mac today and have no workload of a matching name on Kubernetes. The match is by name: one of them may already be covered by a differently named workload there." },
  scaleup: { key: "~scaleup", title: "Servers to scale up (at 0 today)", rank: 2, off: true, note: "These servers exist on Kubernetes at 0 replicas. After the change they have to be running." },
};

function buildCards(env, items) {
  const order = [];
  const byKey = new Map();
  const offTitle = env.kind === "k8s" ? "Scaled to 0" : "Stopped";
  for (const item of items) {
    const w = item.w;
    let spec = item.card;
    if (!spec && item.plan === "moved") spec = { key: `~moved:${rowLabel(w)}`, title: `${rowLabel(w)}, moved from Kubernetes`, rank: 0.5, off: false };
    if (!spec) spec = w.state === "off" ? { key: "~off", title: offTitle, rank: 3, off: true } : { key: `g:${rowLabel(w)}`, title: rowLabel(w), rank: 0, off: false };
    let c = byKey.get(spec.key);
    if (!c) { c = { ...spec, items: [] }; byKey.set(spec.key, c); order.push(c); }
    c.items.push(item);
  }
  order.sort((a, b) => a.rank - b.rank);
  const placement = new Map();
  const used = new Set();
  const cards = order.map((c) => {
    let id = `${env.id}::${slug(c.key)}`;
    for (let n = 2; used.has(id); n++) id = `${env.id}::${slug(c.key)}-${n}`;
    used.add(id);
    const ws = c.items.map(compact);
    for (const it of c.items) placement.set(it.w, id);
    const up = ws.filter((x) => x.state === "up").length;
    const counted = ws.filter((x) => x.state !== "na").length;
    let chip = null;
    if (counted) chip = c.off ? `${ws.length} ${env.kind === "k8s" ? "at 0" : "stopped"}` : c.key === "~deploy" ? `${ws.length} to deploy` : c.key.startsWith("~moved:") ? `${ws.length} moved` : up === ws.length ? `${ws.length} running` : `${up} of ${ws.length} up`;
    return { id, envId: env.id, title: c.title, subtitle: clip(ws.map((x) => x.name).join(", "), 90), chip, off: c.off, note: c.note, count: ws.length, workloads: ws };
  });
  return { cards, placement };
}

function regionSubtitle(env, view, count) {
  const base = env.kind === "local" ? "Docker on this Mac" : env.kind === "k8s" ? "Kubernetes" : "Outside your environments";
  const scope = view === "after" ? (env.kind === "local" ? ", front ends and labs only" : env.kind === "k8s" ? ", servers only" : "") : "";
  return `${base}${scope}. ${count} ${count === 1 ? "workload" : "workloads"}.`;
}

function makeResolver(prepared) {
  const byName = new Map();
  const byGroup = new Map();
  const envIds = new Set();
  for (const e of prepared) {
    envIds.add(e.id);
    for (const w of e.workloads) {
      byName.set(`${e.id}/${w.name}`, w);
      if (w.group) { const k = `${e.id}/${w.group}`; if (!byGroup.has(k)) byGroup.set(k, []); byGroup.get(k).push(w); }
    }
  }
  return (ep, placement, firstCardOf) => {
    if (byName.has(ep)) return placement.get(byName.get(ep)) || null;
    if (byGroup.has(ep)) { for (const w of byGroup.get(ep)) { const c = placement.get(w); if (c) return c; } return null; }
    if (envIds.has(ep)) return firstCardOf.get(ep) || null;
    return undefined;
  };
}

function buildLinks(snapshot, resolve, placement, regions) {
  const firstCardOf = new Map(regions.map((r) => [r.envId, r.cards[0]?.id]));
  const links = [];
  const seen = new Set();
  for (const l of snapshot.links) {
    const a = resolve(l.from, placement, firstCardOf);
    const b = resolve(l.to, placement, firstCardOf);
    if (!a || !b || a === b) continue;
    const key = `${a}|${b}|${l.label}|${l.source}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({ id: `e${links.length}`, from: a, to: b, label: l.label, source: l.source });
  }
  return links;
}

function regionsFrom(envs, itemsByEnv, view) {
  const placement = new Map();
  const regions = envs.map((env) => {
    const items = itemsByEnv.get(env.id) || [];
    const built = buildCards(env, items);
    for (const [w, id] of built.placement) placement.set(w, id);
    return { id: `R:${env.id}`, envId: env.id, label: env.label, kind: env.kind, subtitle: regionSubtitle(env, view, items.length), cards: built.cards };
  });
  return { regions, placement };
}

function todayView(prepared, snapshot, resolve) {
  const itemsByEnv = new Map(prepared.map((e) => [e.id, e.workloads.map((w) => ({ w }))]));
  const { regions, placement } = regionsFrom(prepared, itemsByEnv, "today");
  return { name: "today", regions, links: buildLinks(snapshot, resolve, placement, regions), changes: null };
}

const ref = (w, extra = {}) => ({ env: w.env, envLabel: w.envLabel, name: w.name, role: w.role, ...extra });

function afterView(prepared, snapshot, resolve) {
  let envs = prepared;
  if (!envs.some((e) => e.kind === "local")) envs = [{ id: "local", label: "This Mac (Docker)", kind: "local", workloads: [] }, ...envs];
  const k8sEnvs = envs.filter((e) => e.kind === "k8s");
  const target = k8sEnvs[0] || null;
  const firstLocal = envs.find((e) => e.kind === "local");
  const k8sServers = k8sEnvs.flatMap((e) => e.workloads).filter((x) => x.role === "server");
  const localUis = envs.filter((e) => e.kind === "local").flatMap((e) => e.workloads).filter((x) => x.role === "frontend" || x.role === "lab");
  const items = new Map(envs.map((e) => [e.id, []]));
  const redirects = new Map();
  const ch = { toDeploy: [], toScaleUp: [], removed: [], movedToLocal: [], leavesLocal: [], alreadyLocal: [], stoppedLocalServers: [] };

  for (const e of envs) {
    for (const w of e.workloads) {
      if (e.kind === "saas" || w.role === "external") { items.get(e.id).push({ w }); continue; }
      if (w.role === "server") {
        if (e.kind === "k8s") {
          if (w.state === "off") { ch.toScaleUp.push(ref(w)); items.get(e.id).push({ w, card: SPECIAL.scaleup, plan: "scaleup" }); } else items.get(e.id).push({ w });
          continue;
        }
        const match = k8sServers.find((k) => nameMatches(k.name, w.name));
        if (match) { ch.leavesLocal.push(ref(w, { matchedWith: match.name })); redirects.set(w, match); continue; }
        if (w.state === "off") { ch.stoppedLocalServers.push(ref(w)); continue; }
        ch.toDeploy.push(ref(w, { targetLabel: target ? target.label : null }));
        if (target) items.get(target.id).push({ w, card: SPECIAL.deploy, plan: "deploy", movedFrom: e.label });
        continue;
      }
      if (e.kind === "local") { items.get(e.id).push({ w }); continue; }
      ch.removed.push(ref(w));
      if (w.state === "off") continue;
      const have = localUis.find((l) => nameMatches(l.name, w.name));
      if (have) { ch.alreadyLocal.push(ref(w, { matchedWith: have.name })); redirects.set(w, have); continue; }
      ch.movedToLocal.push(ref(w));
      items.get(firstLocal.id).push({ w, plan: "moved", movedFrom: e.label });
    }
  }
  const { regions, placement } = regionsFrom(envs, items, "after");
  for (const [from, to] of redirects) { const c = placement.get(to); if (c) placement.set(from, c); }
  return { name: "after", regions, links: buildLinks(snapshot, resolve, placement, regions), changes: ch };
}

export function buildViews(snapshot) {
  const prepared = prepare(snapshot);
  const resolve = makeResolver(prepared);
  const total = prepared.reduce((n, e) => n + e.workloads.length, 0);
  return { takenAt: snapshot.takenAt, counts: { environments: prepared.length, workloads: total }, today: todayView(prepared, snapshot, resolve), after: afterView(prepared, snapshot, resolve) };
}

// ---- layout: a view -> ReactFlow nodes and edges ------------------------------------------------------------------
export const STEP = 98;
export const TOP = 74;
export const REGION_W = 440;
export const CARD_W = 400;
export const SAAS_CARD_W = 300;
export const GAP = 60;
export const MIN_ZOOM = 0.9; // the default view is never smaller than this; pan for the rest

export const toneOf = (region, k8sIndex) => (region.kind === "local" ? "local" : region.kind === "saas" ? "saas" : `k8s${k8sIndex % 2}`);

// fitView picks the zoom that shows everything; below MIN_ZOOM, start at MIN_ZOOM near the top left instead.
export function chooseViewport(fitted) {
  if (!fitted || !(fitted.zoom < MIN_ZOOM)) return fitted;
  return { x: 12, y: 8, zoom: MIN_ZOOM };
}

export function buildFlow(view) {
  const top = view.regions.filter((r) => r.kind !== "saas");
  const saas = view.regions.filter((r) => r.kind === "saas");
  const nodes = [];
  const cardInfo = new Map();
  const geometry = new Map();
  let k8s = 0;
  let rowBottom = 0;
  top.forEach((r, i) => {
    const tone = toneOf(r, r.kind === "k8s" ? k8s++ : 0);
    const h = TOP + Math.max(1, r.cards.length) * STEP + 14;
    const g = { x: i * (REGION_W + GAP), y: 0, w: REGION_W, h, cw: CARD_W, tone };
    geometry.set(r.envId, g);
    rowBottom = Math.max(rowBottom, h);
    nodes.push({ id: r.id, type: "region", position: { x: g.x, y: g.y }, data: { region: r, tone }, style: { width: g.w, height: g.h }, draggable: true, selectable: false, zIndex: 0 });
    r.cards.forEach((c, ci) => {
      cardInfo.set(c.id, { card: c, region: r, geometry: g });
      nodes.push({ id: c.id, type: "card", parentId: r.id, extent: "parent", position: { x: (g.w - g.cw) / 2, y: TOP + ci * STEP }, data: { card: c, tone, cw: g.cw }, zIndex: 1 });
    });
  });
  const stripW = Math.max(REGION_W, top.length * (REGION_W + GAP) - GAP);
  let x = 0;
  let y = rowBottom + 70;
  let rowH = 0;
  saas.forEach((r) => {
    const n = Math.max(1, r.cards.length);
    const w = Math.min(Math.max(n * (SAAS_CARD_W + 14) + 14, 340), stripW);
    if (x > 0 && x + w > stripW) { x = 0; y += rowH + 40; rowH = 0; }
    const cols = Math.max(1, Math.floor((w - 14) / (SAAS_CARD_W + 14)));
    const h = 64 + Math.ceil(n / cols) * STEP + 14;
    const g = { x, y, w, h, cw: SAAS_CARD_W, tone: "saas" };
    geometry.set(r.envId, g);
    rowH = Math.max(rowH, h);
    nodes.push({ id: r.id, type: "region", position: { x, y }, data: { region: r, tone: "saas" }, style: { width: w, height: h }, draggable: true, selectable: false, zIndex: 0 });
    r.cards.forEach((c, ci) => {
      cardInfo.set(c.id, { card: c, region: r, geometry: g });
      nodes.push({ id: c.id, type: "card", parentId: r.id, extent: "parent", position: { x: 14 + (ci % cols) * (SAAS_CARD_W + 14), y: 64 + Math.floor(ci / cols) * STEP }, data: { card: c, tone: "saas", cw: SAAS_CARD_W }, zIndex: 1 });
    });
    x += w + GAP;
  });

  const edges = view.links.map((l) => {
    const a = cardInfo.get(l.from);
    const b = cardInfo.get(l.to);
    let sh = "r";
    let th = "r";
    if (a && b && a.geometry !== b.geometry) {
      const ga = a.geometry;
      const gb = b.geometry;
      if (gb.y >= ga.y + ga.h) { sh = "l"; th = "t"; } // down to the SaaS strip: leave by the left edge, beside the cards
      else if (ga.y >= gb.y + gb.h) { sh = "t"; th = "b"; }
      else if (ga.x < gb.x) { sh = "r"; th = "l"; }
      else { sh = "l"; th = "r"; }
    }
    return {
      id: l.id, source: l.from, target: l.to, sourceHandle: sh, targetHandle: `${th}-in`, label: l.label, type: "smoothstep", zIndex: 2,
      className: l.source === "configured" ? "wr-edge wr-edge--configured" : "wr-edge",
      labelBgPadding: [5, 3], labelBgBorderRadius: 4, data: { source: l.source },
    };
  });
  return { nodes, edges, cardInfo };
}
