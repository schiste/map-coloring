const A4_LANDSCAPE = {
  width: 841.89,
  height: 595.28,
  margin: 24,
};

export function getPdfPageLayout(imageWidth, imageHeight, page = A4_LANDSCAPE) {
  if (
    !Number.isFinite(imageWidth) ||
    !Number.isFinite(imageHeight) ||
    imageWidth <= 0 ||
    imageHeight <= 0
  ) {
    throw new RangeError("Image dimensions must be positive numbers");
  }

  const availableWidth = page.width - page.margin * 2;
  const availableHeight = page.height - page.margin * 2;
  const scale = Math.min(availableWidth / imageWidth, availableHeight / imageHeight);
  const width = imageWidth * scale;
  const height = imageHeight * scale;

  return {
    pageWidth: page.width,
    pageHeight: page.height,
    x: (page.width - width) / 2,
    y: (page.height - height) / 2,
    width,
    height,
  };
}

export function createPdfFromJpeg(jpegBytes, imageWidth, imageHeight) {
  if (!(jpegBytes instanceof Uint8Array) || jpegBytes.length === 0) {
    throw new TypeError("jpegBytes must be a non-empty Uint8Array");
  }
  if (!Number.isInteger(imageWidth) || !Number.isInteger(imageHeight)) {
    throw new TypeError("JPEG dimensions must be integers");
  }

  const layout = getPdfPageLayout(imageWidth, imageHeight);
  const content = [
    "q",
    `${format(layout.width)} 0 0 ${format(layout.height)} ${format(layout.x)} ${format(layout.y)} cm`,
    "/MapImage Do",
    "Q",
    "",
  ].join("\n");
  const contentBytes = ascii(content);

  const objects = [
    [ascii("<< /Type /Catalog /Pages 2 0 R >>")],
    [ascii("<< /Type /Pages /Kids [3 0 R] /Count 1 >>")],
    [
      ascii(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${format(layout.pageWidth)} ${format(
          layout.pageHeight,
        )}] /Resources << /XObject << /MapImage 4 0 R >> >> /Contents 5 0 R >>`,
      ),
    ],
    [
      ascii(
        `<< /Type /XObject /Subtype /Image /Width ${imageWidth} /Height ${imageHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>\nstream\n`,
      ),
      jpegBytes,
      ascii("\nendstream"),
    ],
    [
      ascii(`<< /Length ${contentBytes.length} >>\nstream\n`),
      contentBytes,
      ascii("endstream"),
    ],
    [ascii("<< /Title (Maphue world map) /Creator (Maphue) /Producer (Maphue browser export) >>")],
  ];

  const chunks = [ascii("%PDF-1.4\n%Maphue\n")];
  const offsets = [0];
  let byteLength = chunks[0].length;

  objects.forEach((objectChunks, index) => {
    offsets.push(byteLength);
    const prefix = ascii(`${index + 1} 0 obj\n`);
    const suffix = ascii("\nendobj\n");
    chunks.push(prefix, ...objectChunks, suffix);
    byteLength +=
      prefix.length +
      objectChunks.reduce((total, chunk) => total + chunk.length, 0) +
      suffix.length;
  });

  const xrefOffset = byteLength;
  const xrefRows = [
    "xref",
    `0 ${objects.length + 1}`,
    "0000000000 65535 f ",
    ...offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n `),
    "trailer",
    `<< /Size ${objects.length + 1} /Root 1 0 R /Info 6 0 R >>`,
    "startxref",
    String(xrefOffset),
    "%%EOF",
    "",
  ].join("\n");
  chunks.push(ascii(xrefRows));

  return concatenate(chunks);
}

function ascii(value) {
  return new TextEncoder().encode(value);
}

function concatenate(chunks) {
  const result = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function format(value) {
  return Number(value.toFixed(3)).toString();
}
