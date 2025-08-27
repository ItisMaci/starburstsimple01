/**
 * Enhanced Sunburst Chart for Power BI
 * Features: Zoom functionality, breadcrumbs, tooltips, and dynamic styling
 * Based on D3 v7.9
 */
import powerbi from "powerbi-visuals-api";
import IVisual = powerbi.extensibility.visual.IVisual;
import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
export declare class Visual implements IVisual {
    private host;
    private element;
    private svg;
    private g;
    private tooltip;
    private breadcrumbs;
    private legend;
    private centerLabel;
    private selectionManager;
    private root;
    private currentFocus;
    private radius;
    private color;
    private arc;
    private nodes;
    private pathElements;
    private labelElements;
    constructor(options: VisualConstructorOptions);
    private createContainer;
    update(options: VisualUpdateOptions): void;
    private getColorScheme;
    private clearVisualization;
    private renderChart;
    private zoomTo;
    private showTooltip;
    private hideTooltip;
    private updateLegend;
    private updateBreadcrumbs;
    private labelVisible;
    private labelTransform;
    private getFill;
    private getTopAncestor;
    private getAncestors;
    private formatValue;
    private nodeKey;
    private topAncestorName;
    private pathLabel;
    /**
     * Convert Power BI matrix (rows) into a nested object suitable for d3.hierarchy.
     *
     * Notes:
     * - We preserve intermediate levels even if a node has no further children ("keep layers").
     * - Leaf node size: first numeric measure value if present; otherwise count (1).
     */
    private matrixToHierarchy;
}
