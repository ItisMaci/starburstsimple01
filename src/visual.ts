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
// visual.ts
// Power BI Custom Visual: Sunburst (D3)
// ------------------------------------------------------------
// This file implements a D3 sunburst adapted from the provided
// script, packaged as a Power BI custom visual 'visual.ts'.
// It renders static sample data (from the prompt) so you can
// verify layout/interaction without a data binding yet.
// ------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* eslint-disable @typescript-eslint/ban-ts-comment */

"use strict";

import "./../style/visual.less";

import * as d3 from "d3";
import powerbi from "powerbi-visuals-api";

import IVisual = powerbi.extensibility.visual.IVisual;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;

type Domain = { domain_id: number; domain_name: string };
type Ebene2 = { level_id: number; level_name: string; parent_id: number };
type Ebene3 = { level_id: number; level_name: string; parent_id: number };
type Ebene4 = { level_id: number; level_name: string; parent_id: number };

type Raw = {
  domains: Domain[];
  ebene2: Ebene2[];
  ebene3: Ebene3[];
  ebene4: Ebene4[];
};

type Depth = 1 | 2 | 3 | 4;
type NodeMeta = { depth: Depth };

type NodeData = {
  name: string;
  value?: number;
  children?: NodeData[];
  __meta?: NodeMeta;
};

type ArcDatum = { x0: number; x1: number; y0: number; y1: number };

type SunburstNode = d3.HierarchyRectangularNode<NodeData> & {
  current?: ArcDatum;
  target?: ArcDatum;
};

// -----------------------------
// 0) Sample Source Data (static)
// -----------------------------
const raw: Raw = {
  domains: [
    { domain_id: 1, domain_name: "Bauen und Wohnen" },
    { domain_id: 2, domain_name: "Bevölkerung und Gesellschaft" },
    { domain_id: 3, domain_name: "Bildung" },
    { domain_id: 4, domain_name: "Politik" },
    { domain_id: 5, domain_name: "Sicherheit und Ordnung" },
    { domain_id: 6, domain_name: "Soziales" },
    { domain_id: 7, domain_name: "Stadtraum" },
    { domain_id: 8, domain_name: "Umwelt" },
    { domain_id: 9, domain_name: "Verwaltung" },
    { domain_id: 10, domain_name: "Wirtschaft und Arbeit" }
  ],
  ebene2: [
    { level_id: 1, level_name: "Bauwerke", parent_id: 1 },
    { level_id: 2, level_name: "Einwanderung und Staatsbürgerschaft", parent_id: 2 },
    { level_id: 3, level_name: "Natürliche Person", parent_id: 2 },
    { level_id: 4, level_name: "Staatentabelle", parent_id: 2 },
    { level_id: 5, level_name: "Schulen der Stadt Wien", parent_id: 3 },
    { level_id: 6, level_name: "WiBi", parent_id: 3 },
    { level_id: 7, level_name: "Wahlen", parent_id: 4 },
    { level_id: 8, level_name: "Verwaltungsstrafen", parent_id: 5 },
    { level_id: 9, level_name: "Kinder- und Jugendhilfe", parent_id: 6 },
    { level_id: 10, level_name: "Adressen", parent_id: 7 },
    { level_id: 11, level_name: "Immobilienmanagement", parent_id: 7 },
    { level_id: 12, level_name: "Immobilienverwaltung MA10", parent_id: 7 },
    { level_id: 13, level_name: "Internet of Things (IoT)", parent_id: 7 },
    { level_id: 14, level_name: "Inventar im öffentlichen Raum", parent_id: 7 },
    { level_id: 15, level_name: "MA34", parent_id: 7 },
    { level_id: 16, level_name: "Vermessung-Geobasis", parent_id: 7 },
    { level_id: 17, level_name: "Öffentliche Beleuchtung und Verkehrslichtsignalanlagen", parent_id: 7 },
    { level_id: 18, level_name: "Österreichisches Adressregister", parent_id: 7 },
    { level_id: 19, level_name: "Abfallsammlung", parent_id: 8 },
    { level_id: 20, level_name: "Energie", parent_id: 8 },
    { level_id: 21, level_name: "Klimaschutz", parent_id: 8 },
    { level_id: 22, level_name: "Bildung und Jugend", parent_id: 9 },
    { level_id: 23, level_name: "Elektronische Aktenführung", parent_id: 9 },
    { level_id: 24, level_name: "Finanzen", parent_id: 9 },
    { level_id: 25, level_name: "Förderungen", parent_id: 9 },
    { level_id: 26, level_name: "IKT Basis", parent_id: 9 },
    { level_id: 27, level_name: "Organisation", parent_id: 9 },
    { level_id: 28, level_name: "Personal", parent_id: 9 },
    { level_id: 29, level_name: "Produkt- und Leistungsrechnung", parent_id: 9 },
    { level_id: 30, level_name: "Wien Leuchtet", parent_id: 9 },
    { level_id: 31, level_name: "Gewerberecht und gewerbliche Betriebsanlagenverfahren", parent_id: 10 },
    { level_id: 32, level_name: "Unternehmensregister", parent_id: 10 }
  ],
  ebene3: [
    { level_id: 1, level_name: "Anlieferungsdaten Gebäude", parent_id: 1 },
    { level_id: 2, level_name: "Bauverfahren", parent_id: 1 },
    { level_id: 3, level_name: "Bauwerke Bestand", parent_id: 1 },
    { level_id: 4, level_name: "Bauwerke gemeinsame Definitionen", parent_id: 1 },
    { level_id: 5, level_name: "Flächen und Mieten", parent_id: 1 },
    { level_id: 6, level_name: "MA36", parent_id: 1 },
    { level_id: 7, level_name: "MA37", parent_id: 1 },
    { level_id: 8, level_name: "Staatsbürgerschaft", parent_id: 2 },
    { level_id: 9, level_name: "Zentrales Melderegister", parent_id: 3 },
    { level_id: 10, level_name: "Zentrales Personenstandsregister", parent_id: 3 },
    { level_id: 11, level_name: "Betrieb Wiener Schulen", parent_id: 5 },
    { level_id: 12, level_name: "Schulgebäude und -objekte", parent_id: 5 },
    { level_id: 13, level_name: "Schulpersonalia", parent_id: 5 },
    { level_id: 14, level_name: "Schüler*innen", parent_id: 5 },
    { level_id: 15, level_name: "Vorhaben (Schulen)", parent_id: 5 },
    { level_id: 16, level_name: "Parkraumüberwachung Außendienst", parent_id: 8 },
    { level_id: 17, level_name: "VWST Aufgaben", parent_id: 8 },
    { level_id: 18, level_name: "VWST Basis Daten Verlauf", parent_id: 8 },
    { level_id: 19, level_name: "VWST Buchungscontainer", parent_id: 8 },
    { level_id: 20, level_name: "VWST Forderungsbewegung", parent_id: 8 },
    { level_id: 21, level_name: "(Test) Soziale Arbeit", parent_id: 9 },
    { level_id: 22, level_name: "Genehmigung Kindertagesbetreuung", parent_id: 9 },
    { level_id: 23, level_name: "Psychologischer Dienst und Inklusion", parent_id: 9 },
    { level_id: 24, level_name: "Rechtsvertretung", parent_id: 9 },
    { level_id: 25, level_name: "Soziale Arbeit", parent_id: 9 },
    { level_id: 26, level_name: "Sozialpädagogik", parent_id: 9 },
    { level_id: 27, level_name: "Aktive Liegenschaftsverwaltung", parent_id: 11 },
    { level_id: 28, level_name: "Behördliche Vorgänge", parent_id: 11 },
    { level_id: 29, level_name: "Erwerb und Veräußerung von Liegenschaften", parent_id: 11 },
    { level_id: 30, level_name: "Grundbuchsaktivitäten", parent_id: 11 },
    { level_id: 31, level_name: "Immobilienstrategie", parent_id: 11 },
    { level_id: 32, level_name: "Kleingarten", parent_id: 11 },
    { level_id: 33, level_name: "Unterstützungsleistungen", parent_id: 11 },
    { level_id: 34, level_name: "Zentrale Evidenz", parent_id: 11 },
    { level_id: 35, level_name: "Verkehrszeichen & Wegweiser", parent_id: 14 },
    { level_id: 36, level_name: "Werbeträger", parent_id: 14 },
    { level_id: 37, level_name: "Elektrotechnische Assets", parent_id: 17 },
    { level_id: 38, level_name: "Mechanische Assets", parent_id: 17 },
    { level_id: 39, level_name: "Verkehrslichtsignalanlagen", parent_id: 17 },
    { level_id: 40, level_name: "Fahrzeugverwaltung", parent_id: 19 },
    { level_id: 41, level_name: "Leitstand Altwarenverkauf", parent_id: 19 },
    { level_id: 42, level_name: "Leitstand Mistplätze", parent_id: 19 },
    { level_id: 43, level_name: "Energie-Geodaten", parent_id: 20 },
    { level_id: 44, level_name: "Energiedatenmanagement", parent_id: 20 },
    { level_id: 45, level_name: "Erzeugungsanlagen in Wien", parent_id: 20 },
    { level_id: 46, level_name: "SECAP", parent_id: 21 },
    { level_id: 47, level_name: "Wetter", parent_id: 21 },
    { level_id: 48, level_name: "Förderungen Bildung und Jugend", parent_id: 22 },
    { level_id: 49, level_name: "Organisatorische Einheiten", parent_id: 23 },
    { level_id: 50, level_name: "Anlagenverwaltung", parent_id: 24 },
    { level_id: 51, level_name: "Beteiligungsmanagement", parent_id: 24 },
    { level_id: 52, level_name: "Darlehensverwaltung", parent_id: 24 },
    { level_id: 53, level_name: "Haftungen", parent_id: 24 },
    { level_id: 54, level_name: "Kassenverwaltung", parent_id: 24 },
    { level_id: 55, level_name: "Leasing", parent_id: 24 },
    { level_id: 56, level_name: "Marktfolge", parent_id: 24 },
    { level_id: 57, level_name: "Weitere Ansatzbeziehungen", parent_id: 24 },
    { level_id: 58, level_name: "Weitere Buchungskreisbeziehungen", parent_id: 24 },
    { level_id: 59, level_name: "Weitere Gruppenbeziehungen", parent_id: 24 },
    { level_id: 60, level_name: "Weitere Sachkontenbeziehungen", parent_id: 24 },
    { level_id: 61, level_name: "Beteiligte Personen", parent_id: 25 },
    { level_id: 62, level_name: "Fördersummen", parent_id: 25 },
    { level_id: 63, level_name: "Geförderte Wohneinheiten MA 50", parent_id: 25 },
    { level_id: 64, level_name: "Transparenzdatenbank", parent_id: 25 },
    { level_id: 65, level_name: "Wohngeld", parent_id: 25 },
    { level_id: 66, level_name: "Anforderungen", parent_id: 26 },
    { level_id: 67, level_name: "Arbeitssammlung", parent_id: 26 },
    { level_id: 68, level_name: "Berechtigungsvergabe EDWH", parent_id: 26 },
    { level_id: 69, level_name: "Fachliche Metadaten", parent_id: 26 },
    { level_id: 70, level_name: "Gewerbeinformationen", parent_id: 26 },
    { level_id: 71, level_name: "Identity Management (IKTORG)", parent_id: 26 },
    { level_id: 72, level_name: "MA01 Leistungsabrechnung", parent_id: 26 },
    { level_id: 73, level_name: "MA01 interne Leistungen & Services", parent_id: 26 },
    { level_id: 74, level_name: "Metrik Vault", parent_id: 26 },
    { level_id: 75, level_name: "Nutzungs-Auswertungen", parent_id: 26 },
    { level_id: 76, level_name: "Qualitätssicherung im EDWH", parent_id: 26 },
    { level_id: 77, level_name: "Sag's Wien App", parent_id: 26 },
    { level_id: 78, level_name: "Telefonabrechnung", parent_id: 26 },
    { level_id: 79, level_name: "Vorhabens- und Projektabwicklung", parent_id: 26 },
    { level_id: 80, level_name: "Personalaufwand", parent_id: 28 },
    { level_id: 81, level_name: "Steuertabellen - Bruttobezugsliste", parent_id: 28 },
    { level_id: 82, level_name: "E-Mobilität Standards", parent_id: 30 },
    { level_id: 83, level_name: "Verkehrslichtsignalanlagen  (Verwaltung)", parent_id: 30 },
    { level_id: 84, level_name: "Öffentliche Beleuchtung (Verwaltung)", parent_id: 30 },
    { level_id: 85, level_name: "Gewerbeverfahren", parent_id: 31 }
  ],
  ebene4: [
    { level_id: 1, level_name: "Weitere Schülerattribute", parent_id: 14 },
    { level_id: 2, level_name: "Vermögensverwaltung", parent_id: 24 },
    { level_id: 3, level_name: "0 - Konfiguration", parent_id: 62 },
    { level_id: 4, level_name: "1 - Standarddienststellen", parent_id: 62 },
    { level_id: 5, level_name: "2 - MA 50 - Wohnbauförderungen", parent_id: 62 },
    { level_id: 6, level_name: "3 - MA 11 - Essenszuschüsse", parent_id: 62 },
    { level_id: 7, level_name: "80 - Förderfallstatus", parent_id: 62 },
    { level_id: 8, level_name: "81 - Wirkungsorientierte Kennzahlen", parent_id: 62 },
    { level_id: 9, level_name: "99 - Dimensionen", parent_id: 62 },
    { level_id: 10, level_name: "Auszahlungsabwicklung (Wohngeld)", parent_id: 65 },
    { level_id: 11, level_name: "Beteiligte Personen (Wohngeld)", parent_id: 65 },
    { level_id: 12, level_name: "Beschaffungsaufträge & Bestellanforderungen", parent_id: 66 },
    { level_id: 13, level_name: "Katalogsysteme", parent_id: 66 },
    { level_id: 14, level_name: "Vendormanagement", parent_id: 66 },
    { level_id: 15, level_name: "Vorhaben", parent_id: 66 },
    { level_id: 16, level_name: "Dienstpostensteuerung MA 01", parent_id: 67 },
    { level_id: 17, level_name: "Allgemeine Datenobjekte", parent_id: 69 },
    { level_id: 18, level_name: "DX Organisation", parent_id: 69 },
    { level_id: 19, level_name: "Datennutzungskatalog", parent_id: 69 },
    { level_id: 20, level_name: "Fachdatenmodell", parent_id: 69 },
    { level_id: 21, level_name: "Kennzahlenkatalog", parent_id: 69 },
    { level_id: 22, level_name: "Referenzdatenmodell", parent_id: 69 },
    { level_id: 23, level_name: "Business Servicekatalog", parent_id: 73 },
    { level_id: 24, level_name: "Finanzmanagement MA01", parent_id: 73 },
    { level_id: 25, level_name: "Incidents", parent_id: 73 },
    { level_id: 26, level_name: "Interne Revision", parent_id: 73 },
    { level_id: 27, level_name: "Wahlkartenmonitoring", parent_id: 73 },
    { level_id: 28, level_name: "E-Control Ladestellenverzeichnis", parent_id: 82 },
    { level_id: 29, level_name: "EV Charging Station", parent_id: 82 },
    { level_id: 30, level_name: "Open Data Hub", parent_id: 82 },
    { level_id: 31, level_name: "WIEN ENERGIE E-LADESTELLE OGD", parent_id: 82 },
    { level_id: 32, level_name: "Budgetär", parent_id: 84 },
    { level_id: 33, level_name: "EAZV", parent_id: 84 },
    { level_id: 34, level_name: "Einbautenabfrage MA 33", parent_id: 84 },
    { level_id: 35, level_name: "Mitbenutzung MA 33", parent_id: 84 },
    { level_id: 36, level_name: "Protokoll (Wien leuchtet)", parent_id: 84 },
    { level_id: 37, level_name: "Auslaufende Gewerbefunktionen", parent_id: 85 },
    { level_id: 38, level_name: "Ausländische Gewerbeinhaber*innen", parent_id: 85 },
    { level_id: 39, level_name: "Zentrale Referenzen (Gewerbeverfahren)", parent_id: 85 }
  ]
};

// -----------------------------
// 1) Build hierarchy
// -----------------------------
function buildHierarchy(rawData: Raw): NodeData {
  const e4ByParent = new Map<number, Ebene4[]>();
  for (const n of rawData.ebene4) {
    if (!e4ByParent.has(n.parent_id)) e4ByParent.set(n.parent_id, []);
    e4ByParent.get(n.parent_id)!.push(n);
  }

  const e3ByParent = new Map<number, Ebene3[]>();
  for (const n of rawData.ebene3) {
    if (!e3ByParent.has(n.parent_id)) e3ByParent.set(n.parent_id, []);
    e3ByParent.get(n.parent_id)!.push(n);
  }

  const e2ByDomain = new Map<number, Ebene2[]>();
  for (const n of rawData.ebene2) {
    if (!e2ByDomain.has(n.parent_id)) e2ByDomain.set(n.parent_id, []);
    e2ByDomain.get(n.parent_id)!.push(n);
  }

  const domains: NodeData[] = rawData.domains.map((d): NodeData => {
    const e2s = e2ByDomain.get(d.domain_id) ?? [];
    const childrenLvl2: NodeData[] = e2s.map((l2): NodeData => {
      const e3s = e3ByParent.get(l2.level_id) ?? [];
      const childrenLvl3: NodeData[] = e3s.map((l3): NodeData => {
        const e4s = e4ByParent.get(l3.level_id) ?? [];
        const childrenLvl4: NodeData[] = e4s.map((l4): NodeData => ({
          name: l4.level_name,
          value: 1,
          __meta: { depth: 4 }
        }));
        if (childrenLvl4.length === 0) {
          return { name: l3.level_name, value: 1, __meta: { depth: 3 } };
        }
        return { name: l3.level_name, children: childrenLvl4, __meta: { depth: 3 } };
      });
      if (childrenLvl3.length === 0) {
        return { name: l2.level_name, value: 1, __meta: { depth: 2 } };
      }
      return { name: l2.level_name, children: childrenLvl3, __meta: { depth: 2 } };
    });

    if (childrenLvl2.length === 0) {
      return { name: d.domain_name, value: 1, __meta: { depth: 1 } };
    }
    return { name: d.domain_name, children: childrenLvl2, __meta: { depth: 1 } };
  });

  return { name: "Wien", children: domains };
}

// -------------------------------------------
// 2) Visual class (rendering & interactions)
// -------------------------------------------
export class Visual implements IVisual {
  private rootEl: HTMLElement;
  private visEl: HTMLElement;
  private tooltipEl: HTMLElement;
  private crumbsEl: HTMLElement;
  private legendEl: HTMLElement;

  // D3 handles
  private svg!: d3.Selection<SVGSVGElement, unknown, null, undefined>;
  private g!: d3.Selection<SVGGElement, unknown, null, undefined>;
  private path!: d3.Selection<SVGPathElement, SunburstNode, SVGGElement, unknown>;
  private label!: d3.Selection<SVGTextElement, SunburstNode, SVGGElement, unknown>;

  // Layout state
  private layoutRoot!: SunburstNode;
  private nodesList!: SunburstNode[];

  constructor(options: VisualConstructorOptions) {
    this.rootEl = options.element;

    // Container structure
    this.rootEl.classList.add("sunburst-root");

    // Controls row (crumbs + legend)
    const controls = document.createElement("div");
    controls.className = "sb-controls";
    this.rootEl.appendChild(controls);

    this.crumbsEl = document.createElement("div");
    this.crumbsEl.className = "sb-crumbs";
    controls.appendChild(this.crumbsEl);

    this.legendEl = document.createElement("div");
    this.legendEl.className = "sb-legend";
    controls.appendChild(this.legendEl);

    // Visualization container
    this.visEl = document.createElement("div");
    this.visEl.className = "sb-vis";
    this.visEl.setAttribute("role", "img");
    this.visEl.setAttribute("aria-label", "Sunburst partition - Stadt Wien");
    this.rootEl.appendChild(this.visEl);

    // Tooltip
    this.tooltipEl = document.createElement("div");
    this.tooltipEl.className = "sb-tooltip";
    this.tooltipEl.style.position = "absolute";
    this.tooltipEl.style.pointerEvents = "none";
    this.tooltipEl.style.opacity = "0";
    this.rootEl.appendChild(this.tooltipEl);

    // Minimal inline styles (also see visual.less)
    const style = document.createElement("style");
    style.textContent = `
      .sunburst-root { position: relative; font-family: "Segoe UI", system-ui, -apple-system, sans-serif; }
      .sb-controls { display:flex; justify-content:space-between; align-items:center; gap:16px; margin-bottom:8px; flex-wrap:wrap; }
      .sb-crumbs { font-size:12px; user-select:none; }
      .sb-crumbs .sep { margin: 0 6px; color:#64748b; }
      .sb-crumbs a { text-decoration:none; color:#2563eb; }
      .sb-legend { display:flex; gap:12px; flex-wrap:wrap; font-size:12px; }
      .sb-legend .key { display:flex; align-items:center; gap:6px; }
      .sb-legend .swatch { display:inline-block; width:12px; height:12px; border-radius:2px; box-shadow: inset 0 0 0 1px rgba(0,0,0,.15); }
      .sb-vis { width:100%; height:100%; position:relative; }
      .sb-tooltip { background:#111827; color:#f9fafb; padding:6px 8px; border-radius:6px; font-size:12px; box-shadow:0 2px 8px rgba(0,0,0,.25); }
      svg text { paint-order: stroke; stroke: #fff; stroke-width: 3px; stroke-linejoin: round; }
    `;
    this.rootEl.appendChild(style);

    // Init once
    this.initChart();
  }

  private initChart(): void {
    // Create svg scaffolding once; sizes are set in update()
    this.svg = d3
      .select(this.visEl)
      .append("svg")
      .attr("role", "img");

    this.g = this.svg.append("g");
  }

  public update(options: VisualUpdateOptions): void {
    const width = Math.max(0, options.viewport.width);
    const height = Math.max(0, options.viewport.height);

    // Clear SVG dimensions and set new viewbox/size
    const W = width;
    const H = height;
    const R = Math.max(10, Math.min(W, H) / 2 - 6);

    this.svg.attr("width", W).attr("height", H).attr("viewBox", [-W / 2, -H / 2, W, H].join(" "));

    // Build data (static for now)
    const data: NodeData = buildHierarchy(raw);

    // Build hierarchy & partition
    const root = d3
      .hierarchy<NodeData>(data)
      .sum((d) => d.value ?? 0)
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

    const partition = d3.partition<NodeData>().size([2 * Math.PI, R]);

    const layoutRoot = partition(root) as SunburstNode;
    const nodesList = layoutRoot.descendants().filter((d) => d.depth > 0) as SunburstNode[];

    this.layoutRoot = layoutRoot;
    this.nodesList = nodesList;

    // Color by top-level ancestor
    const color = d3.scaleOrdinal<string, string>(d3.schemeTableau10);

    const topAncestor = (d: SunburstNode): SunburstNode => {
      if (d.depth === 1) return d;
      const found = d.ancestors().find((a) => a.depth === 1) as SunburstNode | undefined;
      return found ?? d;
    };

    const getFill = (d: SunburstNode): string => {
      const base = color(topAncestor(d).data.name);
      const maxDepth = layoutRoot.height; // excluding root
      const t = Math.max(0, Math.min(1, (d.depth - 1) / Math.max(maxDepth - 1, 1)));
      return d3.interpolateLab(base, "#f8fafc")(t * 0.85);
    };

    // Arc generator uses the current/target coords during transitions
    const arc = d3
      .arc<ArcDatum>()
      .startAngle((d) => d.x0)
      .endAngle((d) => d.x1)
      .padAngle((d) => Math.min((d.x1 - d.x0) / 2, 0.003))
      .padRadius(R)
      .innerRadius((d) => d.y0)
      .outerRadius((d) => Math.max(d.y0, d.y1 - 1));

    // BIND paths
    const that = this;
    this.path = this.g
      .selectAll<SVGPathElement, SunburstNode>("path")
      .data(nodesList, (d: any) => d.data.name + "|" + d.depth)
      .join(
        (enter) =>
          enter
            .append("path")
            .attr("fill", (d) => getFill(d))
            .attr("d", (d) => arc((d as any) as ArcDatum)!)
            .attr("stroke", "#fff")
            .attr("stroke-width", 1)
            .style("cursor", "pointer")
            .on("click", function (_event: MouseEvent, d: SunburstNode) {
              that.zoomTo(d, arc);
            })
            .on("mousemove", (event: MouseEvent, d: SunburstNode) => {
              const seq = this.safeAncestors(d).map((n) => n.data.name).join(" › ");
              this.tooltipEl.style.opacity = "0.96";
              this.tooltipEl.textContent = `${seq} (Elemente: ${Math.round(d.value ?? 0)})`;
              const rect = this.rootEl.getBoundingClientRect();
              const x = event.clientX - rect.left;
              const y = event.clientY - rect.top;
              this.tooltipEl.style.left = `${x + 8}px`;
              this.tooltipEl.style.top = `${y + 8}px`;
            })
            .on("mouseleave", () => {
              this.tooltipEl.style.opacity = "0";
            }),
        (update) =>
          update
            .attr("fill", (d) => getFill(d))
            .attr("d", (d) => arc((d as any) as ArcDatum)!),
        (exit) => exit.remove()
      );

    // LABELS
    this.label = this.g
      .selectAll<SVGTextElement, SunburstNode>("text")
      .data(nodesList, (d: any) => d.data.name + "|" + d.depth)
      .join(
        (enter) =>
          enter
            .append("text")
            .attr("dy", "0.32em")
            .attr("fill", "#0f172a")
            .attr("font-size", 14)
            .attr("font-weight", 600 as any)
            .attr("text-anchor", "middle")
            .style("user-select", "none")
            .style("visibility", (d) => (this.labelVisible((d as any) as ArcDatum) ? "visible" : "hidden"))
            .attr("transform", (d) => this.labelTransform((d as any) as ArcDatum))
            .text((d) => {
              const name = d.data.name;
              return name.length > 12 ? name.slice(0, 12) + "..." : name;
            }),
        (update) =>
          update
            .style("visibility", (d) => (this.labelVisible((d as any) as ArcDatum) ? "visible" : "hidden"))
            .attr("transform", (d) => this.labelTransform((d as any) as ArcDatum))
            .text((d) => {
              const name = d.data.name;
              return name.length > 12 ? name.slice(0, 12) + "..." : name;
            }),
        (exit) => exit.remove()
      );

    // Legend + crumbs
    this.updateLegend(color);
    this.updateCrumbs(layoutRoot, arc);

    // Initial "zoom" to root (no-op but sets current targets)
    this.zoomTo(layoutRoot, arc, 0);
  }

  // ------------- Helpers -------------

  private labelVisible(d: ArcDatum): boolean {
    const a = d.x1 - d.x0;
    const r = d.y1 - d.y0;
    return a > 0.03 && r > 12; // angular and radial room
  }

  private labelTransform(d: ArcDatum): string {
    const x = ((d.x0 + d.x1) / 2) * (180 / Math.PI); // degrees
    const y = (d.y0 + d.y1) / 2;
    return `rotate(${x - 90}) translate(${y},0) rotate(${x < 180 ? 0 : 180})`;
  }

  private safeAncestors(n: SunburstNode | null | undefined): SunburstNode[] {
    if (n && typeof (n as any).ancestors === "function") {
      return (n.ancestors() as SunburstNode[]).reverse();
    }
    return [this.layoutRoot];
  }

  private updateLegend(color: d3.ScaleOrdinal<string, string>): void {
    const topLevel = (this.layoutRoot.children ?? []) as SunburstNode[];
    const legendSel = d3.select(this.legendEl);
    legendSel.selectAll("*").remove();
    legendSel
      .selectAll<HTMLDivElement, SunburstNode>("div.key")
      .data(topLevel, (d: any) => d.data.name)
      .join("div")
      .attr("class", "key")
      .html((d) => {
        const swatch = `<span class="swatch" style="background:${color(d.data.name)}"></span>`;
        return `${swatch}${d.data.name}`;
      });
  }

  private updateCrumbs(focus: SunburstNode, arc: d3.Arc<any, ArcDatum>): void {
    const seq = this.safeAncestors(focus).map((x) => x.data.name);
    this.crumbsEl.innerHTML = seq
      .map((name, i) => (i === seq.length - 1 ? `<strong>${name}</strong>` : `<a href="#" data-depth="${i}">${name}</a>`))
      .join('<span class="sep">›</span>');

    // make earlier crumbs clickable to jump back
    this.crumbsEl.querySelectorAll<HTMLAnchorElement>("a").forEach((aEl) => {
      aEl.addEventListener(
        "click",
        (e) => {
          e.preventDefault();
          const depth = Number(aEl.getAttribute("data-depth"));
          const label = aEl.textContent ?? "";
          // root is depth 0 (not in nodes), other depths match nodes
          const target =
            depth === 0
              ? this.layoutRoot
              : this.nodesList.find((nn) => nn.depth === depth && nn.data.name === label) ?? this.layoutRoot;
          this.zoomTo(target, arc);
        },
        { once: true }
      );
    });
  }

  private zoomTo(p: SunburstNode, arc: d3.Arc<any, ArcDatum>, duration: number = 650): void {
    if (!p) return;

    // Hide tooltip
    this.tooltipEl.style.opacity = "0";

    // Update crumbs
    this.updateCrumbs(p, arc);

    // Compute target positions for all nodes
    this.layoutRoot.each((d: SunburstNode) => {
      d.target = {
        x0: Math.max(0, Math.min(1, (d.x0 - p.x0) / (p.x1 - p.x0))) * 2 * Math.PI,
        x1: Math.max(0, Math.min(1, (d.x1 - p.x0) / (p.x1 - p.x0))) * 2 * Math.PI,
        y0: Math.max(0, d.y0 - p.y0),
        y1: Math.max(0, d.y1 - p.y0)
      };
    });

    const t = this.g.transition().duration(duration);

    // Transition paths
    this.path
      // @ts-ignore
      .transition(t)
      .tween("data", (d: SunburstNode) => {
        const i = d3.interpolate<ArcDatum>(
          d.current ?? { x0: d.x0, x1: d.x1, y0: d.y0, y1: d.y1 },
          d.target!
        );
        return (tt: number) => {
          d.current = i(tt);
        };
      })
      .attrTween("d", (d: SunburstNode) => () => arc(d.current!)!);

    // Show/hide labels based on final position; animate transforms
    this.label
      .filter((d: SunburstNode) => !!d.target && this.labelVisible(d.target))
      // @ts-ignore
      .transition(t)
      .style("visibility", "visible")
      .attrTween("transform", (d: SunburstNode) => () => this.labelTransform(d.current!));

    this.label
      .filter((d: SunburstNode) => !d.target || !this.labelVisible(d.target))
      // @ts-ignore
      .transition(t)
      .style("visibility", "hidden");
  }
}
