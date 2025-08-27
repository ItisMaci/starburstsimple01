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

"use strict";
import "./../style/visual.less";

import powerbi from "powerbi-visuals-api";
import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
import IVisual = powerbi.extensibility.visual.IVisual;
import DataView = powerbi.DataView;
import IVisualHost = powerbi.extensibility.IVisualHost;

import * as d3 from "d3";
type Selection<T extends d3.BaseType> = d3.Selection<T, any, any, any>;

interface HierarchyData {
  name: string;
  children?: HierarchyData[];
  value?: number;
  __meta?: { depth: number };
}

interface RawRow {
  [key: string]: any;
}

interface RawData {
  domains: RawRow[];
  ebene2: RawRow[];
  ebene3: RawRow[];
  ebene4: RawRow[];
}

export class Visual implements IVisual {
  private host: IVisualHost;

  private container: Selection<HTMLDivElement>;
  private header: Selection<HTMLDivElement>;
  private legend: Selection<HTMLDivElement>;
  private vis: Selection<HTMLDivElement>;
  private tooltip: Selection<HTMLDivElement>;
  private crumbs: Selection<HTMLDivElement>;

  private svg: Selection<SVGSVGElement>;
  private g: Selection<SVGGElement>;
  private pathsG: Selection<SVGGElement>;
  private labelsG: Selection<SVGGElement>;

  private width = 0;
  private height = 0;
  private radius = 0;

  private root: d3.HierarchyRectangularNode<HierarchyData> | null = null;
  private color: d3.ScaleOrdinal<string, string, never> | null = null;
  private arc: d3.Arc<any, any> | null = null;

  private nodes: d3.HierarchyRectangularNode<HierarchyData>[] = [];
  private path!: Selection<SVGPathElement>;
  private label!: Selection<SVGTextElement>;

  constructor(options: VisualConstructorOptions) {
    this.host = options.host;

    this.container = d3.select(options.element)
      .append("div")
      .style("position", "relative")
      .style("width", "100%")
      .style("height", "100%")
      .style("font-family", "system-ui, -apple-system, Segoe UI, Roboto, sans-serif")
      .style("background", "#fff")
      .style("color", "#0f172a");

    this.header = this.container.append("div")
      .style("padding", "8px 12px")
      .style("display", "flex")
      .style("align-items", "center")
      .style("gap", "8px")
      .style("border-bottom", "1px solid #e5e7eb");

    this.header.append("div")
      .style("font-weight", "800")
      .style("font-size", "14px")
      .text("Sunburst");

    this.legend = this.header.append("div")
      .style("display", "flex")
      .style("flex-wrap", "wrap")
      .style("gap", "8px")
      .style("margin-left", "auto");

    this.vis = this.container.append("div")
      .style("position", "absolute")
      .style("inset", "42px 0 32px 0")
      .style("display", "grid")
      .style("place-items", "center");

    this.svg = this.vis.append("svg")
      .attr("role", "img")
      .attr("aria-label", "Sunburst partition visualization")
      .style("display", "block")
      .style("width", "100%")
      .style("height", "100%");

    this.g = this.svg.append("g");
    this.pathsG = this.g.append("g");
    this.labelsG = this.g.append("g").attr("pointer-events", "none").attr("text-anchor", "middle");

    this.tooltip = this.vis.append("div")
      .style("position", "absolute")
      .style("pointer-events", "none")
      .style("opacity", "0")
      .style("transform", "translate(-50%, -120%)")
      .style("background", "#111")
      .style("color", "#fff")
      .style("font-size", "12px")
      .style("padding", "6px 8px")
      .style("border-radius", "6px")
      .style("box-shadow", "0 6px 18px rgba(0,0,0,.2)");

    this.vis.append("div")
      .style("position", "absolute")
      .style("width", "120px")
      .style("height", "120px")
      .style("border-radius", "999px")
      .style("display", "grid")
      .style("place-items", "center")
      .style("font-size", "12px")
      .style("color", "#64748b")
      .style("pointer-events", "none")
      .style("text-align", "center")
      .style("white-space", "pre-line")
      .text("Click to zoom\nBack with breadcrumbs");

    this.crumbs = this.container.append("div")
      .style("position", "absolute")
      .style("left", "0")
      .style("right", "0")
      .style("bottom", "0")
      .style("padding", "8px 12px")
      .style("font-size", "12px")
      .style("color", "#64748b")
      .style("border-top", "1px solid #e5e7eb");
  }

  private rawTableToObjects(table?: powerbi.DataViewTable): RawRow[] {
    if (!table || !table.columns || !table.rows) return [];
    const cols = table.columns.map(c => c.displayName.toLowerCase());
    return table.rows.map(row => {
      const obj: RawRow = {};
      row.forEach((v, i) => {
        obj[cols[i]] = v;
      });
      return obj;
    });
  }

  private buildHierarchy(raw: RawData): HierarchyData {
    const e4ByParent = new Map<any, RawRow[]>();
    raw.ebene4.forEach((n) => {
      const pid = n["parent_id"];
      if (!e4ByParent.has(pid)) e4ByParent.set(pid, []);
      e4ByParent.get(pid)!.push(n);
    });

    const e3ByParent = new Map<any, RawRow[]>();
    raw.ebene3.forEach((n) => {
      const pid = n["parent_id"];
      if (!e3ByParent.has(pid)) e3ByParent.set(pid, []);
      e3ByParent.get(pid)!.push(n);
    });

    const e2ByParent = new Map<any, RawRow[]>();
    raw.ebene2.forEach((n) => {
      const pid = n["parent_id"];
      if (!e2ByParent.has(pid)) e2ByParent.set(pid, []);
      e2ByParent.get(pid)!.push(n);
    });

    const domains = raw.domains.map(d => {
      const e2s = e2ByParent.get(d["domain_id"]) || [];
      const childrenLvl2 = e2s.map(l2 => {
        const e3s = e3ByParent.get(l2["level_id"]) || [];
        const childrenLvl3 = e3s.map(l3 => {
          const e4s = e4ByParent.get(l3["level_id"]) || [];
          const childrenLvl4 = e4s.map(l4 => ({
            name: l4["level_name"],
            value: 1,
            __meta: { depth: 4 },
          }));
          if (childrenLvl4.length === 0)
            return { name: l3["level_name"], value: 1, __meta: { depth: 3 } };
          return { name: l3["level_name"], children: childrenLvl4, __meta: { depth: 3 } };
        });
        if (childrenLvl3.length === 0)
          return { name: l2["level_name"], value: 1, __meta: { depth: 2 } };
        return { name: l2["level_name"], children: childrenLvl3, __meta: { depth: 2 } };
      });
      if (childrenLvl2.length === 0)
        return { name: d["domain_name"], value: 1, __meta: { depth: 1 } };
      return { name: d["domain_name"], children: childrenLvl2, __meta: { depth: 1 } };
    });

    return { name: "Wien", children: domains };
  }

  public update(options: VisualUpdateOptions): void {
    const dv = options.dataViews?.[0];
    if (!dv) {
      this.clear();
      return;
    }

    // Extract tables - adjust indices or roles per your capabilities.json config
    // Assuming tables come as separate dataViews (example)
    const tables = options.dataViews || [];

    let rawData: RawData = {
      domains: [],
      ebene2: [],
      ebene3: [],
      ebene4: [],
    };

    // Attempt extraction by table index or by table queryName / role name in your capabilities.json
    rawData.domains = this.rawTableToObjects(tables[0]?.table);
    rawData.ebene2 = this.rawTableToObjects(tables[1]?.table);
    rawData.ebene3 = this.rawTableToObjects(tables[2]?.table);
    rawData.ebene4 = this.rawTableToObjects(tables[3]?.table);

    // Build hierarchy from raw tables
    const data = this.buildHierarchy(rawData);

    // Compute dimensions
    const visRect = (this.vis.node() as HTMLDivElement).getBoundingClientRect();
    this.width = Math.max(0, visRect.width);
    this.height = Math.max(0, visRect.height);
    this.radius = Math.max(0, Math.min(this.width, this.height) / 2 - 10);

    this.svg
      .attr("viewBox", `${-this.width / 2} ${-this.height / 2} ${this.width} ${this.height}`)
      .attr("width", this.width)
      .attr("height", this.height);

    // Build d3 hierarchy and partition layout
    const hierarchy = d3.hierarchy<HierarchyData>(data)
      .sum((d) => (d.children && d.children.length ? 0 : d.value || 0))
      .sort((a, b) => (b.value || 0) - (a.value || 0));

    const partition = d3.partition<HierarchyData>().size([2 * Math.PI, this.radius]);
    const rootPartitioned = partition(hierarchy);
    this.root = rootPartitioned;

    this.root.each((d) => (d as any).current = { x0: d.x0, x1: d.x1, y0: d.y0, y1: d.y1 });

    if (!this.color) {
      this.color = d3.scaleOrdinal<string, string>().range(d3.schemeTableau10);
    }
    const topNames = (this.root.children ?? []).map((d) => d.data.name);
    (this.color as any).domain(topNames);

    this.arc = d3
      .arc<any>()
      .startAngle((d: any) => d.x0)
      .endAngle((d: any) => d.x1)
      .padAngle((d: any) => Math.min((d.x1 - d.x0) / 2, 0.003))
      .padRadius(this.radius)
      .innerRadius((d: any) => d.y0)
      .outerRadius((d: any) => Math.max(d.y0, d.y1 - 1));

    this.nodes = this.root.descendants().filter((d) => d.depth > 0);

    const pathKey = (n: d3.HierarchyRectangularNode<HierarchyData>) =>
      n.ancestors().map((a) => a.data.name).reverse().join("/");

    this.path = this.pathsG.selectAll<SVGPathElement, any>("path")
      .data(this.nodes, pathKey as any)
      .join(
        (enter) =>
          enter
            .append("path")
            .attr("fill", (d: any) => this.getFill(d))
            .attr("stroke", "#fff")
            .attr("stroke-width", 1)
            .style("cursor", "pointer")
            .attr("d", (d: any) => this.arc!((d as any).current))
            .on("click", (_event, d) => this.zoomTo(d))
            .on("mousemove", (event: MouseEvent, d) => {
              const seq = this.safeAncestors(d).map((n) => n.data.name).join(" › ");
              this.tooltip.style("opacity", "0.96");
              this.tooltip.text(`${seq} (Elements: ${Math.round(d.value || 0)})`);
              const svgRect = (this.vis.node() as HTMLDivElement).getBoundingClientRect();
              this.tooltip.style("left", event.clientX - svgRect.left + "px");
              this.tooltip.style("top", event.clientY - svgRect.top + "px");
            })
            .on("mouseleave", () => this.tooltip.style("opacity", "0")),
        (update) =>
          update.attr("fill", (d: any) => this.getFill(d)).attr("d", (d: any) => this.arc!((d as any).current)),
        (exit) => exit.remove()
      );

    this.label = this.labelsG.selectAll<SVGTextElement, any>("text")
      .data(this.nodes, pathKey as any)
      .join(
        (enter) =>
          enter
            .append("text")
            .attr("dy", "0.32em")
            .attr("fill", "#0f172a")
            .attr("font-size", 18)
            .attr("font-weight", 600)
            .style("user-select", "none")
            .style("visibility", (d: any) => (this.labelVisible((d as any).current) ? "visible" : "hidden"))
            .attr("transform", (d: any) => this.labelTransform((d as any).current))
            .text((d) => {
              const name = d.data.name;
              return name.length > 8 ? name.slice(0, 8) + "..." : name;
            }),
        (update) =>
          update
            .style("visibility", (d: any) => (this.labelVisible((d as any).current) ? "visible" : "hidden"))
            .attr("transform", (d: any) => this.labelTransform((d as any).current))
            .text((d) => {
              const name = d.data.name;
              return name.length > 8 ? name.slice(0, 8) + "..." : name;
            }),
        (exit) => exit.remove()
      );

    this.updateLegend();
    this.updateCrumbs(this.root);
  }

  private getFill(d: d3.HierarchyRectangularNode<HierarchyData>) {
    const topAncestor = (d: d3.HierarchyRectangularNode<HierarchyData>) =>
      d.depth === 1 ? d : d.ancestors().find((a) => a.depth === 1) || d;
    const base = this.color!(topAncestor(d).data.name);
    const maxDepth = this.root!.height;
    const t = Math.max(0, Math.min(1, (d.depth - 1) / (maxDepth - 1 || 1)));
    return d3.interpolateLab(base, "#f8fafc")(t * 0.85);
  }

  private labelVisible(d: any) {
    const a = d.x1 - d.x0;
    const r = d.y1 - d.y0;
    return a > 0.03 && r > 12;
  }

  private labelTransform(d: any) {
    const x = ((d.x0 + d.x1) / 2) * (180 / Math.PI);
    const y = (d.y0 + d.y1) / 2;
    return `rotate(${x - 90}) translate(${y},0) rotate(${x < 180 ? 0 : 180})`;
  }

  private safeAncestors(n: d3.HierarchyRectangularNode<HierarchyData>) {
    if (n && typeof n.ancestors === "function") return n.ancestors().reverse();
    return this.root ? [this.root] : [];
  }

  private updateLegend() {
    if (!this.root || !this.color) return;
    const topLevel = this.root.children || [];

    const item = this.legend.selectAll<HTMLDivElement, any>("div.key").data(topLevel, (d: any) => d.data.name);

    item.join(
      (enter) => {
        const row = enter.append("div").attr("class", "key");
        row.append("span").attr("class", "swatch");
        row.append("span").attr("class", "label");
        return row;
      },
      (update) => {
        update.select<HTMLSpanElement>("span.swatch").style("background", (d: any) => this.color!(d.data.name));
        update.select<HTMLSpanElement>("span.label").text((d: any) => d.data.name);
        return update;
      },
      (exit) => exit.remove()
    );
  }

  private updateCrumbs(n: d3.HierarchyRectangularNode<HierarchyData>) {
    if (!this.root) return;

    const ancestors = this.safeAncestors(n);
    const pathKey = (node: d3.HierarchyRectangularNode<HierarchyData>) =>
      node.ancestors().map((a) => a.data.name).reverse().join("/");

    const html = ancestors
      .map((node, i) => {
        const name = node.data.name;
        if (i === ancestors.length - 1) return `<strong>${name}</strong>`;
        return `<a href="#" data-key="${pathKey(node)}" style="color:#0ea5e9;text-decoration:none;">${name}</a>`;
      })
      .join(`<span style="opacity:.5;padding:0 6px;">›</span>`);

    this.crumbs.html(html);

    this.crumbs.selectAll<HTMLAnchorElement, any>("a").on("click", (event) => {
      event.preventDefault();
      const a = event.currentTarget as HTMLAnchorElement;
      const key = a.getAttribute("data-key")!;
      const target =
        this.nodes.find(
          (nn) => nn.ancestors().map((a) => a.data.name).reverse().join("/") === key
        ) || this.root!;
      this.zoomTo(target);
    });
  }

  private zoomTo(p: d3.HierarchyRectangularNode<HierarchyData> | null) {
    if (!p || !this.root || !this.arc) return;

    this.tooltip.style("opacity", "0");
    this.updateCrumbs(p);

    this.root.each((d: any) => {
      d.target = {
        x0: Math.max(0, Math.min(1, (d.x0 - p.x0) / (p.x1 - p.x0))) * 2 * Math.PI,
        x1: Math.max(0, Math.min(1, (d.x1 - p.x0) / (p.x1 - p.x0))) * 2 * Math.PI,
        y0: Math.max(0, d.y0 - p.y0),
        y1: Math.max(0, d.y1 - p.y0),
      };
    });

    const t = this.g.transition().duration(650);

    this.path
      .transition(t as any)
      .tween("data", function (d: any) {
        const i = d3.interpolate(d.current, d.target);
        return (tt: number) => (d.current = i(tt));
      })
      .attrTween("d", (d: any) => () => this.arc!(d.current));

    this.label
      .transition(t as any)
      .style("visibility", (d: any) => (this.labelVisible(d.target) ? "visible" : "hidden"))
      .attrTween("transform", (d: any) => () => this.labelTransform(d.current));
  }

  private clear() {
    this.pathsG.selectAll("*").remove();
    this.labelsG.selectAll("*").remove();
    this.legend.html("");
    this.crumbs.html("");
    this.tooltip.style("opacity", "0");
    this.root = null;
  }

  public destroy(): void {
    // No-op
  }
}
