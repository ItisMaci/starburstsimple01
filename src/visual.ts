/*
*  Power BI Visual CLI
*
*  Copyright (c) Microsoft Corporation
*  All rights reserved.
*  MIT License
*
*  Permission is hereby granted, free of charge, to any person obtaining a copy
*  of this software and associated documentation files (the ""Software""), to deal
*  in the Software without restriction, including without limitation the rights
*  to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
*  copies of the Software, and to permit persons to whom the Software is
*  furnished to do so, subject to the following conditions:
*
*  The above copyright notice and this permission notice shall be included in
*  all copies or substantial portions of the Software.
*
*  THE SOFTWARE IS PROVIDED *AS IS*, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
*  IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
*  FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
*  AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
*  LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
*  OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
*  THE SOFTWARE.
*/

// src/visual.ts
// visual.ts
// Power BI Custom Visual: Sunburst (D3)
// ------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* eslint-disable @typescript-eslint/ban-ts-comment */

"use strict";

import "./../style/visual.less";

import * as d3 from "d3";
import powerbi from "powerbi-visuals-api";

import IVisual = powerbi.extensibility.visual.IVisual;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
import DataView = powerbi.DataView;

// -----------------------------
// Types for sunburst data
// -----------------------------
type NodeMeta = { depth: number; key?: string | number };

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
// Flat→Tree builder (arbitrary depth)
// -----------------------------
type Keyish = string | number;
type Maybe<T> = T | null | undefined;

type FlatRow = {
  levelNames: (Maybe<string>)[];
  levelKeys?: (Maybe<Keyish>)[];
  measure?: number;
};

function buildHierarchyFromFlat(rows: FlatRow[], maxDepth: number): NodeData {
  const root: NodeData = { name: "Wien", children: [] };
  const mapsPerDepth: Map<string, NodeData>[] = Array.from(
    { length: maxDepth },
    () => new Map<string, NodeData>()
  );

  for (const r of rows) {
    let parent = root;
    let pathKey = "";

    for (let d = 0; d < maxDepth; d++) {
      const name = r.levelNames[d];
      if (!name) break;

      const keyPart =
        (r.levelKeys && r.levelKeys[d] != null ? String(r.levelKeys[d]) : name).trim();

      pathKey = pathKey ? `${pathKey}¦${keyPart}` : keyPart;

      const map = mapsPerDepth[d];
      let node = map.get(pathKey);
      if (!node) {
        node = { name, children: [], __meta: { depth: d + 1 } };
        if (r.levelKeys && r.levelKeys[d] != null) node.__meta!.key = r.levelKeys[d]!;
        map.set(pathKey, node);
        (parent.children ??= []).push(node);
      }
      parent = node;
    }

    // accumulate value on leaf (default 1 per row)
    if (parent && (!parent.children || parent.children.length === 0)) {
      parent.value = (parent.value ?? 0) + (r.measure ?? 1);
    }
  }

  // ensure leaves have a value
  (function finalize(n: NodeData) {
    if (!n.children || n.children.length === 0) {
      if (n.value == null) n.value = 1;
      return;
    }
    for (const c of n.children) finalize(c);
  })(root);

  return root;
}

// -----------------------------
// Power BI data extraction
// -----------------------------
function colIndexesByRole(tableCols: powerbi.DataViewMetadataColumn[], role: string): number[] {
  const idx: number[] = [];
  tableCols.forEach((c, i) => {
    if (c && c.roles && (c.roles as any)[role]) idx.push(i);
  });
  return idx;
}

function toStr(v: any): string | null {
  if (v === null || v === undefined) return null;
  return String(v);
}
function toNum(v: any): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function buildRowsFromDataView(dv: DataView): { rows: FlatRow[]; maxDepth: number } {
  const out: FlatRow[] = [];

  // Prefer table: respects top→bottom field order as dropped by the user
  const table = dv.table;
  if (table?.rows?.length && table.columns?.length) {
    const nameIdx = colIndexesByRole(table.columns, "levelNames");
    const keyIdx  = colIndexesByRole(table.columns, "levelKeys");
    const measIdx = colIndexesByRole(table.columns, "measure");
    const maxDepth = nameIdx.length;

    for (const r of table.rows) {
      const levelNames = nameIdx.map(i => toStr(r[i]));
      const levelKeys  = keyIdx.length ? keyIdx.map(i => (r[i] as Keyish | null)) : undefined;
      const measure    = measIdx.length ? toNum(r[measIdx[0]]) : undefined;
      out.push({ levelNames, levelKeys, measure });
    }
    return { rows: out, maxDepth };
  }

  // Fallback: categorical (if needed)
  const cat = dv.categorical;
  if (cat?.categories?.length) {
    const nameCats = cat.categories.filter(c => (c.source?.roles as any)?.levelNames);
    const keyCats  = cat.categories.filter(c => (c.source?.roles as any)?.levelKeys);
    const measVals = cat.values?.filter(v => (v.source?.roles as any)?.measure) ?? [];
    const len = nameCats[0]?.values?.length ?? 0;
    const maxDepth = nameCats.length;

    for (let i = 0; i < len; i++) {
      const levelNames = nameCats.map(c => toStr(c.values[i]));
      const levelKeys  = keyCats.length ? keyCats.map(c => c.values[i] as Keyish | null) : undefined;
      const measure    = measVals.length ? toNum(measVals[0].values[i]) : undefined;
      out.push({ levelNames, levelKeys, measure });
    }
    return { rows: out, maxDepth };
  }

  return { rows: out, maxDepth: 0 };
}

// -------------------------------------------
// Visual class (rendering & interactions)
// -------------------------------------------
export class Visual implements IVisual {
  private rootEl: HTMLElement;
  private visEl: HTMLElement;
  private tooltipEl: HTMLElement;
  private crumbsEl: HTMLElement;
  private legendEl: HTMLElement;

  // D3 handles
  private svg!: d3.Selection<SVGSVGElement, unknown, null, undefined>;
  private g!: d3.Selection<SVGGElement, unknown, null, undefined>;
  private path!: d3.Selection<SVGPathElement, SunburstNode, SVGGElement, unknown>;
  private label!: d3.Selection<SVGTextElement, SunburstNode, SVGGElement, unknown>;

  // Layout state
  private layoutRoot!: SunburstNode;
  private nodesList!: SunburstNode[];

  // Global Scale for textsize on arcs
  private baseR?: number;      // captured on first render as your baseline
  private globalScale: number = 1;     // R / baseR

  private fontSizeOption: number = 12;

  constructor(options: VisualConstructorOptions) {
    this.rootEl = options.element;

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

    // Minimal inline styles (also see visual.less)
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
    // Create svg scaffolding once; sizes are set in update()
    this.svg = d3
      .select(this.visEl)
      .append("svg")
      .attr("role", "img");

    this.g = this.svg.append("g");
  }

  public update(options: VisualUpdateOptions): void {
    const width = Math.max(0, options.viewport.width);
    const height = Math.max(0, options.viewport.height);

    // Clear SVG dimensions and set new viewbox/size
    const W = width;
    const H = height;
    let R = Math.max(10, Math.min(W, H) / 2 - 6);

    // set base R and compute global scale relative to that baseline
    if (this.baseR == null) this.baseR = R;
    R *= 1;
    this.globalScale = R / this.baseR;

    // set width and height and viewbox
    this.svg.attr("width", W).attr("height", H).attr("viewBox", [-W / 2, -H / 2, W, H].join(" "));

    // -----------------------------
    // Build data from Power BI fields
    // -----------------------------
    const dv = options.dataViews?.[0];
    let data: NodeData = { name: "Wien", children: [] };

    if (dv) {
      const { rows, maxDepth } = buildRowsFromDataView(dv);
      if (rows.length && maxDepth > 0) {
        data = buildHierarchyFromFlat(rows, maxDepth);
      }
    }

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

    // Color by top-level ancestor
    const color = d3.scaleOrdinal<string, string>(d3.schemeTableau10);

    const topAncestor = (d: SunburstNode): SunburstNode => {
      if (d.depth === 1) return d;
      const found = d.ancestors().find((a) => a.depth === 1) as SunburstNode | undefined;
      return found ?? d;
    };

    const getFill = (d: SunburstNode): string => {
      const base = color(topAncestor(d).data.name);
      const maxDepth = layoutRoot.height; // excluding root
      const t = Math.max(0, Math.min(1, (d.depth - 1) / Math.max(maxDepth - 1, 1)));
      return d3.interpolateLab(base, "#f8fafc")(t * 0.85);
    };

    // Arc generator uses the current/target coords during transitions
    const arc = d3
      .arc<ArcDatum>()
      .startAngle((d) => d.x0)
      .endAngle((d) => d.x1)
      .padAngle((d) => Math.min((d.x1 - d.x0) / 2, 0.003))
      .padRadius(R)
      .innerRadius((d) => d.y0)
      .outerRadius((d) => Math.max(d.y0, d.y1 - 1));

    // BIND paths
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

    // LABELS
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

    // Initial "zoom" to root (no-op but sets current targets)
    this.zoomTo(layoutRoot, arc, 0);
  }

  // ------------- Helpers -------------

  private labelVisible(d: ArcDatum): boolean {
    const a = d.x1 - d.x0;
    const r = d.y1 - d.y0;
    return a > 0.03 && r > 12; // angular and radial room
  }

  private scaleFontSizeForEach(d: any): number {
    const base = 10;
    const referenceWordSize = 11;   // reference length
    const nameLen = Math.max(1, d?.data?.name?.length || 1);

    // word-length scaling (always applied)
    const lengthScale = referenceWordSize / nameLen;
    let size = base * lengthScale;

    // usable angular width in degrees
    const raw = d.x1 - d.x0;
    const pad = Math.min(raw / 2, 0.003);
    const effective = Math.max(0, raw - 2 * pad);   // radians
    const deg = effective * 180 / Math.PI;

    // if name shorter than reference AND angle <= 5°, apply angle factor
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
    const myTruncatedString = `${d.data.name.substring(0,length)}...`;
    return myTruncatedString;
  }

  private scaleFontSizeForEverything(_d: any): number {
    const base = 10;
    return base * this.globalScale;
  }

  private labelTransform(d: ArcDatum): string {
    const x = ((d.x0 + d.x1) / 2) * (180 / Math.PI); // degrees
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

    // make earlier crumbs clickable to jump back
    this.crumbsEl.querySelectorAll<HTMLAnchorElement>("a").forEach((aEl) => {
      aEl.addEventListener(
        "click",
        (e) => {
          e.preventDefault();
          const depth = Number(aEl.getAttribute("data-depth"));
          const label = aEl.textContent ?? "";
          // root is depth 0 (not in nodes), other depths match nodes
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

    // Hide tooltip
    this.tooltipEl.style.opacity = "0";

    // Update crumbs
    this.updateCrumbs(p, arc);

    // Compute target positions for all nodes
    this.layoutRoot.each((d: SunburstNode) => {
      d.target = {
        x0: Math.max(0, Math.min(1, (d.x0 - p.x0) / (p.x1 - p.x0))) * 2 * Math.PI,
        x1: Math.max(0, Math.min(1, (d.x1 - p.x0) / (p.x1 - p.x0))) * 2 * Math.PI,
        y0: Math.max(0, d.y0 - p.y0),
        y1: Math.max(0, d.y1 - p.y0)
      };
    });

    const t = this.g.transition().duration(duration);

    // Transition paths
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

    // Show/hide labels based on final position; animate transforms
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
