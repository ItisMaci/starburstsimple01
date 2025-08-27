import "./../style/visual.less";
import powerbi from "powerbi-visuals-api";
import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
import IVisual = powerbi.extensibility.visual.IVisual;
export declare class Visual implements IVisual {
    private host;
    private rootEl;
    private legendEl;
    private crumbsEl;
    private tooltipEl;
    private svg;
    private g;
    private width;
    private height;
    private radius;
    constructor(options: VisualConstructorOptions);
    update(options: VisualUpdateOptions): void;
    private zoomTo;
    private labelVisible;
    private labelTransform;
    private updateLegend;
    private updateCrumbs;
    private showTooltip;
    private hideTooltip;
    private clear;
    destroy(): void;
}
