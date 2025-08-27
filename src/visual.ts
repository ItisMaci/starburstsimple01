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
  __meta?: { depth: number }; // Add metadata like original
}

// Extended type for nodes with animation state
interface AnimatedHierarchyNode extends d3.HierarchyRectangularNode<TreeNode> {
  target?: {
    x0: number;
    x1: number;
    y0: number;
    y1: number;
  };
  current?: {
    x0: number;
    x1: number;
    y0: number;
    y1: number;
  };
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

  // Store current root for navigation
  private hierarchyRoot: AnimatedHierarchyNode | null = null;

  constructor(options: VisualConstructorOptions) {
    this.host = options.host;

    const root = d3.select(options.element)
      .append("div")
      .classed("circleSunburst", true)
      .style("width", "100%")
      .style("height", "100%")
      .style("position", "relative")
      .style("font-family", "system-ui, -apple-system, Segoe UI, Roboto, sans-serif");

    // Create header with legend
    const header = root.append("div")
      .style("padding", "16px 20px")
      .style("border-bottom", "1px solid #e2e8f0")
      .style("display", "flex")
      .style("align-items", "center")
      .style("gap", "12px")
      .style("flex-wrap", "wrap")
      .style("background", "#fff");

    header.append("h2")
      .style("margin", "0")
      .style("font-size", "20px")
      .style("font-weight", "800")
      .text("Power BI Sunburst");

    this.legendEl = header.append("div")
      .classed("legend", true)
      .style("display", "flex")
      .style("flex-wrap", "wrap")
      .style("gap", "10px")
      .style("margin-left", "auto");

    // Main visualization container
    const visContainer = root.append("div")
      .style("position", "relative")
      .style("display", "grid")
      .style("place-items", "center")
      .style("min-height", "600px")
      .style("background", "#fff");

    this.tooltipEl = visContainer.append("div")
      .classed("tooltip", true)
      .style("position", "absolute")
      .style("pointer-events", "none")
      .style("opacity", "0")
      .style("transform", "translate(-50%, -120%)")
      .style("background", "#111")
      .style("color", "#fff")
      .style("font-size", "12px")
      .style("padding", "6px 8px")
      .style("border-radius", "6px")
      .style("box-shadow", "0 6px 18px rgba(0,0,0,.2)")
      .style("z-index", "1000");

    this.svg = visContainer.append("svg")
      .attr("role", "img")
      .attr("aria-label", "Sunburst partition visualization")
      .style("display", "block")
      .style("width", "100%")
      .style("height", "auto");

    this.g = this.svg.append("g");

    // Center reset instructions
    visContainer.append("div")
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
      .text("Click to zoom\nBack with breadcrumbs");

    // Breadcrumbs container
    this.crumbsEl = root.append("div")
      .classed("crumbs", true)
      .style("padding", "10px 16px 16px")
      .style("font-size", "13px")
      .style("color", "#64748b")
      .style("background", "#fff");

    this.rootEl = root as Sel<HTMLDivElement>;
  }

  public update(options: VisualUpdateOptions): void {
    const dv: DataView | undefined = options.dataViews?.[0];
    const catCols = dv?.categorical?.categories ?? [];
    
    if (!catCols.length) {
      this.clear();
      return;
    }

    this.width = Math.max(400, options.viewport.width);
    this.height = Math.max(400, options.viewport.height - 120); // Account for header/footer
    this.radius = Math.max(50, Math.min(this.width, this.height) / 2 - 20);

    this.svg
      .attr("width", this.width)
      .attr("height", this.height)
      .attr("viewBox", `${-this.width / 2} ${-this.height / 2} ${this.width} ${this.height}`);

    // ---- Build tree from categorical paths (FIXED: Match original logic) ----
    const rowCount = catCols[0].values.length;
    const getVal = (level: number, r: number) => {
      const val = catCols[level]?.values?.[r];
      return val == null ? null : String(val);
    };

    const rootData: TreeNode = { 
      name: "Root", 
      children: [], 
      _map: new Map(),
      __meta: { depth: 0 }
    };

    for (let r = 0; r < rowCount; r++) {
      const path: string[] = [];
      for (let l = 0; l < catCols.length; l++) {
        const v = getVal(l, r);
        if (v == null || v === "" || v === "null") break;
        path.push(v);
      }
      if (!path.length) continue;

      let cursor = rootData;
      for (let i = 0; i < path.length; i++) {
        const name = path[i];
        cursor._map ??= new Map();
        cursor.children ??= [];
        
        let child = cursor._map.get(name);
        if (!child) {
          child = { 
            name, 
            children: [], 
            _map: new Map(),
            __meta: { depth: i + 1 }
          };
          cursor._map.set(name, child);
          cursor.children.push(child);
        }
        cursor = child;
      }
      // FIXED: Only count leaf nodes, like original
      if (!cursor.children || cursor.children.length === 0) {
        cursor.value = (cursor.value ?? 0) + 1;
      }
    }

    // FIXED: Proper rollup that matches original logic
    const rollup = (n: TreeNode): number => {
      let total = 0;
      
      if (n.children && n.children.length > 0) {
        // Internal node: sum of children
        for (const child of n.children) {
          total += rollup(child);
        }
        n.value = total;
      } else {
        // Leaf node: keep its own value (or default to 1)
        n.value = n.value || 1;
        total = n.value;
      }
      
      return total;
    };
    rollup(rootData);

    // Clean up helper maps
    const strip = (n: TreeNode) => {
      delete n._map;
      n.children?.forEach(strip);
    };
    strip(rootData);

    // ---- D3 hierarchy + partition ----
    const rootH = d3.hierarchy<TreeNode>(rootData)
      .sum(d => d.value || 0)
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

    const partition = d3.partition<TreeNode>().size([2 * Math.PI, this.radius]);
    const root = partition(rootH) as AnimatedHierarchyNode;
    
    // Store for navigation
    this.hierarchyRoot = root;

    // FIXED: Color scheme matching original
    const color = d3.scaleOrdinal(d3.schemeTableau10);
    const topAncestor = (d: AnimatedHierarchyNode): AnimatedHierarchyNode =>
      d.depth === 1 ? d : (d.ancestors().find(a => a.depth === 1) as AnimatedHierarchyNode || d);

    const getFill = (d: AnimatedHierarchyNode): string => {
      const base = color(topAncestor(d).data.name) as string;
      const maxDepth = root.height;
      const t = maxDepth > 1 ? Math.max(0, Math.min(1, (d.depth - 1) / (maxDepth - 1))) : 0;
      return d3.interpolateLab(base, "#f8fafc")(t * 0.85);
    };

    // FIXED: Arc configuration matching original
    const arc = d3.arc<AnimatedHierarchyNode>()
      .startAngle(d => d.x0)
      .endAngle(d => d.x1)
      .padAngle(d => Math.min((d.x1 - d.x0) / 2, 0.003))
      .padRadius(this.radius)
      .innerRadius(d => d.y0)
      .outerRadius(d => Math.max(d.y0, d.y1 - 1));

    const nodes = root.descendants().filter(d => d.depth > 0) as AnimatedHierarchyNode[];

    // Initialize current state for animation
    nodes.forEach(d => {
      d.current = { x0: d.x0, x1: d.x1, y0: d.y0, y1: d.y1 };
    });

    // ---- Render paths ----
    const paths = this.g
      .selectAll<SVGPathElement, AnimatedHierarchyNode>("path")
      .data(nodes, d => `${d.depth}|${d.data.name}`);

    paths.exit().remove();

    const pathsEnter = paths.enter()
      .append("path")
      .attr("stroke", "#fff")
      .attr("stroke-width", 1)
      .style("cursor", "pointer");

    const pathsMerged = pathsEnter.merge(paths as any)
      .attr("fill", d => getFill(d))
      .attr("d", d => arc(d) as string)
      .on("click", (event: MouseEvent, d: AnimatedHierarchyNode) => {
        event.stopPropagation();
        this.zoomTo(d);
      })
      .on("mousemove", (event: MouseEvent, d: AnimatedHierarchyNode) => 
        this.showTooltip(event, d))
      .on("mouseleave", () => this.hideTooltip());

    // ---- Render labels ----
    const labels = this.g
      .selectAll<SVGTextElement, AnimatedHierarchyNode>("text")
      .data(nodes, d => `${d.depth}|${d.data.name}`);

    labels.exit().remove();

    const labelsEnter = labels.enter()
      .append("text")
      .attr("dy", "0.32em")
      .attr("fill", "#0f172a")
      .attr("font-size", 14)
      .attr("font-weight", 600)
      .attr("text-anchor", "middle")
      .style("pointer-events", "none")
      .style("user-select", "none");

    const labelsMerged = labelsEnter.merge(labels as any)
      .text(d => {
        const name = d.data.name || "";
        return name.length > 10 ? name.slice(0, 10) + "…" : name;
      })
      .style("visibility", d => this.labelVisible(d) ? "visible" : "hidden")
      .attr("transform", d => this.labelTransform(d));

    // Store references for zoom
    this.pathsMerged = pathsMerged;
    this.labelsMerged = labelsMerged;

    // Initialize display
    this.updateLegend(root, color);
    this.updateCrumbs(root);

    // Background click → zoom to root
    this.svg.on("click", () => this.zoomTo(root));
  }

  // Store merged selections for zoom function
  private pathsMerged: any;
  private labelsMerged: any;

  private zoomTo(p: AnimatedHierarchyNode) {
    if (!p || !this.hierarchyRoot) return;
    
    this.hideTooltip();
    this.updateCrumbs(p);

    // FIXED: Animation logic matching original
    this.hierarchyRoot.each((d: AnimatedHierarchyNode) => {
      d.target = {
        x0: Math.max(0, Math.min(1, (d.x0 - p.x0) / (p.x1 - p.x0))) * 2 * Math.PI,
        x1: Math.max(0, Math.min(1, (d.x1 - p.x0) / (p.x1 - p.x0))) * 2 * Math.PI,
        y0: Math.max(0, d.y0 - p.y0),
        y1: Math.max(0, d.y1 - p.y0)
      };
    });

    const t = this.g.transition().duration(650);

    // Arc for current animation frame
    const arc = d3.arc<AnimatedHierarchyNode>()
      .startAngle(d => d.x0)
      .endAngle(d => d.x1)
      .padAngle(d => Math.min((d.x1 - d.x0) / 2, 0.003))
      .padRadius(this.radius)
      .innerRadius(d => d.y0)
      .outerRadius(d => Math.max(d.y0, d.y1 - 1));

    // Create arc function for animation states
    const animArc = d3.arc<{x0: number, x1: number, y0: number, y1: number}>()
      .startAngle(d => d.x0)
      .endAngle(d => d.x1)
      .padAngle(d => Math.min((d.x1 - d.x0) / 2, 0.003))
      .padRadius(this.radius)
      .innerRadius(d => d.y0)
      .outerRadius(d => Math.max(d.y0, d.y1 - 1));

    // Animate paths
    this.pathsMerged
      .transition(t as any)
      .tween("data", function(d: AnimatedHierarchyNode) {
        const i = d3.interpolate(d.current || d.target!, d.target!);
        return (tt: number) => (d.current = i(tt));
      })
      .attrTween("d", (d: AnimatedHierarchyNode) => () => animArc(d.current!) as string);

    // Helper functions for animation states
    const labelVisibleAnim = (coords: {x0: number, x1: number, y0: number, y1: number}) => {
      const a = (coords.x1 - coords.x0);
      const r = (coords.y1 - coords.y0);
      return (a > 0.03) && (r > 12);
    };

    const labelTransformAnim = (coords: {x0: number, x1: number, y0: number, y1: number}) => {
      const x = ((coords.x0 + coords.x1) / 2) * 180 / Math.PI;
      const y = (coords.y0 + coords.y1) / 2;
      return `rotate(${x - 90}) translate(${y},0) rotate(${x < 180 ? 0 : 180})`;
    };

    // Animate labels
    this.labelsMerged
      .filter((d: AnimatedHierarchyNode) => d.target && labelVisibleAnim(d.target))
      .transition(t as any)
      .style("visibility", "visible")
      .attrTween("transform", (d: AnimatedHierarchyNode) => 
        () => labelTransformAnim(d.current!));

    this.labelsMerged
      .filter((d: AnimatedHierarchyNode) => !d.target || !labelVisibleAnim(d.target))
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
    root: AnimatedHierarchyNode,
    color: d3.ScaleOrdinal<string, string, never>
  ) {
    const topLevel = root.children ?? [];
    
    const keys = this.legendEl
      .selectAll<HTMLDivElement, AnimatedHierarchyNode>("div.key")
      .data(topLevel, d => d.data.name);

    keys.exit().remove();

    const enter = keys.enter().append("div")
      .attr("class", "key")
      .style("display", "inline-flex")
      .style("align-items", "center")
      .style("gap", "6px")
      .style("font-size", "12px")
      .style("color", "#64748b");

    enter.append("span")
      .attr("class", "swatch")
      .style("width", "40px")
      .style("height", "12px")
      .style("border-radius", "3px");

    enter.append("span").attr("class", "label");

    const merged = enter.merge(keys as any);
    merged.select<HTMLSpanElement>("span.swatch")
      .style("background", d => color(d.data.name));
    merged.select<HTMLSpanElement>("span.label")
      .text(d => d.data.name);
  }

  private updateCrumbs(node: AnimatedHierarchyNode) {
    if (!this.hierarchyRoot) return;
    
    const seq = node.ancestors().reverse();
    const parts: string[] = [];
    
    seq.forEach((n, i) => {
      if (i === seq.length - 1) {
        parts.push(`<strong>${n.data.name}</strong>`);
      } else {
        parts.push(`<a href="#" data-depth="${n.depth}" style="color:#0ea5e9;text-decoration:none;">${n.data.name}</a>`);
      }
    });

    const html = parts.join(`<span style="opacity:.5;padding:0 6px;">›</span>`);
    this.crumbsEl.html(html);

    // Add click handlers for navigation
    this.crumbsEl.selectAll<HTMLAnchorElement, unknown>("a")
      .on("click", (event: MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
        const a = event.currentTarget as HTMLAnchorElement;
        const depth = +a.getAttribute("data-depth")!;
        const target = seq.find(n => n.depth === depth) || this.hierarchyRoot!;
        this.zoomTo(target);
      });
  }

  private showTooltip(event: MouseEvent, d: AnimatedHierarchyNode) {
    const rect = this.rootEl.node()!.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const seq = d.ancestors().reverse().map(n => n.data.name).join(" › ");
    
    this.tooltipEl
      .style("left", `${x}px`)
      .style("top", `${y - 30}px`)
      .style("opacity", "0.96")
      .text(`${seq} (Elements: ${Math.round(d.value || 0)})`);
  }

  private hideTooltip() { 
    this.tooltipEl.style("opacity", "0"); 
  }

  private clear() {
    this.g.selectAll("*").remove();
    this.legendEl.html("");
    this.crumbsEl.html("");
    this.tooltipEl.style("opacity", "0");
    this.hierarchyRoot = null;
  }

  public destroy(): void {
    // Clean up any resources if needed
  }
}