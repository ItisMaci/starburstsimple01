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
import DataViewCategoryColumn = powerbi.DataViewCategoryColumn;
import DataViewValueColumn = powerbi.DataViewValueColumn;

type ArcDatum = { x0: number; x1: number; y0: number; y1: number };

type NodeData = {
  name: string;
  value?: number;            // assigned on leaves; parents sum their children
  children?: NodeData[];
};

type SunburstNode = d3.HierarchyRectangularNode<NodeData> & {
  current?: ArcDatum;
  target?: ArcDatum;
};

const ROLE_ORDER = ["Level1", "Level2", "Level3", "Level4"] as const;

function isBlank(v: any): boolean {
  return v === null || v === undefined || (typeof v === "string" && v.trim() === "");
}

function toText(v: any): string {
  if (isBlank(v)) return "";
  return String(v);
}

//
// Build a hierarchy from the Power BI categorical DataView.
// Rules:
// - Use Level1..Level4 category roles (some may be missing, depending on drill).
// - For each row, find the deepest non-blank level. That node becomes the LEAF.
// - If a measure is bound to Value, add that numeric value to the leaf.
//   Otherwise, add 1 (default = count).
// - Blank/nulls are “stop points”: we do not create blank children.
//
function buildHierarchyFromDataView(dv: DataView): NodeData {
  const cat = dv.categorical;
  if (!cat) return { name: "root", children: [] };

  const roleCols: (DataViewCategoryColumn | null)[] = ROLE_ORDER.map((r) =>
    (cat.categories || []).find((c) => c.source?.roles && (c.source.roles as any)[r]) ?? null
  );

  // If nothing is bound, return empty
  if (roleCols.every((c) => !c)) return { name: "root", children: [] };

  const firstNonNull = roleCols.find((c) => !!c);
  const rowCount = firstNonNull?.values?.length ?? 0;

  const valueCol: DataViewValueColumn | null =
    (cat.values || []).find((v) => v.source?.roles && (v.source.roles as any)["Value"]) ?? null;

  // Build using Maps for fast de-duplication
  type BuildNode = { name: string; value: number; children?: Map<string, BuildNode> };
  const root: BuildNode = { name: "root", value: 0, children: new Map<string, BuildNode>() };

  const ensureChild = (parent: BuildNode, name: string): BuildNode => {
    if (!parent.children) parent.children = new Map();
    const key = name;
    const found = parent.children.get(key);
    if (found) return found;
    const nn: BuildNode = { name, value: 0, children: undefined };
    parent.children.set(key, nn);
    return nn;
  };

  for (let i = 0; i < rowCount; i++) {
    const labels = roleCols.map((c) => (c ? c.values[i] : null));
    const names = labels.map((v) => toText(v));
    const deepestIdx = (() => {
      for (let k = names.length - 1; k >= 0; k--) {
        if (!isBlank(names[k])) return k;
      }
      return -1;
    })();

    if (deepestIdx < 0) continue; // row with no Level1 — skip

    // measure or default 1
    let inc = 1;
    if (valueCol) {
      const n = Number(valueCol.values[i]);
      inc = isNaN(n) ? 0 : n;
    }
    if (inc === 0) continue;

    // Insert / accumulate along the path up to deepest non-blank
    let cur = root;
    for (let lvl = 0; lvl <= deepestIdx; lvl++) {
      const name = names[lvl];
      if (isBlank(name)) break; // stop point
      cur = ensureChild(cur, name);
    }
    // Leaf accumulation
    cur.value += inc;
  }

  // Convert to NodeData (children arrays) and let d3.sum handle parent totals
  const convert = (bn: BuildNode): NodeData => {
    if (!bn.children || bn.children.size === 0) {
      return { name: bn.name, value: bn.value };
    }
    const kids = Array.from(bn.children.values()).map(convert);
    // if all children ended up with 0 (possible if all measures were 0), still keep the node
    return { name: bn.name, children: kids };
  };

  // root is synthetic
  const children = root.children ? Array.from(root.children.values()).map(convert) : [];
  return { name: "root", children };
}

export class Visual implements IVisual {
  private rootEl: HTMLElement;
  private visEl: HTMLElement;
  private tooltipEl: HTMLElement;
  private crumbsEl: HTMLElement;
  private legendEl: HTMLElement;

  private svg!: d3.Selection<SVGSVGElement, unknown, null, undefined>;
  private g!: d3.Selection<SVGGElement, unknown, null, undefined>;
  private path!: d3.Selection<SVGPathElement, SunburstNode, SVGGElement, unknown>;
  private label!: d3.Selection<SVGTextElement, SunburstNode, SVGGElement, unknown>;

  private layoutRoot!: SunburstNode;
  private nodesList!: SunburstNode[];

  private baseR?: number;
  private globalScale: number = 1;
  private fontSizeOption: number = 12;

  constructor(options: VisualConstructorOptions) {
    this.rootEl = options.element;

    this.rootEl.classList.add("sunburst-root");

    const controls = document.createElement("div");
    controls.className = "sb-controls";
    this.rootEl.appendChild(controls);

    this.crumbsEl = document.createElement("div");
    this.crumbsEl.className = "sb-crumbs";
    controls.appendChild(this.crumbsEl);

    this.legendEl = document.createElement("div");
    this.legendEl.className = "sb-legend";
    controls.appendChild(this.legendEl);

    this.visEl = document.createElement("div");
    this.visEl.className = "sb-vis";
    this.visEl.setAttribute("role", "img");
    this.visEl.setAttribute("aria-label", "Sunburst partition");
    this.rootEl.appendChild(this.visEl);

    this.tooltipEl = document.createElement("div");
    this.tooltipEl.className = "sb-tooltip";
    this.tooltipEl.style.position = "absolute";
    this.tooltipEl.style.pointerEvents = "none";
    this.tooltipEl.style.opacity = "0";
    this.rootEl.appendChild(this.tooltipEl);

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

    this.initChart();
  }

  private initChart(): void {
    this.svg = d3
      .select(this.visEl)
      .append("svg")
      .attr("role", "img");

    this.g = this.svg.append("g");
  }

  public update(options: VisualUpdateOptions): void {
    const width = Math.max(0, options.viewport.width);
    const height = Math.max(0, options.viewport.height);

    const W = width;
    const H = height;
    let R = Math.max(10, Math.min(W, H) / 2 - 6);

    if (this.baseR == null) this.baseR = R;
    R *= 1;
    this.globalScale = R / this.baseR;

    this.svg.attr("width", W).attr("height", H).attr("viewBox", [-W / 2, -H / 2, W, H].join(" "));

    const dv = options.dataViews && options.dataViews[0];
    const data: NodeData = dv ? buildHierarchyFromDataView(dv) : { name: "root", children: [] };

    // If no data, clear
    if (!data.children || data.children.length === 0) {
      this.g.selectAll("*").remove();
      this.updateLegend(d3.scaleOrdinal<string, string>(d3.schemeTableau10));
      this.crumbsEl.innerHTML = "<strong>—</strong>";
      return;
    }

    const root = d3
      .hierarchy<NodeData>(data)
      .sum((d) => d.value ?? 0)
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

    const partition = d3.partition<NodeData>().size([2 * Math.PI, R]);

    const layoutRoot = partition(root) as SunburstNode;
    const nodesList = layoutRoot.descendants().filter((d) => d.depth > 0) as SunburstNode[];

    this.layoutRoot = layoutRoot;
    this.nodesList = nodesList;

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

    const arc = d3
      .arc<ArcDatum>()
      .startAngle((d) => d.x0)
      .endAngle((d) => d.x1)
      .padAngle((d) => Math.min((d.x1 - d.x0) / 2, 0.003))
      .padRadius(R)
      .innerRadius((d) => d.y0)
      .outerRadius((d) => Math.max(d.y0, d.y1 - 1));

    const that = this;
    this.path = this.g
      .selectAll<SVGPathElement, SunburstNode>("path")
      .data(nodesList, (d: any) => d.data.name + "|" + d.depth + "|" + d.parent?.data.name)
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
              const seq = that.safeAncestors(d).map((n) => n.data.name).slice(1).join(" › "); // drop synthetic root
              that.tooltipEl.style.opacity = "0.96";
              const val = Math.round((d.value ?? 0) * 100) / 100;
              that.tooltipEl.textContent = `${seq} (${val})`;
              const rect = that.rootEl.getBoundingClientRect();
              const x = event.clientX - rect.left;
              const y = event.clientY - rect.top;
              that.tooltipEl.style.left = `${x + 8}px`;
              that.tooltipEl.style.top = `${y + 8}px`;
            })
            .on("mouseleave", () => {
              that.tooltipEl.style.opacity = "0";
            }),
        (update) =>
          update
            .attr("fill", (d) => getFill(d))
            .attr("d", (d) => arc((d as any) as ArcDatum)!),
        (exit) => exit.remove()
      );

    this.label = this.g
      .selectAll<SVGTextElement, SunburstNode>("text")
      .data(nodesList, (d: any) => d.data.name + "|" + d.depth + "|" + d.parent?.data.name)
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

    this.updateLegend(color);
    this.updateCrumbs(layoutRoot, arc);
    this.zoomTo(layoutRoot, arc, 0);
  }

  // ---------------- helpers ----------------

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
    return `${d.data.name.substring(0, length)}...`;
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
    // drop synthetic root label
    const humanSeq = seq.length > 0 && seq[0] === "root" ? seq.slice(1) : seq;
    this.crumbsEl.innerHTML =
      humanSeq.length === 0
        ? "<strong>—</strong>"
        : humanSeq
            .map((name, i) => (i === humanSeq.length - 1 ? `<strong>${name}</strong>` : `<a href="#" data-depth="${i + 1}">${name}</a>`))
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
