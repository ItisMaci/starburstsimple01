/*
*  Power BI Visual CLI
*  MIT License
*/

/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* eslint-disable @typescript-eslint/ban-ts-comment */

"use strict";

import "./../style/visual.less";

import * as d3 from "d3";
import powerbi from "powerbi-visuals-api";

import IVisual = powerbi.extensibility.visual.IVisual;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;

type Domain = { domain_id: number; domain_name: string };
type Ebene2 = { level_id: number; level_name: string; parent_id: number };
type Ebene3 = { level_id: number; level_name: string; parent_id: number };
type Ebene4 = { level_id: number; level_name: string; parent_id: number };

type Raw = {
  domains: Domain[];
  ebene2: Ebene2[];
  ebene3: Ebene3[];
  ebene4: Ebene4[];
};

type Depth = 1 | 2 | 3 | 4;
type NodeMeta = { depth: Depth };

type NodeData = {
  name: string;
  value?: number;
  children?: NodeData[];
  __meta?: NodeMeta;
};

type ArcDatum = { x0: number; x1: number; y0: number; y1: number };

type SunburstNode = d3.HierarchyRectangularNode<NodeData> & {
  current?: ArcDatum;
  target?: ArcDatum;
};

// -----------------------------
// 1) Build hierarchy (UNCHANGED)
// -----------------------------
function buildHierarchy(rawData: Raw): NodeData {
  console.log("[Sunburst] buildHierarchy: input sizes", {
    domains: rawData.domains.length,
    ebene2: rawData.ebene2.length,
    ebene3: rawData.ebene3.length,
    ebene4: rawData.ebene4.length
  });

  const e4ByParent = new Map<number, Ebene4[]>();
  for (const n of rawData.ebene4) {
    if (!e4ByParent.has(n.parent_id)) e4ByParent.set(n.parent_id, []);
    e4ByParent.get(n.parent_id)!.push(n);
  }

  const e3ByParent = new Map<number, Ebene3[]>();
  for (const n of rawData.ebene3) {
    if (!e3ByParent.has(n.parent_id)) e3ByParent.set(n.parent_id, []);
    e3ByParent.get(n.parent_id)!.push(n);
  }

  const e2ByDomain = new Map<number, Ebene2[]>();
  for (const n of rawData.ebene2) {
    if (!e2ByDomain.has(n.parent_id)) e2ByDomain.set(n.parent_id, []);
    e2ByDomain.get(n.parent_id)!.push(n);
  }

  const domains: NodeData[] = rawData.domains.map((d): NodeData => {
    const e2s = e2ByDomain.get(d.domain_id) ?? [];
    const childrenLvl2: NodeData[] = e2s.map((l2): NodeData => {
      const e3s = e3ByParent.get(l2.level_id) ?? [];
      const childrenLvl3: NodeData[] = e3s.map((l3): NodeData => {
        const e4s = e4ByParent.get(l3.level_id) ?? [];
        const childrenLvl4: NodeData[] = e4s.map((l4): NodeData => ({
          name: l4.level_name,
          value: 1,
          __meta: { depth: 4 }
        }));
        if (childrenLvl4.length === 0) {
          return { name: l3.level_name, value: 1, __meta: { depth: 3 } };
        }
        return { name: l3.level_name, children: childrenLvl4, __meta: { depth: 3 } };
      });
      if (childrenLvl3.length === 0) {
        return { name: l2.level_name, value: 1, __meta: { depth: 2 } };
      }
      return { name: l2.level_name, children: childrenLvl3, __meta: { depth: 2 } };
    });

    if (childrenLvl2.length === 0) {
      return { name: d.domain_name, value: 1, __meta: { depth: 1 } };
    }
    return { name: d.domain_name, children: childrenLvl2, __meta: { depth: 1 } };
  });

  const out = { name: "Wien", children: domains };
  console.log("[Sunburst] buildHierarchy: domains tree count", domains.length);
  return out;
}

// -----------------------------
// 1.5) Table→Raw extractor (supports: layered tables OR adjacency table)
// -----------------------------
function extractRawFromTable(dv: powerbi.DataView): Raw {
  const empty: Raw = { domains: [], ebene2: [], ebene3: [], ebene4: [] };
  const t = dv.table;

  if (!t) {
    console.warn("[Sunburst] extractRawFromTable: no table dataview present");
    return empty;
  }
  if (!t.rows?.length || !t.columns?.length) {
    console.warn("[Sunburst] extractRawFromTable: empty table (rows/columns missing)", {
      rows: t.rows?.length ?? 0,
      cols: t.columns?.length ?? 0
    });
    return empty;
  }

  console.log("[Sunburst] Table columns:", t.columns.map(c => ({
    displayName: c.displayName,
    queryName: c.queryName,
    type: (c.type && (c.type as any).category) || undefined
  })));

  const cols = t.columns;
  const norm = (s?: string) => (s ?? "").toLowerCase();
  const findIdx = (patterns: readonly RegExp[]): number => {
    for (let i = 0; i < cols.length; i++) {
      const dn = norm(cols[i].displayName);
      const qn = norm(cols[i].queryName);
      if (patterns.some((p) => p.test(dn) || p.test(qn))) return i;
    }
    return -1;
  };
  const toNum = (v: any): number | null => {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const toStr = (v: any): string | null => (v === null || v === undefined ? null : String(v));

  // --------- Layered-table patterns (domains/e2/e3/e4 columns can be present in any order) ---------
  const p = {
    domain_id: [/^domain[_\s]?id$/i, /\.domain[_\s]?id$/i] as const,
    domain_name: [/^domain[_\s]?name$/i, /\.domain[_\s]?name$/i] as const,

    e2_id: [/^(e2|ebene2|level2|l2)[_\s]?id$/i, /\.((e2|ebene2|level2|l2)[_\s]?id)$/i] as const,
    e2_name: [/^(e2|ebene2|level2|l2).*(name|level[_\s]?name)$/i] as const,
    e2_parent: [/^(e2|ebene2|level2|l2).*(parent[_\s]?id|parent|domain[_\s]?id)$/i] as const,

    e3_id: [/^(e3|ebene3|level3|l3)[_\s]?id$/i] as const,
    e3_name: [/^(e3|ebene3|level3|l3).*(name|level[_\s]?name)$/i] as const,
    e3_parent: [/^(e3|ebene3|level3|l3).*(parent[_\s]?id|parent|level2|l2|e2).*$/i] as const,

    e4_id: [/^(e4|ebene4|level4|l4)[_\s]?id$/i] as const,
    e4_name: [/^(e4|ebene4|level4|l4).*(name|level[_\s]?name)$/i] as const,
    e4_parent: [/^(e4|ebene4|level4|l4).*(parent[_\s]?id|parent|level3|l3|e3).*$/i] as const
  };

  const idx = {
    domain_id: findIdx(p.domain_id),
    domain_name: findIdx(p.domain_name),

    e2_id: findIdx(p.e2_id),
    e2_name: findIdx(p.e2_name),
    e2_parent: findIdx(p.e2_parent),

    e3_id: findIdx(p.e3_id),
    e3_name: findIdx(p.e3_name),
    e3_parent: findIdx(p.e3_parent),

    e4_id: findIdx(p.e4_id),
    e4_name: findIdx(p.e4_name),
    e4_parent: findIdx(p.e4_parent)
  };

  console.log("[Sunburst] Matched layered indexes:", idx);

  // --------- NEW: adjacency-mode (single table level_id, level_name|name, optional parent_id) ---------
  const adjacencyIdx = {
    level_id: findIdx([/^level[_\s]?id$/i, /\.level[_\s]?id$/i, /^id$/i, /\.id$/i]),
    level_name: findIdx([/^level[_\s]?name$/i, /\.level[_\s]?name$/i, /^name$/i]),
    parent_id: findIdx([/^parent[_\s]?id$/i, /\.parent[_\s]?id$/i])
  };
  console.log("[Sunburst] Adjacency check:", adjacencyIdx);

  if (adjacencyIdx.level_name !== -1) {
    type NodeRec = { id: number; name: string; parent: number | null };
    const nodes: NodeRec[] = [];

    let autoId = 1;
    const colHasLevelId = adjacencyIdx.level_id !== -1;
    const colHasParentId = adjacencyIdx.parent_id !== -1;

    // Build node list (id may be synthesized; parent may be null)
    for (const row of t.rows) {
      const name = toStr(row[adjacencyIdx.level_name]);
      if (name == null) continue;

      const id = colHasLevelId ? toNum(row[adjacencyIdx.level_id]) ?? (autoId++) : (autoId++);
      const parent = colHasParentId ? toNum(row[adjacencyIdx.parent_id]) : null;

      nodes.push({ id, name, parent });
    }

    // children index
    const childrenByParent = new Map<number | null, number[]>();
    for (const n of nodes) {
      const pId = n.parent ?? null; // domains may have no parent_id → root
      const arr = childrenByParent.get(pId) ?? [];
      arr.push(n.id);
      childrenByParent.set(pId, arr);
    }

    // roots: parent null/0 or not pointing to any existing id
    const idSet = new Set(nodes.map(n => n.id));
    const roots = nodes.filter(n => n.parent == null || n.parent === 0 || !idSet.has(n.parent));
    console.log("[Sunburst] Adjacency roots:", roots.length);

    // depth BFS
    const parentById = new Map<number, number | null>();
    for (const n of nodes) parentById.set(n.id, n.parent ?? null);

    const depthById = new Map<number, number>();
    const q: number[] = [];
    for (const r of roots) { depthById.set(r.id, 1); q.push(r.id); }
    while (q.length) {
      const cur = q.shift()!;
      const dcur = depthById.get(cur)!;
      for (const k of (childrenByParent.get(cur) ?? [])) {
        if (!depthById.has(k)) { depthById.set(k, dcur + 1); q.push(k); }
      }
    }

    function ancestorAtDepth(id: number, targetDepth: number): number | null {
      let cur: number | null | undefined = id, guard = 0;
      while (cur != null && guard++ < 5000) {
        const d = depthById.get(cur);
        if (d === targetDepth) return cur;
        cur = parentById.get(cur) ?? null;
      }
      return null;
    }

    // Map to Raw: depth 1→domain, 2→ebene2, 3→ebene3, ≥4→ebene4 (clamped under nearest depth-3 ancestor)
    const domains = new Map<number, Domain>();
    const e2 = new Map<number, Ebene2>();
    const e3 = new Map<number, Ebene3>();
    const e4 = new Map<number, Ebene4>();

    for (const n of nodes) {
      const d = depthById.get(n.id) ?? 1;
      if (d <= 1) {
        if (!domains.has(n.id)) domains.set(n.id, { domain_id: n.id, domain_name: n.name });
      } else if (d === 2) {
        const p1 = ancestorAtDepth(n.id, 1);
        if (p1 != null && !e2.has(n.id)) e2.set(n.id, { level_id: n.id, level_name: n.name, parent_id: p1 });
      } else if (d === 3) {
        const p2 = ancestorAtDepth(n.id, 2);
        if (p2 != null && !e3.has(n.id)) e3.set(n.id, { level_id: n.id, level_name: n.name, parent_id: p2 });
      } else {
        const p3 = ancestorAtDepth(n.id, 3) ?? ancestorAtDepth(n.id, 2) ?? ancestorAtDepth(n.id, 1);
        if (p3 != null && !e4.has(n.id)) e4.set(n.id, { level_id: n.id, level_name: n.name, parent_id: p3 });
      }
    }

    const resultAdj: Raw = {
      domains: Array.from(domains.values()),
      ebene2: Array.from(e2.values()),
      ebene3: Array.from(e3.values()),
      ebene4: Array.from(e4.values())
    };

    console.log("[Sunburst] Adjacency→Raw", {
      nodes: nodes.length,
      roots: roots.length,
      outSizes: {
        domains: resultAdj.domains.length,
        ebene2: resultAdj.ebene2.length,
        ebene3: resultAdj.ebene3.length,
        ebene4: resultAdj.ebene4.length
      }
    });

    return resultAdj; // short-circuit: adjacency handled
  }

  // --------- Layered-table path (your original multi-table layout) ---------
  const domains = new Map<number, Domain>();
  const e2 = new Map<number, Ebene2>();
  const e3 = new Map<number, Ebene3>();
  const e4 = new Map<number, Ebene4>();

  let processed = 0;

  // If only domain_name present, synthesize ids so we still render ring 1
  const synthDomainIds = (idx.domain_id === -1) && (idx.domain_name !== -1);
  let domainAutoId = 1;

  for (let rowIndex = 0; rowIndex < t.rows.length; rowIndex++) {
    const row = t.rows[rowIndex];
    processed++;

    // Domains
    if (idx.domain_name !== -1) {
      const name = toStr(row[idx.domain_name]);
      if (name != null) {
        let id: number | null = null;
        if (!synthDomainIds && idx.domain_id !== -1) {
          id = toNum(row[idx.domain_id]);
        } else {
          id = domainAutoId++;
        }
        if (id != null && !domains.has(id)) {
          domains.set(id, { domain_id: id, domain_name: name });
        }
      }
    }

    // Ebene 2
    if (idx.e2_id !== -1 && idx.e2_name !== -1 && idx.e2_parent !== -1) {
      const id = toNum(row[idx.e2_id]);
      const name = toStr(row[idx.e2_name]);
      const parent = toNum(row[idx.e2_parent]);
      if (id != null && name != null && parent != null && !e2.has(id)) {
        e2.set(id, { level_id: id, level_name: name, parent_id: parent });
      }
    }

    // Ebene 3
    if (idx.e3_id !== -1 && idx.e3_name !== -1 && idx.e3_parent !== -1) {
      const id = toNum(row[idx.e3_id]);
      const name = toStr(row[idx.e3_name]);
      const parent = toNum(row[idx.e3_parent]);
      if (id != null && name != null && parent != null && !e3.has(id)) {
        e3.set(id, { level_id: id, level_name: name, parent_id: parent });
      }
    }

    // Ebene 4
    if (idx.e4_id !== -1 && idx.e4_name !== -1 && idx.e4_parent !== -1) {
      const id = toNum(row[idx.e4_id]);
      const name = toStr(row[idx.e4_name]);
      const parent = toNum(row[idx.e4_parent]);
      if (id != null && name != null && parent != null && !e4.has(id)) {
        e4.set(id, { level_id: id, level_name: name, parent_id: parent });
      }
    }
  }

  const resultLayered: Raw = {
    domains: Array.from(domains.values()),
    ebene2: Array.from(e2.values()),
    ebene3: Array.from(e3.values()),
    ebene4: Array.from(e4.values())
  };

  console.log("[Sunburst] Layered extract finished", {
    inputRows: t.rows.length,
    processed,
    outSizes: {
      domains: resultLayered.domains.length,
      ebene2: resultLayered.ebene2.length,
      ebene3: resultLayered.ebene3.length,
      ebene4: resultLayered.ebene4.length
    }
  });

  if (resultLayered.domains.length === 0 && idx.domain_name === -1) {
    console.warn("[Sunburst] No top-level nodes found. Provide either adjacency columns (level_id/level_name[/parent_id]) or domain_id/domain_name.");
  }

  return resultLayered;
}

// -------------------------------------------
// 2) Visual class (rendering & interactions)
// -------------------------------------------
export class Visual implements IVisual {
  private rootEl: HTMLElement;
  private visEl: HTMLElement;
  private tooltipEl: HTMLElement;
  private crumbsEl: HTMLElement;
  private legendEl: HTMLElement;
  private debugEl: HTMLElement;

  // D3 handles
  private svg!: d3.Selection<SVGSVGElement, unknown, null, undefined>;
  private g!: d3.Selection<SVGGElement, unknown, null, undefined>;
  private path!: d3.Selection<SVGPathElement, SunburstNode, SVGGElement, unknown>;
  private label!: d3.Selection<SVGTextElement, SunburstNode, SVGGElement, unknown>;

  // Layout state
  private layoutRoot!: SunburstNode;
  private nodesList!: SunburstNode[];

  // Global Scale for textsize on arcs
  private baseR?: number;
  private globalScale: number = 1;

  private fontSizeOption: number = 12;

  constructor(options: VisualConstructorOptions) {
    this.rootEl = options.element;

    console.log("[Sunburst] constructor");

    // Container structure
    this.rootEl.classList.add("sunburst-root");

    // Controls row (crumbs + legend)
    const controls = document.createElement("div");
    controls.className = "sb-controls";
    this.rootEl.appendChild(controls);

    this.crumbsEl = document.createElement("div");
    this.crumbsEl.className = "sb-crumbs";
    controls.appendChild(this.crumbsEl);

    this.legendEl = document.createElement("div");
    this.legendEl.className = "sb-legend";
    controls.appendChild(this.legendEl);

    // Visualization container
    this.visEl = document.createElement("div");
    this.visEl.className = "sb-vis";
    this.visEl.setAttribute("role", "img");
    this.visEl.setAttribute("aria-label", "Sunburst partition - Stadt Wien");
    this.rootEl.appendChild(this.visEl);

    // Tooltip
    this.tooltipEl = document.createElement("div");
    this.tooltipEl.className = "sb-tooltip";
    this.tooltipEl.style.position = "absolute";
    this.tooltipEl.style.pointerEvents = "none";
    this.tooltipEl.style.opacity = "0";
    this.rootEl.appendChild(this.tooltipEl);

    // Debug banner
    this.debugEl = document.createElement("div");
    this.debugEl.style.position = "absolute";
    this.debugEl.style.right = "8px";
    this.debugEl.style.bottom = "8px";
    this.debugEl.style.padding = "4px 6px";
    this.debugEl.style.fontSize = "11px";
    this.debugEl.style.borderRadius = "4px";
    this.debugEl.style.background = "rgba(255, 196, 0, 0.15)";
    this.debugEl.style.color = "#6b4f00";
    this.debugEl.style.display = "none";
    this.rootEl.appendChild(this.debugEl);

    // Minimal inline styles
    const style = document.createElement("style");
    style.textContent = `
      .sunburst-root { position: relative; font-family: "Segoe UI", system-ui, -apple-system, sans-serif; }
      .sb-controls { display:flex; justify-content:space-between; align-items:center; gap:16px; margin-bottom:8px; flex-wrap:wrap; }
      .sb-crumbs { font-size:12px; user-select:none; }
      .sb-crumbs .sep { margin: 0 6px; color:#64748b; }
      .sb-crumbs a { text-decoration:none; color:#2563eb; }
      .sb-legend { display:flex; gap:12px; flex-wrap:wrap; font-size:12px; }
      .sb-legend .key { display:flex; align-items:center; gap:6px; }
      .sb-legend .swatch { display:inline-block; width:12px; height:12px; border-radius:2px; box-shadow: inset 0 0 0 1px rgba(0,0,0,.15); }
      .sb-vis { width:100%; height:100%; position:relative; }
      .sb-tooltip { background:#111827; color:#f9fafb; padding:6px 8px; border-radius:6px; font-size:12px; box-shadow:0 2px 8px rgba(0,0,0,.25); }
      svg text { paint-order: stroke; stroke: #fff; stroke-width: 0px; stroke-linejoin: round; }
    `;
    this.rootEl.appendChild(style);

    // Init once
    this.initChart();
  }

  private initChart(): void {
    console.log("[Sunburst] initChart");
    this.svg = d3
      .select(this.visEl)
      .append("svg")
      .attr("role", "img");

    this.g = this.svg.append("g");
  }

  public update(options: VisualUpdateOptions): void {
    try {
      console.log("[Sunburst] update called", {
        viewport: options.viewport,
        dataViews: options.dataViews?.length ?? 0
      });

      const width = Math.max(0, options.viewport.width);
      const height = Math.max(0, options.viewport.height);

      const W = width;
      const H = height;
      let R = Math.max(10, Math.min(W, H) / 2 - 6);

      if (this.baseR == null) this.baseR = R;
      R *= 1;
      this.globalScale = R / this.baseR;

      this.svg.attr("width", W).attr("height", H).attr("viewBox", [-W / 2, -H / 2, W, H].join(" "));
      console.log("[Sunburst] viewport + radius", { W, H, R, globalScale: this.globalScale });

      // -----------------------------
      // Read from Power BI table → Raw → your buildHierarchy
      // -----------------------------
      const dv = options.dataViews?.[0];
      if (!dv) {
        console.warn("[Sunburst] No dataView provided");
      }

      let raw: Raw = { domains: [], ebene2: [], ebene3: [], ebene4: [] };
      if (dv) raw = extractRawFromTable(dv);

      const data: NodeData = buildHierarchy(raw);

      // Build hierarchy & partition
      const root = d3
        .hierarchy<NodeData>(data)
        .sum((d) => d.value ?? 0)
        .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

      const partition = d3.partition<NodeData>().size([2 * Math.PI, R]);

      const layoutRoot = partition(root) as SunburstNode;
      const nodesList = layoutRoot.descendants().filter((d) => d.depth > 0) as SunburstNode[];

      this.layoutRoot = layoutRoot;
      this.nodesList = nodesList;

      console.log("[Sunburst] layout summary", {
        height: layoutRoot.height,
        depth: layoutRoot.depth,
        nodeCount: nodesList.length
      });

      if (nodesList.length === 0) {
        this.debugEl.textContent =
          "No nodes to display. Drop columns like: level_id, level_name (name), parent_id OR domain_id/domain_name (+ e2/e3/e4).";
        this.debugEl.style.display = "block";
      } else {
        this.debugEl.style.display = "none";
      }

      // Color by top-level ancestor
      const color = d3.scaleOrdinal<string, string>(d3.schemeTableau10);

      const topAncestor = (d: SunburstNode): SunburstNode => {
        if (d.depth === 1) return d;
        const found = d.ancestors().find((a) => a.depth === 1) as SunburstNode | undefined;
        return found ?? d;
      };

      const getFill = (d: SunburstNode): string => {
        const base = color(topAncestor(d).data.name);
        const maxDepth = layoutRoot.height;
        const t = Math.max(0, Math.min(1, (d.depth - 1) / Math.max(maxDepth - 1, 1)));
        return d3.interpolateLab(base, "#f8fafc")(t * 0.85);
      };

      // Arc generator
      const arc = d3
        .arc<ArcDatum>()
        .startAngle((d) => d.x0)
        .endAngle((d) => d.x1)
        .padAngle((d) => Math.min((d.x1 - d.x0) / 2, 0.003))
        .padRadius(R)
        .innerRadius((d) => d.y0)
        .outerRadius((d) => Math.max(d.y0, d.y1 - 1));

      // Paths
      const that = this;
      this.path = this.g
        .selectAll<SVGPathElement, SunburstNode>("path")
        .data(nodesList, (d: any) => d.data.name + "|" + d.depth)
        .join(
          (enter) =>
            enter
              .append("path")
              .attr("fill", (d) => getFill(d))
              .attr("d", (d) => arc((d as any) as ArcDatum)!)
              .attr("stroke", "#fff")
              .attr("stroke-width", 1)
              .style("cursor", "pointer")
              .on("click", function (_event: MouseEvent, d: SunburstNode) {
                that.zoomTo(d, arc);
              })
              .on("mousemove", (event: MouseEvent, d: SunburstNode) => {
                const seq = this.safeAncestors(d).map((n) => n.data.name).join(" › ");
                this.tooltipEl.style.opacity = "0.96";
                this.tooltipEl.textContent = `${seq} (Elemente: ${Math.round(d.value ?? 0)})`;
                const rect = this.rootEl.getBoundingClientRect();
                const x = event.clientX - rect.left;
                const y = event.clientY - rect.top;
                this.tooltipEl.style.left = `${x + 8}px`;
                this.tooltipEl.style.top = `${y + 8}px`;
              })
              .on("mouseleave", () => {
                this.tooltipEl.style.opacity = "0";
              }),
          (update) =>
            update
              .attr("fill", (d) => getFill(d))
              .attr("d", (d) => arc((d as any) as ArcDatum)!),
          (exit) => exit.remove()
        );

      // Labels
      this.label = this.g
        .selectAll<SVGTextElement, SunburstNode>("text")
        .data(nodesList, (d: any) => d.data.name + "|" + d.depth)
        .join(
          (enter) =>
            enter
              .append("text")
              .attr("dy", "0.32em")
              .attr("fill", "#0f172a")
              .attr("font-size", (d: any) => (this.fontSizeOption == 1) ? this.scaleFontSizeForEach(d) : this.scaleFontSizeForEverything(d))
              .attr("font-weight", 600 as any)
              .attr("text-anchor", "middle")
              .style("user-select", "none")
              .style("visibility", (d) => (this.labelVisible((d as any) as ArcDatum) ? "visible" : "hidden"))
              .attr("transform", (d) => this.labelTransform((d as any) as ArcDatum))
              .text((d) => (this.fontSizeOption == 1) ? d.data.name : this.truncatedText(d)),
          (update) =>
            update
              .style("visibility", (d) => (this.labelVisible((d as any) as ArcDatum) ? "visible" : "hidden"))
              .attr("transform", (d) => this.labelTransform((d as any) as ArcDatum))
              .text((d) => (this.fontSizeOption == 1) ? d.data.name : this.truncatedText(d)),
          (exit) => exit.remove()
        );

      // Legend + crumbs
      this.updateLegend(color);
      this.updateCrumbs(layoutRoot, arc);

      this.zoomTo(layoutRoot, arc, 0);
    } catch (err) {
      console.error("[Sunburst] update error", err);
      this.debugEl.textContent = "Error in update() — see console for details.";
      this.debugEl.style.display = "block";
    }
  }

  // ------------- Helpers -------------

  private labelVisible(d: ArcDatum): boolean {
    const a = d.x1 - d.x0;
    const r = d.y1 - d.y0;
    return a > 0.03 && r > 12;
  }

  private scaleFontSizeForEach(d: any): number {
    const base = 10;
    const referenceWordSize = 11;
    const nameLen = Math.max(1, d?.data?.name?.length || 1);

    const lengthScale = referenceWordSize / nameLen;
    let size = base * lengthScale;

    const raw = d.x1 - d.x0;
    const pad = Math.min(raw / 2, 0.003);
    const effective = Math.max(0, raw - 2 * pad);
    const deg = (effective * 180) / Math.PI;

    if (nameLen < referenceWordSize && deg <= 5) {
      const angleFactor = deg / 5;
      size *= angleFactor;
    }

    size *= this.globalScale;

    return size;
  }

  private truncatedText(d: any): string {
    const length = 8;
    if (d.data.name.length <= length) return d.data.name;
    const myTruncatedString = `${d.data.name.substring(0, length)}...`;
    return myTruncatedString;
  }

  private scaleFontSizeForEverything(_d: any): number {
    const base = 10;
    return base * this.globalScale;
  }

  private labelTransform(d: ArcDatum): string {
    const x = ((d.x0 + d.x1) / 2) * (180 / Math.PI);
    const y = (d.y0 + d.y1) / 2;
    return `rotate(${x - 90}) translate(${y},0) rotate(${x < 180 ? 0 : 180})`;
  }

  private safeAncestors(n: SunburstNode | null | undefined): SunburstNode[] {
    if (n && typeof (n as any).ancestors === "function") {
      return (n.ancestors() as SunburstNode[]).reverse();
    }
    return [this.layoutRoot];
  }

  private updateLegend(color: d3.ScaleOrdinal<string, string>): void {
    const topLevel = (this.layoutRoot.children ?? []) as SunburstNode[];
    const legendSel = d3.select(this.legendEl);
    legendSel.selectAll("*").remove();
    legendSel
      .selectAll<HTMLDivElement, SunburstNode>("div.key")
      .data(topLevel, (d: any) => d.data.name)
      .join("div")
      .attr("class", "key")
      .html((d) => {
        const swatch = `<span class="swatch" style="background:${color(d.data.name)}"></span>`;
        return `${swatch}${d.data.name}`;
      });
  }

  private updateCrumbs(focus: SunburstNode, arc: d3.Arc<any, ArcDatum>): void {
    const seq = this.safeAncestors(focus).map((x) => x.data.name);
    this.crumbsEl.innerHTML = seq
      .map((name, i) => (i === seq.length - 1 ? `<strong>${name}</strong>` : `<a href="#" data-depth="${i}">${name}</a>`))
      .join('<span class="sep">›</span>');

    this.crumbsEl.querySelectorAll<HTMLAnchorElement>("a").forEach((aEl) => {
      aEl.addEventListener(
        "click",
        (e) => {
          e.preventDefault();
          const depth = Number(aEl.getAttribute("data-depth"));
          const label = aEl.textContent ?? "";
          const target =
            depth === 0
              ? this.layoutRoot
              : this.nodesList.find((nn) => nn.depth === depth && nn.data.name === label) ?? this.layoutRoot;
          this.zoomTo(target, arc);
        },
        { once: true }
      );
    });
  }

  private zoomTo(p: SunburstNode, arc: d3.Arc<any, ArcDatum>, duration: number = 650): void {
    if (!p) return;

    this.tooltipEl.style.opacity = "0";
    this.updateCrumbs(p, arc);

    this.layoutRoot.each((d: SunburstNode) => {
      d.target = {
        x0: Math.max(0, Math.min(1, (d.x0 - p.x0) / (p.x1 - p.x0))) * 2 * Math.PI,
        x1: Math.max(0, Math.min(1, (d.x1 - p.x0) / (p.x1 - p.x0))) * 2 * Math.PI,
        y0: Math.max(0, d.y0 - p.y0),
        y1: Math.max(0, d.y1 - p.y0)
      };
    });

    const t = this.g.transition().duration(duration);

    this.path
      // @ts-ignore
      .transition(t)
      .tween("data", (d: SunburstNode) => {
        const i = d3.interpolate<ArcDatum>(
          d.current ?? { x0: d.x0, x1: d.x1, y0: d.y0, y1: d.y1 },
          d.target!
        );
        return (tt: number) => {
          d.current = i(tt);
        };
      })
      .attrTween("d", (d: SunburstNode) => () => arc(d.current!)!);

    this.label
      .filter((d: SunburstNode) => !!d.target && this.labelVisible(d.target))
      // @ts-ignore
      .transition(t)
      .style("visibility", "visible")
      .attrTween("transform", (d: SunburstNode) => () => this.labelTransform(d.current!));

    this.label
      .filter((d: SunburstNode) => !d.target || !this.labelVisible(d.target))
      // @ts-ignore
      .transition(t)
      .style("visibility", "hidden");
  }
}
