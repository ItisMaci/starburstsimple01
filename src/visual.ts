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
 * Enhanced Sunburst Chart for Power BI
 * Features: Zoom functionality, breadcrumbs, tooltips, and dynamic styling
 * Based on D3 v7.9
 */

import powerbi from "powerbi-visuals-api";
import IVisual = powerbi.extensibility.visual.IVisual;
import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
import DataView = powerbi.DataView;
import ISelectionManager = powerbi.extensibility.ISelectionManager;

import * as d3 from "d3";


// Data shape for the hierarchy
interface SunburstNode {
    name: string;
    value?: number;
    children?: SunburstNode[];
    __meta?: { depth: number };
}

// Extended hierarchy node with current state for animations
interface ExtendedHierarchyNode extends d3.HierarchyRectangularNode<SunburstNode> {
    current?: { x0: number; x1: number; y0: number; y1: number };
    target?: { x0: number; x1: number; y0: number; y1: number };
}

export class Visual implements IVisual {
    private host: powerbi.extensibility.visual.IVisualHost;
    private element: HTMLElement;
    private svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
    private g: d3.Selection<SVGGElement, unknown, null, undefined>;
    private tooltip: d3.Selection<HTMLDivElement, unknown, null, undefined>;
    private breadcrumbs: d3.Selection<HTMLDivElement, unknown, null, undefined>;
    private legend: d3.Selection<HTMLDivElement, unknown, null, undefined>;
    private centerLabel: d3.Selection<HTMLDivElement, unknown, null, undefined>;
    private selectionManager: ISelectionManager;

    
    // Chart state
    private root: d3.HierarchyRectangularNode<SunburstNode>;
    private currentFocus: d3.HierarchyRectangularNode<SunburstNode>;
    private radius: number;
    private color: d3.ScaleOrdinal<string, string>;
    private arc: d3.Arc<any, ExtendedHierarchyNode>;
    private nodes: ExtendedHierarchyNode[];
    private pathElements: d3.Selection<SVGPathElement, ExtendedHierarchyNode, SVGGElement, unknown>;
    private labelElements: d3.Selection<SVGTextElement, ExtendedHierarchyNode, SVGGElement, unknown>;

    constructor(options: VisualConstructorOptions) {
        this.host = options.host;
        this.element = options.element;
        this.selectionManager = this.host.createSelectionManager();
        
        // Create container structure
        this.createContainer();
    }
    
    private createContainer(): void {
        // Main container
        const container = d3.select(this.element)
            .style('font-family', 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif')
            .style('background', '#f8fafc')
            .style('color', '#0f172a')
            .style('position', 'relative')
            .style('width', '100%')
            .style('height', '100%');

        // Panel wrapper
        const panel = container.append('div')
            .style('background', '#ffffff')
            .style('border', '3px solid #0f172a')
            .style('border-radius', '16px')
            .style('box-shadow', '0 6px 20px rgba(0,0,0,0.12)')
            .style('overflow', 'hidden')
            .style('height', '100%')
            .style('display', 'flex')
            .style('flex-direction', 'column');

        // Header
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
            .style('letter-spacing', '0.2px')
            .text('Sunburst Chart');

        this.legend = header.append('div')
            .style('display', 'flex')
            .style('flex-wrap', 'wrap')
            .style('gap', '10px')
            .style('margin-left', 'auto');

        // Visualization area
        const visArea = panel.append('div')
            .style('position', 'relative')
            .style('display', 'grid')
            .style('place-items', 'center')
            .style('flex', '1')
            .style('background', '#fff')
            .style('min-height', '400px');

        // SVG
        this.svg = visArea.append('svg')
            .attr('class', 'sunburst-svg')
            .style('display', 'block')
            .style('height', 'auto')
            .style('width', '100%');

        this.g = this.svg.append('g')
            .attr('class', 'sunburst-container');

        // Tooltip
        this.tooltip = visArea.append('div')
            .style('position', 'absolute')
            .style('pointer-events', 'none')
            .style('opacity', '0')
            .style('background', '#111')
            .style('color', '#fff')
            .style('font-size', '12px')
            .style('padding', '6px 8px')
            .style('border-radius', '6px')
            .style('box-shadow', '0 6px 18px rgba(0,0,0,0.2)')
            .style('transform', 'translate(-50%, -120%)')
            .style('z-index', '1000');

        // Center reset label
        this.centerLabel = visArea.append('div')
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
            .style('line-height', '1.4')
            .html('Click to zoom<br/>Back with breadcrumbs');

        // Breadcrumbs
        this.breadcrumbs = panel.append('div')
            .style('padding', '10px 16px 16px')
            .style('font-size', '13px')
            .style('color', '#334155')
            .style('border-top', '1px solid #e2e8f0');
    }

    public update(options: VisualUpdateOptions): void {
        const { viewport } = options;
        const width = Math.max(0, viewport.width);
        const height = Math.max(0, viewport.height - 120); // Account for header and breadcrumbs
        this.radius = Math.min(width, height) / 2 - 10;

        this.svg.attr('width', width).attr('height', height);
        this.g.attr('transform', `translate(${width / 2},${height / 2})`);

        const dv: DataView | undefined = options.dataViews && options.dataViews[0];

        // Initialize formatting settings with defaults


        // Clear if we don't have proper data
        if (!dv || !dv.matrix || !dv.matrix.rows || !dv.matrix.rows.root) {
            this.clearVisualization();
            return;
        }

        // Build hierarchical data from the matrix
        const rootNode = dv.matrix.rows.root as powerbi.DataViewTreeNode;
        const tree = this.matrixToHierarchy(rootNode);

        // Build d3 hierarchy
        this.root = d3
            .hierarchy<SunburstNode>(tree)
            .sum((d) => (typeof d.value === 'number' && d.value > 0 ? d.value : 1))
            .sort((a, b) => (b.value || 0) - (a.value || 0)) as d3.HierarchyRectangularNode<SunburstNode>;

        // Set up partition layout
        const partition = d3.partition<SunburstNode>().size([2 * Math.PI, this.radius]);
        partition(this.root);

        // Set initial focus to root
        this.currentFocus = this.root;

        // Set up color scale based on settings
        const colorScheme = 'tableau10'; // Default for now
        const topLevel = this.root.children || [];
        this.color = d3.scaleOrdinal(this.getColorScheme(colorScheme))
            .domain(topLevel.map(d => d.data.name));

        // Set up arc generator
        this.arc = d3.arc<ExtendedHierarchyNode>()
            .startAngle(d => d.x0)
            .endAngle(d => d.x1)
            .padAngle(d => Math.min((d.x1 - d.x0) / 2, 0.003))
            .padRadius(this.radius)
            .innerRadius(d => d.y0)
            .outerRadius(d => Math.max(d.y0, d.y1 - 1));

        // Get nodes (excluding root)
        this.nodes = this.root.descendants().filter(d => d.depth > 0) as ExtendedHierarchyNode[];

        // Initialize current state for all nodes
        this.nodes.forEach(d => {
            d.current = { x0: d.x0, x1: d.x1, y0: d.y0, y1: d.y1 };
        });

        this.renderChart();
        this.updateLegend();
        this.updateBreadcrumbs(this.root);
    }


    private getColorScheme(scheme: string): readonly string[] {
        switch (scheme) {
            case 'category10':
                return d3.schemeCategory10;
            case 'pastel1':
                return d3.schemePastel1;
            case 'set3':
                return d3.schemeSet3;
            case 'tableau10':
            default:
                return d3.schemeTableau10;
        }
    }

    private clearVisualization(): void {
        this.g.selectAll('*').remove();
        this.legend.selectAll('*').remove();
        this.breadcrumbs.html('');
        this.tooltip.style('opacity', 0);
    }

    private renderChart(): void {
        // Clear previous chart
        this.g.selectAll('*').remove();

        // Create path elements
        this.pathElements = this.g.selectAll<SVGPathElement, ExtendedHierarchyNode>('path')
            .data(this.nodes)
            .join('path')
            .attr('fill', d => this.getFill(d))
            .attr('d', d => this.arc(d))
            .attr('stroke', '#fff')
            .attr('stroke-width', 1)
            .style('cursor', 'pointer')
            .on('click', (event, d) => {
                this.zoomTo(d);
            })
            .on('mousemove', (event, d) => {
                this.showTooltip(event, d);
            })
            .on('mouseleave', () => this.hideTooltip());

        // Create label elements
        this.labelElements = this.g.append('g')
            .attr('pointer-events', 'none')
            .attr('text-anchor', 'middle')
            .selectAll<SVGTextElement, ExtendedHierarchyNode>('text')
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
                return name.length > 8 ? name.slice(0, 8) + '...' : name;
            });
    }

    private zoomTo(p: ExtendedHierarchyNode): void {
        if (!p) return;
        
        this.hideTooltip();
        this.currentFocus = p;
        this.updateBreadcrumbs(p);

        // Calculate target positions for all nodes
        this.root.each(d => {
            const node = d as ExtendedHierarchyNode;
            node.target = {
                x0: Math.max(0, Math.min(1, (d.x0 - p.x0) / (p.x1 - p.x0))) * 2 * Math.PI,
                x1: Math.max(0, Math.min(1, (d.x1 - p.x0) / (p.x1 - p.x0))) * 2 * Math.PI,
                y0: Math.max(0, d.y0 - p.y0),
                y1: Math.max(0, d.y1 - p.y0)
            };
        });

        const t = this.g.transition().duration(650);

        // Animate paths
        this.pathElements.transition(t)
            .tween('data', d => {
                const i = d3.interpolate(d.current, d.target);
                return (t) => (d.current = i(t));
            })
            .attrTween('d', d => () => this.arc(d));

        // Animate labels
        this.labelElements.filter(d => this.labelVisible(d.target))
            .transition(t)
            .style('visibility', 'visible')
            .attrTween('transform', d => () => this.labelTransform(d.current));

        this.labelElements.filter(d => !this.labelVisible(d.target))
            .transition(t)
            .style('visibility', 'hidden');
    }

    private showTooltip(event: MouseEvent, d: ExtendedHierarchyNode): void {
        const sequence = this.getAncestors(d).map(n => n.data.name).join(' › ');
        const value = Math.round(d.value || 0);
        
        this.tooltip
            .style('opacity', 0.96)
            .html(`${sequence}<br/>(Elements: ${value})`);
        
        const rect = this.element.getBoundingClientRect();
        this.tooltip
            .style('left', (event.clientX - rect.left) + 'px')
            .style('top', (event.clientY - rect.top) + 'px');
    }

    private hideTooltip(): void {
        this.tooltip.style('opacity', 0);
    }

    private updateLegend(): void {
        const topLevel = this.root.children || [];
        
        const legendItems = this.legend.selectAll('.legend-item')
            .data(topLevel)
            .join('div')
            .attr('class', 'legend-item')
            .style('display', 'inline-flex')
            .style('align-items', 'center')
            .style('gap', '6px')
            .style('font-size', '12px')
            .style('color', '#334155');

        legendItems.selectAll('*').remove();
        
        legendItems.append('div')
            .style('width', '40px')
            .style('height', '12px')
            .style('border-radius', '3px')
            .style('background', d => this.color(d.data.name));
        
        legendItems.append('span')
            .text(d => d.data.name);
    }

    private updateBreadcrumbs(node: ExtendedHierarchyNode): void {
        const ancestors = this.getAncestors(node);
        const sequence = ancestors.map(n => n.data.name);
        
        const crumbsHtml = sequence.map((name, i) => {
            if (i === sequence.length - 1) {
                return `<strong>${name}</strong>`;
            }
            return `<a href="#" data-depth="${i}" style="color: #0ea5e9; text-decoration: none;">${name}</a>`;
        }).join('<span style="opacity: 0.5; padding: 0 6px;">›</span>');
        
        this.breadcrumbs.html(crumbsHtml);
        
        // Add click handlers for breadcrumb navigation
        this.breadcrumbs.selectAll('a').on('click', (event) => {
            event.preventDefault();
            const depth = +(event.target as HTMLElement).getAttribute('data-depth');
            const name = (event.target as HTMLElement).textContent;
            
            // Find the target node
            const target = depth === 0 ? this.root : 
                this.nodes.find(n => n.depth === depth && n.data.name === name) || this.root;
            
            this.zoomTo(target as ExtendedHierarchyNode);
        });
    }

    private labelVisible(d: any): boolean {
        const angular = d.x1 - d.x0;
        const radial = d.y1 - d.y0;
        return angular > 0.03 && radial > 12;
    }

    private labelTransform(d: any): string {
        const x = (d.x0 + d.x1) / 2 * 180 / Math.PI;
        const y = (d.y0 + d.y1) / 2;
        return `rotate(${x - 90}) translate(${y},0) rotate(${x < 180 ? 0 : 180})`;
    }

    private getFill(d: ExtendedHierarchyNode): string {
        const topAncestor = this.getTopAncestor(d);
        const baseColor = this.color(topAncestor.data.name);
        
        // Apply depth-based lightening
        const maxDepth = this.root.height;
        const t = Math.max(0, Math.min(1, (d.depth - 1) / (maxDepth - 1 || 1)));
        return d3.interpolateLab(baseColor, '#f8fafc')(t * 0.85);
    }

    private getTopAncestor(d: ExtendedHierarchyNode): ExtendedHierarchyNode {
        return d.depth === 1 ? d : (d.ancestors().find(a => a.depth === 1) as ExtendedHierarchyNode) || d;
    }

    private getAncestors(node: ExtendedHierarchyNode): ExtendedHierarchyNode[] {
        if (node && typeof node.ancestors === 'function') {
            return node.ancestors().reverse() as ExtendedHierarchyNode[];
        }
        return [this.root];
    }

    // --- Helper methods from original implementation ---

    private formatValue(v?: number | null): string {
        if (v == null) return '';
        const abs = Math.abs(v);
        if (abs >= 1_000_000_000) return (v / 1_000_000_000).toFixed(1) + 'B';
        if (abs >= 1_000_000) return (v / 1_000_000).toFixed(1) + 'M';
        if (abs >= 1_000) return (v / 1_000).toFixed(1) + 'K';
        return String(v);
    }

    private nodeKey(d: d3.HierarchyNode<SunburstNode>): string {
        return d
            .ancestors()
            .map((a) => a.data.name)
            .reverse()
            .join('/');
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
        return parts.join(' › ');
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