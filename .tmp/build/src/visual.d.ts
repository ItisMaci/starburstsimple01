/**
 * Sunburst (starburst) partition visual for Power BI Visuals SDK (pbiviz 6.1)
 * Uses D3 v7.9
 */
import powerbi from "powerbi-visuals-api";
import IVisual = powerbi.extensibility.visual.IVisual;
import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
export declare class Visual implements IVisual {
    private host;
    private svg;
    private g;
    constructor(options: VisualConstructorOptions);
    update(options: VisualUpdateOptions): void;
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
