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

/**
 * Sunburst (starburst) partition visual for Power BI Visuals SDK (pbiviz 6.1)
 * Uses D3 v7.9
 */

import powerbi from "powerbi-visuals-api";
import IVisual = powerbi.extensibility.visual.IVisual;
import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
import DataView = powerbi.DataView;

import * as d3 from "d3";

// Simple data shape we'll feed into d3.hierarchy
interface SunburstNode {
    name: string;
    value?: number;
    children?: SunburstNode[];
}

export class Visual implements IVisual {
    private host: powerbi.extensibility.visual.IVisualHost;
    private svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
    private g: d3.Selection<SVGGElement, unknown, null, undefined>;

    constructor(options: VisualConstructorOptions) {
        this.host = options.host;

        this.svg = d3
            .select(options.element)
            .append("svg")
            .attr("class", "sunburst-svg");

        this.g = this.svg
            .append("g")
            .attr("class", "sunburst-container");
    }

    public update(options: VisualUpdateOptions): void {
        const { viewport } = options;
        const width = Math.max(0, viewport.width);
        const height = Math.max(0, viewport.height);
        const radius = Math.min(width, height) / 2;

        this.svg.attr("width", width).attr("height", height);
        this.g.attr("transform", `translate(${width / 2},${height / 2})`);

        const dv: DataView | undefined = options.dataViews && options.dataViews[0];

        // Clear if we don't have a proper matrix yet
        if (!dv || !dv.matrix || !dv.matrix.rows || !dv.matrix.rows.root) {
            this.g.selectAll("*").remove();
            return;
        }

        // Build hierarchical data from the matrix (rows-only hierarchy)
        const rootNode = dv.matrix.rows.root as powerbi.DataViewTreeNode;
        const tree = this.matrixToHierarchy(rootNode);

        // Build a d3 hierarchy; size comes from "value" at leaves (fallback to count)
        const root = d3
            .hierarchy<SunburstNode>(tree)
            .sum((d) => (typeof d.value === "number" && d.value > 0 ? d.value : 0))
            .sort((a, b) => (b.value || 0) - (a.value || 0));

        const depthCount = root.height + 1; // total ring count including root
        const partition = d3.partition<SunburstNode>().size([2 * Math.PI, depthCount]);
        partition(root as unknown as d3.HierarchyNode<SunburstNode>);

        const r = radius;
        const radial = d3.scaleLinear().domain([0, depthCount]).range([0, r]);

        // Color by top-level ancestor (stable coloring per branch)
        const topNames = (root.children || []).map((c) => c.data.name);
        const color = d3.scaleOrdinal<string, string>().domain(topNames).range(d3.schemeCategory10);

        const arc = d3
            .arc<d3.HierarchyRectangularNode<SunburstNode>>()
            .startAngle((d) => d.x0)
            .endAngle((d) => d.x1)
            .padAngle((d) => (d.x1 - d.x0) * 0.002)
            .padRadius(r)
            .innerRadius((d) => Math.max(0, radial(d.y0)))
            .outerRadius((d) => Math.max(0, radial(d.y1) - 1));

        // Redraw
        this.g.selectAll("*").remove();

        const nodes = (root.descendants() as d3.HierarchyRectangularNode<SunburstNode>[]) // typed cast
            .filter((d) => d.depth > 0); // skip the invisible root ring

        const paths = this.g
            .selectAll("path.arc")
            .data(nodes, (d: any) => this.nodeKey(d))
            .enter()
            .append("path")
            .attr("class", "arc")
            .attr("d", arc as any)
            .attr("fill", (d) => color(this.topAncestorName(d)))
            .attr("stroke", "#fff")
            .attr("stroke-width", 1);

        // Simple tooltips via <title>
        paths
            .append("title")
            .text((d) => `${this.pathLabel(d)}
${this.formatValue(d.value)}`);

        // Optional center label (total)
        this.g
            .append("text")
            .attr("class", "center-label")
            .attr("dy", "0.35em")
            .attr("text-anchor", "middle")
            .text(this.formatValue(root.value));
    }

    // --- Helpers -----------------------------------------------------------------

    private formatValue(v?: number | null): string {
        if (v == null) return "";
        const abs = Math.abs(v);
        if (abs >= 1_000_000_000) return (v / 1_000_000_000).toFixed(1) + "B";
        if (abs >= 1_000_000) return (v / 1_000_000).toFixed(1) + "M";
        if (abs >= 1_000) return (v / 1_000).toFixed(1) + "K";
        return String(v);
    }

    private nodeKey(d: d3.HierarchyNode<SunburstNode>): string {
        return d
            .ancestors()
            .map((a) => a.data.name)
            .reverse()
            .join("/");
    }

    private topAncestorName(d: d3.HierarchyNode<SunburstNode>): string {
        const depth1 = d.ancestors().find((a) => a.depth === 1);
        return (depth1 || d).data.name;
    }

    private pathLabel(d: d3.HierarchyNode<SunburstNode>): string {
        const parts = d
            .ancestors()
            .map((a) => a.data.name)
            .reverse();
        parts.shift(); // drop the (root) label
        return parts.join(" › ");
    }

    /**
     * Convert Power BI matrix (rows) into a nested object suitable for d3.hierarchy.
     *
     * Notes:
     * - We preserve intermediate levels even if a node has no further children ("keep layers").
     * - Leaf node size: first numeric measure value if present; otherwise count (1).
     */
    private matrixToHierarchy(root: powerbi.DataViewTreeNode): SunburstNode {
        const makeName = (n: powerbi.DataViewTreeNode): string => {
            const v: any = (n as any).value;
            if (v === null || v === undefined) return "(blank)";
            return String(v);
        };

        const extractMeasure = (n: any): number | undefined => {
            const vals: any = n.values;
            if (!vals) return undefined;
            // Support both array-like and object-map shapes
            if (Array.isArray(vals)) {
                for (const m of vals) {
                    const mv = m && (m.value as any);
                    if (typeof mv === "number" && isFinite(mv)) return mv;
                }
            } else if (typeof vals === "object") {
                for (const k of Object.keys(vals)) {
                    const mv = vals[k] && (vals[k].value as any);
                    if (typeof mv === "number" && isFinite(mv)) return mv;
                }
            }
            return undefined;
        };

        const walk = (node: powerbi.DataViewTreeNode, isRoot = false): SunburstNode => {
            const name = isRoot ? "(root)" : makeName(node);

            const kids = (node.children || []).map((c) => walk(c, false));

            // Leaf if no children
            if (!kids.length) {
                const m = extractMeasure(node);
                return {
                    name,
                    value: typeof m === "number" ? m : 1, // fallback to count = 1
                };
            }

            // Internal node: keep it even without direct measure; size comes from children via .sum()
            return {
                name,
                children: kids,
            };
        };

        return walk(root, true);
    }
}