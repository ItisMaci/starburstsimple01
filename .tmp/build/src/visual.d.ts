import "./../style/visual.less";
import powerbi from "powerbi-visuals-api";
import IVisual = powerbi.extensibility.visual.IVisual;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
export declare class Visual implements IVisual {
    private rootEl;
    private visEl;
    private tooltipEl;
    private crumbsEl;
    private legendEl;
    private svg;
    private g;
    private path;
    private label;
    private layoutRoot;
    private nodesList;
    private baseR?;
    private globalScale;
    constructor(options: VisualConstructorOptions);
    private initChart;
    update(options: VisualUpdateOptions): void;
    private labelVisible;
    private labelTransform;
    private safeAncestors;
    private updateLegend;
    private updateCrumbs;
    private zoomTo;
}
