import { Visual } from "../../src/visual";
import powerbiVisualsApi from "powerbi-visuals-api";
import IVisualPlugin = powerbiVisualsApi.visuals.plugins.IVisualPlugin;
import VisualConstructorOptions = powerbiVisualsApi.extensibility.visual.VisualConstructorOptions;
import DialogConstructorOptions = powerbiVisualsApi.extensibility.visual.DialogConstructorOptions;
var powerbiKey: any = "powerbi";
var powerbi: any = window[powerbiKey];
var starburstsimple0195D57F49CDC347B7B59E21750C972DF4_DEBUG: IVisualPlugin = {
    name: 'starburstsimple0195D57F49CDC347B7B59E21750C972DF4_DEBUG',
    displayName: 'starburst_simple_01',
    class: 'Visual',
    apiVersion: '5.3.0',
    create: (options?: VisualConstructorOptions) => {
        if (Visual) {
            return new Visual(options);
        }
        throw 'Visual instance not found';
    },
    createModalDialog: (dialogId: string, options: DialogConstructorOptions, initialState: object) => {
        const dialogRegistry = (<any>globalThis).dialogRegistry;
        if (dialogId in dialogRegistry) {
            new dialogRegistry[dialogId](options, initialState);
        }
    },
    custom: true
};
if (typeof powerbi !== "undefined") {
    powerbi.visuals = powerbi.visuals || {};
    powerbi.visuals.plugins = powerbi.visuals.plugins || {};
    powerbi.visuals.plugins["starburstsimple0195D57F49CDC347B7B59E21750C972DF4_DEBUG"] = starburstsimple0195D57F49CDC347B7B59E21750C972DF4_DEBUG;
}
export default starburstsimple0195D57F49CDC347B7B59E21750C972DF4_DEBUG;