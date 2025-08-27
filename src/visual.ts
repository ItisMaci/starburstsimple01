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
import IVisualHost = powerbi.extensibility.visual.IVisualHost;
import ISelectionId = powerbi.visuals.ISelectionId;
import * as d3 from "d3";
type Selection<T extends d3.BaseType> = d3.Selection<T, any, any, any>;

interface CircleDatum {
  label: string;
  selectionId: ISelectionId;
  idx: number;
}

export class Visual implements IVisual {
  private host: IVisualHost;
  private svg: Selection<SVGSVGElement>;
  private container: Selection<SVGGElement>;

  constructor(options: VisualConstructorOptions) {
    this.host = options.host; // per tutorial pattern
    this.svg = d3.select(options.element)
      .append("svg")
      .classed("circleCard", true);

    this.container = this.svg.append("g").classed("container", true);
  }

  public update(options: VisualUpdateOptions): void {
    const dv = options.dataViews?.[0];
    const categorical = dv?.categorical;
    const catCol = categorical?.categories?.[0];
    const catValues = (catCol?.values ?? []) as any[];

    const width = options.viewport.width;
    const height = options.viewport.height;
    this.svg.attr("width", width).attr("height", height);

    if (!catCol || catValues.length === 0) {
      this.container.selectAll("*").remove();
      return;
    }

    // ---- transform (like the tutorial’s createSelectorDataPoints) ----
    const data: CircleDatum[] = catValues.map((v, i) => ({
      label: v == null ? "" : String(v),
      selectionId: this.host.createSelectionIdBuilder()
        .withCategory(catCol, i)
        .createSelectionId(),
      idx: i
    }));

    // ---- layout: band scale across X, centered vertically ----
    const margins = { top: 8, right: 8, bottom: 24, left: 8 };
    const innerW = Math.max(1, width - margins.left - margins.right);
    const innerH = Math.max(1, height - margins.top - margins.bottom);

    const x = d3.scaleBand<string>()
      .domain(data.map(d => d.selectionId.getKey())) // stable domain
      .range([0, innerW])
      .padding(0.2);

    const cy = margins.top + innerH / 2;
    const radius = Math.max(4, Math.min(x.bandwidth(), innerH) / 3);

    this.container.attr("transform", `translate(${margins.left},${margins.top})`);

    // ---- data join: one group per category ----
    const cards = this.container
      .selectAll<SVGGElement, CircleDatum>("g.card")
      .data(data, d => d.selectionId.getKey());

    const enter = cards.enter()
      .append("g")
      .attr("class", "card");

    enter.append("circle").attr("class", "circle");
    enter.append("text").attr("class", "textLabel");

    const merged = enter.merge(cards as any);

    merged.attr("transform", d => {
      const cx = (x(d.selectionId.getKey()) ?? 0) + x.bandwidth() / 2;
      return `translate(${cx + margins.left},${cy})`; // margins.left already applied to container; adding again is optional
    });

    merged.select<SVGCircleElement>("circle.circle")
      .attr("r", radius)
      .style("fill", "white")
      .style("fill-opacity", 0.5)
      .style("stroke", "black")
      .style("stroke-width", 2)
        .on('mousemove', (event, d) => {
            merged.select<SVGCircleElement>("circle.circle").style("fill", "black");
        })
        .on('mouseleave', (event, d) => {
            merged.select<SVGCircleElement>("circle.circle").style("fill", "white");
        });

    merged.select<SVGTextElement>("text.textLabel")
      .text(d => d.label)
      .attr("text-anchor", "middle")
      .attr("dy", radius + 14) // place text below circle
      .style("font-size", `${Math.max(10, radius / 2.8)}px`);

    cards.exit().remove();
  }

  public destroy(): void {}
}
