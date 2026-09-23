// Writes the export of the recorded France map (legend, title, credit), as
// Maphue builds it, for test/rsvg/check.sh to render.
import { mkdirSync, writeFileSync } from "node:fs";
import { buildExportSvg } from "../../js/svg-export.js";
import { mountedFrance } from "../helpers.js";

const out = new URL("./out/", import.meta.url);
mkdirSync(out, { recursive: true });
const { svg, ctx } = mountedFrance();
writeFileSync(new URL("france-export.svg", out), buildExportSvg(svg, ctx, (node) => node.toString()));
console.log("wrote test/rsvg/out/france-export.svg");
