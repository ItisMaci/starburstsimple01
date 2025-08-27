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
"use strict";
import "./../style/visual.less";

import powerbi from "powerbi-visuals-api";
import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
import IVisual = powerbi.extensibility.visual.IVisual;
import DataView = powerbi.DataView;
import IVisualHost = powerbi.extensibility.IVisualHost;

import * as d3 from "d3";
type Sel<T extends d3.BaseType> = d3.Selection<T, any, any, any>;

interface TreeNode {
  name: string;
  children?: TreeNode[];
  value?: number;
  _map?: Map<string, TreeNode>; // internal helper
}

export class Visual implements IVisual {
  private host: IVisualHost;

  private rootEl: Sel<HTMLDivElement>;
  private legendEl: Sel<HTMLDivElement>;
  private crumbsEl: Sel<HTMLDivElement>;
  private tooltipEl: Sel<HTMLDivElement>;
  private svg: Sel<SVGSVGElement>;
  private g: Sel<SVGGElement>;

  private width = 0;
  private height = 0;
  private radius = 0;

  constructor(options: VisualConstructorOptions) {
    this.host = options.host;

    const root = d3.select(options.element)
      .append("div")
      .classed("circleSunburst", true)
      .style("width", "100%")
      .style("height", "100%")
      .style("position", "relative");

    this.legendEl = root.append("div").classed("legend", true);
    this.crumbsEl = root.append("div").classed("crumbs", true);
    this.tooltipEl = root.append("div").classed("tooltip", true);

    this.svg = root.append("svg").attr("role", "img");
    this.g = this.svg.append("g");

    root.append("div")
      .classed("centerReset", true)
      .text("Click to zoom\nBack with breadcrumbs");

    this.rootEl = root as Sel<HTMLDivElement>;
  }

  public update(options: VisualUpdateOptions): void {
    const dv: DataView | undefined = options.dataViews?.[0];
    const catCols = dv?.categorical?.categories ?? [];
    if (!catCols.length) {
      this.clear();
      return;
    }

    this.width = Math.max(1, options.viewport.width);
    this.height = Math.max(1, options.viewport.height);
    this.radius = Math.max(10, Math.min(this.width, this.height) / 2 - 8);

    this.svg
      .attr("width", this.width)
      .attr("height", this.height)
      .attr("viewBox", `${-this.width / 2} ${-this.height / 2} ${this.width} ${this.height}`);

    // ---- Build tree from categorical paths ----
    const rowCount = catCols[0].values.length;
    const getVal = (level: number, r: number) =>
      catCols[level]?.values?.[r] == null ? null : String(catCols[level].values[r]);

    const rootData: TreeNode = { name: "root", children: [], _map: new Map() };

    for (let r = 0; r < rowCount; r++) {
      const path: string[] = [];
      for (let l = 0; l < catCols.length; l++) {
        const v = getVal(l, r);
        if (v == null || v === "") break;
        path.push(v);
      }
      if (!path.length) continue;

      let cursor = rootData;
      for (const name of path) {
        cursor._map ??= new Map();
        let child = cursor._map.get(name);
        if (!child) {
          child = { name, children: [], _map: new Map() };
          cursor._map.set(name, child);
          cursor.children!.push(child);
        }
        cursor = child;
      }
      // leaf count = 1
      cursor.value = (cursor.value ?? 0) + 1;
    }

    // roll up values
    const rollup = (n: TreeNode): number => {
      if (n.children && n.children.length) {
        let s = 0;
        for (const c of n.children) s += rollup(c);
        n.value = s;
      }
      return n.value ?? 0;
    };
    rollup(rootData);

    // strip helper maps
    const strip = (n: TreeNode) => {
      delete n._map;
      n.children?.forEach(strip);
    };
    strip(rootData);

    // ---- D3 hierarchy + partition (capture rectangular node!) ----
    const rootH = d3.hierarchy<TreeNode>(rootData)
      .sum(d => d.value || 0)
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

    const partition = d3.partition<TreeNode>().size([2 * Math.PI, this.radius]);
    const root = partition(rootH); // HierarchyRectangularNode<TreeNode>

    const color = d3.scaleOrdinal(d3.schemeTableau10);
    const topAncestor = (d: d3.HierarchyRectangularNode<TreeNode>) =>
      d.depth === 1 ? d : (d.ancestors().find(a => a.depth === 1) || d);

    const getFill = (d: d3.HierarchyRectangularNode<TreeNode>) => {
      const base = color(topAncestor(d).data.name) as string;
      const maxDepth = root.height;
      const t = Math.max(0, Math.min(1, (d.depth - 1) / (maxDepth - 1 || 1)));
      return d3.interpolateLab(base, "#f8fafc")(t * 0.85);
    };

    const arc = d3.arc<d3.HierarchyRectangularNode<TreeNode>>()
      .startAngle(d => d.x0)
      .endAngle(d => d.x1)
      .padAngle(d => Math.min((d.x1 - d.x0) / 2, 0.003))
      .padRadius(this.radius)
      .innerRadius(d => d.y0)
      .outerRadius(d => Math.max(d.y0, d.y1 - 1));

    const nodes: d3.HierarchyRectangularNode<TreeNode>[] =
      root.descendants().filter(d => d.depth > 0);

    // ---- Paths ----
    const paths = this.g
      .selectAll<SVGPathElement, d3.HierarchyRectangularNode<TreeNode>>("path")
      .data(nodes, d => `${d.depth}|${d.data.name}`);

    paths.exit().remove();

    const pathsEnter = paths.enter()
      .append("path")
      .attr("stroke", "#fff")
      .attr("stroke-width", 1)
      .style("cursor", "pointer")
      .on("click", (_, d) => this.zoomTo(root, d, arc, labelsMerged, color, getFill))
      .on("mousemove", (ev, d) => this.showTooltip(ev as MouseEvent, d))
      .on("mouseleave", () => this.hideTooltip());

    const pathsAll = pathsEnter.merge(paths as any)
      .attr("fill", d => getFill(d))
      .attr("d", d => arc(d) as string);

    // ---- Labels ----
    const labels = this.g
      .selectAll<SVGTextElement, d3.HierarchyRectangularNode<TreeNode>>("text")
      .data(nodes, d => `${d.depth}|${d.data.name}`);

    labels.exit().remove();

    const labelsEnter = labels.enter()
      .append("text")
      .attr("dy", "0.32em")
      .attr("fill", "#0f172a")
      .attr("font-size", 12)
      .attr("font-weight", 600)
      .attr("text-anchor", "middle")
      .style("pointer-events", "none")
      .style("user-select", "none");

    const labelsMerged = labelsEnter.merge(labels as any)
      .text(d => {
        const name = d.data.name || "";
        return name.length > 12 ? name.slice(0, 12) + "…" : name;
      })
      .style("visibility", d => this.labelVisible(d) ? "visible" : "hidden")
      .attr("transform", d => this.labelTransform(d));

    // Legend (depth-1)
    this.updateLegend(root, color);

    // Breadcrumbs
    this.updateCrumbs(root, root, (target) =>
      this.zoomTo(root, target, arc, labelsMerged, color, getFill));

    // Background click → zoom to root
    this.svg.on("click", () =>
      this.zoomTo(root, root, arc, labelsMerged, color, getFill));
  }

  private zoomTo(
    root: d3.HierarchyRectangularNode<TreeNode>,
    p: d3.HierarchyRectangularNode<TreeNode>,
    arc: d3.Arc<any, d3.HierarchyRectangularNode<TreeNode>>,
    labelSel: Sel<SVGTextElement>,
    color: d3.ScaleOrdinal<string, string, never>,
    getFill: (d: d3.HierarchyRectangularNode<TreeNode>) => string
  ) {
    if (!p) return;
    this.hideTooltip();
    this.updateCrumbs(root, p, (target) => this.zoomTo(root, target, arc, labelSel, color, getFill));

    root.each((d: any) => d.target = {
      x0: Math.max(0, Math.min(1, (d.x0 - p.x0) / (p.x1 - p.x0))) * 2 * Math.PI,
      x1: Math.max(0, Math.min(1, (d.x1 - p.x0) / (p.x1 - p.x0))) * 2 * Math.PI,
      y0: Math.max(0, d.y0 - p.y0),
      y1: Math.max(0, d.y1 - p.y0)
    });

    const t = this.g.transition().duration(650);

    this.g.selectAll<SVGPathElement, any>("path")
      .transition(t as any)
      .tween("data", function(d: any) {
        const i = d3.interpolate(
          d.current || { x0: d.x0, x1: d.x1, y0: d.y0, y1: d.y1 },
          d.target
        );
        return (tt: number) => (d.current = i(tt));
      })
      .attrTween("d", function(d: any) {
        return () => arc(d.current) as string;
      })
      .attr("fill", (d: any) => getFill(d));

    // Labels: show/hide + transform with current frame
    labelSel
      .filter((d: any) => d.target && this.labelVisible(d.target))
      .transition(t as any)
      .style("visibility", "visible")
      .attrTween("transform", (d: any) => () => this.labelTransform(d.current));

    labelSel
      .filter((d: any) => !d.target || !this.labelVisible(d.target))
      .transition(t as any)
      .style("visibility", "hidden");
  }

  private labelVisible(d: d3.HierarchyRectangularNode<TreeNode>) {
    const a = (d.x1 - d.x0);
    const r = (d.y1 - d.y0);
    return (a > 0.03) && (r > 12);
  }

  private labelTransform(d: d3.HierarchyRectangularNode<TreeNode>) {
    const x = ((d.x0 + d.x1) / 2) * 180 / Math.PI;
    const y = (d.y0 + d.y1) / 2;
    return `rotate(${x - 90}) translate(${y},0) rotate(${x < 180 ? 0 : 180})`;
  }

  private updateLegend(
    root: d3.HierarchyRectangularNode<TreeNode>,
    color: d3.ScaleOrdinal<string, string, never>
  ) {
    const topLevel = root.children ?? [];
    const keys = this.legendEl
      .selectAll<HTMLDivElement, d3.HierarchyRectangularNode<TreeNode>>("div.key")
      .data(topLevel, d => d.data.name);

    keys.exit().remove();

    const enter = keys.enter().append("div").attr("class", "key");
    enter.append("span").attr("class", "swatch");
    enter.append("span").attr("class", "label");

    const merged = enter.merge(keys as any);
    merged.select<HTMLSpanElement>("span.swatch")
      .style("background", d => color(d.data.name));
    merged.select<HTMLSpanElement>("span.label")
      .text(d => d.data.name);
  }

  private updateCrumbs(
    root: d3.HierarchyRectangularNode<TreeNode>,
    node: d3.HierarchyRectangularNode<TreeNode>,
    onJump: (target: d3.HierarchyRectangularNode<TreeNode>) => void
  ) {
    const seq = node.ancestors().reverse();
    const html = seq.map((n, i) =>
      i === seq.length - 1
        ? `<strong>${n.data.name}</strong>`
        : `<a href="#" data-depth="${n.depth}">${n.data.name}</a>`
    ).join(`<span class="sep">›</span>`);

    this.crumbsEl.html(html);
    this.crumbsEl.selectAll<HTMLAnchorElement, unknown>("a")
      .on("click", (ev: MouseEvent) => {
        ev.preventDefault();
        const a = ev.currentTarget as HTMLAnchorElement;
        const depth = +a.getAttribute("data-depth")!;
        const target = seq.find(n => n.depth === depth) || root;
        onJump(target);
      });
  }

  private showTooltip(ev: MouseEvent, d: d3.HierarchyRectangularNode<TreeNode>) {
    const rect = this.rootEl.node()!.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const y = ev.clientY - rect.top;
    const seq = d.ancestors().reverse().map(n => n.data.name).join(" › ");
    this.tooltipEl
      .style("left", `${x}px`)
      .style("top", `${y - 18}px`)
      .style("opacity", 0.96)
      .text(`${seq} (Elemente: ${Math.round(d.value || 0)})`);
  }
  private hideTooltip() { this.tooltipEl.style("opacity", 0); }

  private clear() {
    this.g.selectAll("*").remove();
    this.legendEl.html("");
    this.crumbsEl.html("");
    this.tooltipEl.style("opacity", 0);
  }

  public destroy(): void {}
}
