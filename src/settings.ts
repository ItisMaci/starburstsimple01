/*
 *  Power BI Visualizations
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

"use strict";

import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";

import FormattingSettingsCard = formattingSettings.SimpleCard;
import FormattingSettingsSlice = formattingSettings.Slice;
import FormattingSettingsModel = formattingSettings.Model;

/**
 * Labels Formatting Card
 */
class LabelsCardSettings extends FormattingSettingsCard {
    show = new formattingSettings.ToggleSwitch({
        name: "show",
        displayName: "Show labels",
        value: true
    });

    fontSize = new formattingSettings.NumUpDown({
        name: "fontSize",
        displayName: "Font size",
        value: 18
    });

    name: string = "labels";
    displayName: string = "Labels";
    slices: Array<FormattingSettingsSlice> = [this.show, this.fontSize];
}

/**
 * Colors Formatting Card
 */
class ColorsCardSettings extends FormattingSettingsCard {
    colorScheme = new formattingSettings.ItemDropdown({
        name: "colorScheme",
        displayName: "Color scheme",
        items: [
            { value: "tableau10", displayName: "Tableau 10" },
            { value: "category10", displayName: "Category 10" },
            { value: "pastel1", displayName: "Pastel 1" },
            { value: "set3", displayName: "Set 3" }
        ],
        value: { value: "tableau10", displayName: "Tableau 10" }
    });

    name: string = "colors";
    displayName: string = "Colors";
    slices: Array<FormattingSettingsSlice> = [this.colorScheme];
}

/**
 * Interaction Formatting Card
 */
class InteractionCardSettings extends FormattingSettingsCard {
    enableZoom = new formattingSettings.ToggleSwitch({
        name: "enableZoom",
        displayName: "Enable zoom",
        value: true
    });

    showBreadcrumbs = new formattingSettings.ToggleSwitch({
        name: "showBreadcrumbs",
        displayName: "Show breadcrumbs",
        value: true
    });

    showTooltips = new formattingSettings.ToggleSwitch({
        name: "showTooltips",
        displayName: "Show tooltips",
        value: true
    });

    name: string = "interaction";
    displayName: string = "Interaction";
    slices: Array<FormattingSettingsSlice> = [this.enableZoom, this.showBreadcrumbs, this.showTooltips];
}

/**
* Visual settings model class
*
*/
export class VisualFormattingSettingsModel extends FormattingSettingsModel {
    // Create formatting settings model formatting cards
    labelsCard = new LabelsCardSettings();
    colorsCard = new ColorsCardSettings();
    interactionCard = new InteractionCardSettings();

    cards = [this.labelsCard, this.colorsCard, this.interactionCard];
}
