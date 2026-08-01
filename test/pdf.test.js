import test from "node:test";
import assert from "node:assert/strict";

import { createPdfFromJpeg, getPdfPageLayout } from "../js/pdf.js";

test("fits the wide map inside an A4 landscape page", () => {
  const layout = getPdfPageLayout(2754, 1398);

  assert.equal(layout.pageWidth, 841.89);
  assert.equal(layout.pageHeight, 595.28);
  assert.ok(layout.x >= 23.999);
  assert.ok(layout.y >= 23.999);
  assert.ok(layout.width <= layout.pageWidth - 47.999);
  assert.ok(layout.height <= layout.pageHeight - 47.999);
});

test("creates a PDF with an embedded JPEG stream and cross-reference table", () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  const pdf = createPdfFromJpeg(jpeg, 1, 1);
  const text = new TextDecoder("latin1").decode(pdf);

  assert.match(text, /^%PDF-1\.4/);
  assert.match(text, /\/Subtype \/Image/);
  assert.match(text, /\/Filter \/DCTDecode/);
  assert.match(text, /xref\n0 7/);
  assert.match(text, /%%EOF\n$/);
});
