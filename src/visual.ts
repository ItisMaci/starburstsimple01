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
type Selection<T extends d3.BaseType> = d3.Selection<T, any, any, any>;

interface HierarchyData {
  name: string;
  children?: HierarchyData[];
  value?: number;
  __meta?: { depth: number };
}

export class Visual implements IVisual {
  private host: IVisualHost;
  private container: Selection<HTMLDivElement>;
  private tooltip: Selection<HTMLDivElement>;
  private crumbs: Selection<HTMLDivElement>;
  private legend: Selection<HTMLDivElement>;
  private svg: Selection<SVGSVGElement>;
  private g: Selection<SVGGElement>;

  private width = 0;
  private height = 0;
  private radius = 0;

  // Store current hierarchy state
  private root: d3.HierarchyRectangularNode<HierarchyData> | null = null;
  private color: d3.ScaleOrdinal<string, string, never> | null = null;
  private arc: d3.Arc<any, d3.HierarchyRectangularNode<HierarchyData>> | null = null;
  private nodes: d3.HierarchyRectangularNode<HierarchyData>[] = [];
  private path: Selection<SVGPathElement> | null = null;
  private label: Selection<SVGTextElement> | null = null;

  constructor(options: VisualConstructorOptions) {
    this.host = options.host;

    this.container = d3.select(options.element)
      .append('div')
      .style('width', '100%')
      .style('height', '100%')
      .style('position', 'relative')
      .style('font-family', 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif')
      .style('background', '#f8fafc')
      .style('color', '#0f172a');

    // Create panel structure like original
    const panel = this.container.append('div')
      .style('max-width', '1200px')
      .style('margin', '32px auto')
      .style('padding', '0 16px')
      .style('background', '#ffffff')
      .style('border', '3px solid #0f172a')
      .style('border-radius', '16px')
      .style('box-shadow', '0 6px 20px rgba(0,0,0,.12)')
      .style('overflow', 'hidden');

    // Header with legend
    const header = panel.append('div')
      .style('padding', '16px 20px')
      .style('border-bottom', '1px solid #e2e8f0')
      .style('display', 'flex')
      .style('align-items', 'center')
      .style('gap', '12px')
      .style('flex-wrap', 'wrap');

    header.append('h2')
      .style('margin', '0')
      .style('font-size', '20px')
      .style('font-weight', '800')
      .style('letter-spacing', '.2px')
      .text('Power BI Sunburst');

    this.legend = header.append('div')
      .style('display', 'flex')
      .style('flex-wrap', 'wrap')
      .style('gap', '10px')
      .style('margin-left', 'auto');

    // Vis container
    const vis = panel.append('div')
      .style('position', 'relative')
      .style('display', 'grid')
      .style('place-items', 'center')
      .style('min-height', '760px')
      .style('background', '#fff');

    this.tooltip = vis.append('div')
      .style('position', 'absolute')
      .style('pointer-events', 'none')
      .style('opacity', '0')
      .style('transform', 'translate(-50%, -120%)')
      .style('background', '#111')
      .style('color', '#fff')
      .style('font-size', '12px')
      .style('padding', '6px 8px')
      .style('border-radius', '6px')
      .style('box-shadow', '0 6px 18px rgba(0,0,0,.2)');

    this.svg = vis.append('svg')
      .attr('role', 'img')
      .attr('aria-label', 'Sunburst partition visualization')
      .style('display', 'block')
      .style('height', 'auto')
      .style('width', '100%');

    this.g = this.svg.append('g');

    vis.append('div')
      .style('position', 'absolute')
      .style('width', '120px')
      .style('height', '120px')
      .style('border-radius', '999px')
      .style('display', 'grid')
      .style('place-items', 'center')
      .style('font-size', '12px')
      .style('color', '#64748b')
      .style('pointer-events', 'none')
      .style('text-align', 'center')
      .text('Click to zoom\nBack with breadcrumbs');

    // Breadcrumbs
    this.crumbs = panel.append('div')
      .style('padding', '10px 16px 16px')
      .style('font-size', '13px')
      .style('color', '#64748b');
  }

  public update(options: VisualUpdateOptions): void {
    const dv: DataView | undefined = options.dataViews?.[0];
    const catCols = dv?.categorical?.categories ?? [];
    
    if (!catCols.length) {
      this.clear();
      return;
    }

    this.width = Math.max(400, options.viewport.width);
    this.height = Math.max(400, options.viewport.height - 200); // Account for header/footer
    this.radius = Math.min(this.width, this.height) / 2 - 10;

    this.svg
      .attr('viewBox', [-this.width/2, -this.height/2, this.width, this.height])
      .attr('width', this.width)
      .attr('height', this.height);

    // Build hierarchy from Power BI data exactly like original D3 version
    const data = this.buildHierarchyFromPowerBI(catCols);
    
    // D3 hierarchy and partition - exact copy from original
    const hierarchy = d3.hierarchy<HierarchyData>(data)
        .sum(d => d.value || 0)
        .sort((a, b) => (b.value || 0) - (a.value || 0));

    const partition = d3.partition<HierarchyData>().size([2 * Math.PI, this.radius]);
    const rootPartitioned = partition(hierarchy);

    this.root = rootPartitioned;
    
    // Color by top-level ancestor - exact copy from original
    this.color = d3.scaleOrdinal(d3.schemeTableau10);
    const topAncestor = (d: d3.HierarchyRectangularNode<HierarchyData>) => 
      (d.depth === 1 ? d : d.ancestors().find(a => a.depth === 1) || d);
    const getFill = (d: d3.HierarchyRectangularNode<HierarchyData>) => {
      const base = this.color!(topAncestor(d).data.name);
      const maxDepth = this.root!.height;
      const t = Math.max(0, Math.min(1, (d.depth-1) / (maxDepth-1 || 1)));
      return d3.interpolateLab(base, '#f8fafc')(t * 0.85);
    };

    // Arc definition - exact copy from original
    this.arc = d3.arc<d3.HierarchyRectangularNode<HierarchyData>>()
      .startAngle(d => d.x0)
      .endAngle(d => d.x1)
      .padAngle(d => Math.min((d.x1 - d.x0) / 2, 0.003))
      .padRadius(this.radius)
      .innerRadius(d => d.y0)
      .outerRadius(d => Math.max(d.y0, d.y1 - 1));

    this.nodes = this.root.descendants().filter(d => d.depth > 0);

    // Render paths - exact copy from original logic
    this.path = this.g.selectAll<SVGPathElement, d3.HierarchyRectangularNode<HierarchyData>>('path')
      .data(this.nodes)
      .join('path')
      .attr('fill', d => getFill(d))
      .attr('d', this.arc)
      .attr('stroke', '#fff')
      .attr('stroke-width', 1)
      .style('cursor', 'pointer')
      .on('click', (event, d) => this.zoomTo(d))
      .on('mousemove', (event, d) => {
        const seq = this.safeAncestors(d).map(n => n.data.name).join(' › ');
        this.tooltip.style('opacity', '0.96');
        this.tooltip.text(`${seq} (Elements: ${Math.round(d.value || 0)})`);
        const rect = this.container.node()!.getBoundingClientRect();
        this.tooltip.style('left', (event.clientX - rect.left) + 'px');
        this.tooltip.style('top', (event.clientY - rect.top) + 'px');
      })
      .on('mouseleave', () => this.tooltip.style('opacity', '0'));

    // Render labels - exact copy from original
    this.label = this.g.append('g')
      .attr('pointer-events', 'none')
      .attr('text-anchor', 'middle')
      .selectAll<SVGTextElement, d3.HierarchyRectangularNode<HierarchyData>>('text')
      .data(this.nodes)
      .join('text')
      .attr('dy', '0.32em')
      .attr('fill', '#0f172a')
      .attr('font-size', 18)
      .attr('font-weight', 600)
      .style('user-select', 'none')
      .style('visibility', d => this.labelVisible(d) ? 'visible' : 'hidden')
      .attr('transform', d => this.labelTransform(d))
      .text(d => {
        const name = d.data.name;
        return name.length > 8 ? name.slice(0, 8) + "..." : name;
      });

    this.updateLegend();
    this.updateCrumbs(this.root);
  }

  // Build hierarchy from Power BI categorical data
  private buildHierarchyFromPowerBI(catCols: powerbi.DataViewCategoryColumn[]): HierarchyData {
    const rowCount = catCols[0].values.length;
    
    // Create root
    const root: HierarchyData & { _childMap?: Map<string, any> } = { 
      name: "Root", 
      children: [],
      _childMap: new Map()
    };

    // Build paths from Power BI data
    for (let r = 0; r < rowCount; r++) {
      const path: string[] = [];
      for (let l = 0; l < catCols.length; l++) {
        const val = catCols[l]?.values?.[r];
        if (val == null || val === "" || val === "null") break;
        path.push(String(val));
      }
      if (!path.length) continue;

      // Build hierarchy path
      let current: any = root;
      for (let i = 0; i < path.length; i++) {
        const name = path[i];
        current._childMap = current._childMap || new Map();
        current.children = current.children || [];
        
        if (!current._childMap.has(name)) {
          const child = { 
            name, 
            children: [],
            _childMap: new Map(),
            __meta: { depth: i + 1 }
          };
          current._childMap.set(name, child);
          current.children.push(child);
        }
        current = current._childMap.get(name);
      }
      
      // Count leaf nodes only
      current.value = (current.value || 0) + 1;
    }

    // Clean up helper maps and calculate values - exact copy from original
    const cleanAndRollup = (node: any): number => {
      delete node._childMap;
      if (node.children && node.children.length > 0) {
        let sum = 0;
        for (const child of node.children) {
          sum += cleanAndRollup(child);
        }
        node.value = sum;
        return sum;
      }
      return node.value || 0;
    };
    
    cleanAndRollup(root);
    return root;
  }

  // Zoom function - exact copy from original
  private zoomTo(p: d3.HierarchyRectangularNode<HierarchyData> | null) {
    if (!p || !this.root || !this.arc || !this.path || !this.label) return;
    
    this.tooltip.style('opacity', '0');
    this.updateCrumbs(p);

    this.root.each((d: any) => d.target = {
      x0: Math.max(0, Math.min(1, (d.x0 - p.x0) / (p.x1 - p.x0))) * 2 * Math.PI,
      x1: Math.max(0, Math.min(1, (d.x1 - p.x0) / (p.x1 - p.x0))) * 2 * Math.PI,
      y0: Math.max(0, d.y0 - p.y0),
      y1: Math.max(0, d.y1 - p.y0)
    });

    const t = this.g.transition().duration(650);

    this.path.transition(t as any)
      .tween('data', (d: any) => {
        const i = d3.interpolate(d.current || {x0:d.x0, x1:d.x1, y0:d.y0, y1:d.y1}, d.target);
        return (t: number) => (d.current = i(t));
      })
      .attrTween('d', (d: any) => () => this.arc!(d.current));

    this.label.filter((d: any) => this.labelVisible(d.target))
      .transition(t as any)
      .style('visibility', 'visible')
      .attrTween('transform', (d: any) => () => this.labelTransform(d.current));

    this.label.filter((d: any) => !this.labelVisible(d.target))
      .transition(t as any)
      .style('visibility', 'hidden');
  }

  // Helper functions - exact copies from original
  private labelVisible(d: any) {
    const a = (d.x1 - d.x0);
    const r = (d.y1 - d.y0);
    return (a > 0.03) && (r > 12);
  }

  private labelTransform(d: any) {
    const x = (d.x0 + d.x1) / 2 * 180 / Math.PI;
    const y = (d.y0 + d.y1) / 2;
    return `rotate(${x - 90}) translate(${y},0) rotate(${x < 180 ? 0 : 180})`;
  }

  private safeAncestors(n: d3.HierarchyRectangularNode<HierarchyData>) {
    if (n && typeof n.ancestors === 'function') return n.ancestors().reverse();
    return this.root ? [this.root] : [];
  }

  private updateLegend() {
    if (!this.root || !this.color) return;
    
    const topLevel = this.root.children || [];
    this.legend.selectAll('*').remove();
    this.legend.selectAll('div.key')
      .data(topLevel)
      .join('div')
      .attr('class', 'key')
      .style('display', 'inline-flex')
      .style('align-items', 'center')
      .style('gap', '6px')
      .style('font-size', '12px')
      .style('color', '#64748b')
      .html((d) => `<span style="width:40px;height:12px;border-radius:3px;background:${this.color!(d.data.name)}"></span>${d.data.name}`);
  }

  private updateCrumbs(n: d3.HierarchyRectangularNode<HierarchyData>) {
    if (!this.root) return;
    
    const seq = this.safeAncestors(n).map(x => x.data.name);
    const html = seq.map((name, i) => {
      if (i === seq.length-1) return `<strong>${name}</strong>`;
      return `<a href="#" data-depth="${i}" style="color:#0ea5e9;text-decoration:none;">${name}</a>`;
    }).join('<span style="opacity:.5;padding:0 6px;">›</span>');
    
    this.crumbs.html(html);

    // Add click handlers for breadcrumbs
    this.crumbs.selectAll('a').on('click', (event: Event) => {
      event.preventDefault();
      const a = event.currentTarget as HTMLAnchorElement;
      const depth = +a.getAttribute('data-depth')!;
      const name = a.textContent!;
      const target = depth === 0 ? this.root! : 
        this.nodes.find(nn => nn.depth === depth && nn.data.name === name) || this.root!;
      this.zoomTo(target);
    });
  }

  private clear() {
    this.g.selectAll("*").remove();
    this.legend.html("");
    this.crumbs.html("");
    this.tooltip.style("opacity", "0");
    this.root = null;
  }

  public destroy(): void {
    // Cleanup if needed
  }
}