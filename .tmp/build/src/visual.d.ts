<<<<<<< HEAD
<<<<<<< HEAD
import powerbi from "powerbi-visuals-api";
import "./../style/visual.less";
=======
import "./../style/visual.less";
import powerbi from "powerbi-visuals-api";
>>>>>>> dev
=======
/**
 * Sunburst (starburst) partition visual for Power BI Visuals SDK (pbiviz 6.1)
 * Uses D3 v7.9
 */
import powerbi from "powerbi-visuals-api";
import IVisual = powerbi.extensibility.visual.IVisual;
>>>>>>> dev
import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
export declare class Visual implements IVisual {
<<<<<<< HEAD
    private target;
    private updateCount;
    private textNode;
    private formattingSettings;
    private formattingSettingsService;
    constructor(options: VisualConstructorOptions);
    update(options: VisualUpdateOptions): void;
    /**
     * Returns properties pane formatting model content hierarchies, properties and latest formatting values, Then populate properties pane.
     * This method is called once every time we open properties pane or when the user edit any format property.
     */
    getFormattingModel(): powerbi.visuals.FormattingModel;
=======
    private host;
    private svg;
    private g;
    constructor(options: VisualConstructorOptions);
    update(options: VisualUpdateOptions): void;
<<<<<<< HEAD
    destroy(): void;
>>>>>>> dev
=======
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
>>>>>>> dev
}
