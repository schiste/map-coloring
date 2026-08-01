export const LEGEND_POSITIONS = [
  "top-left",
  "top-center",
  "top-right",
  "center-left",
  "center",
  "center-right",
  "bottom-left",
  "bottom-center",
  "bottom-right",
];

export function calculateAnchoredPosition(
  position,
  viewBox,
  itemWidth,
  itemHeight,
  options = {},
) {
  const [minX, minY, width, height] = viewBox;
  const safePosition = LEGEND_POSITIONS.includes(position) ? position : "bottom-left";
  const [vertical, horizontal] =
    safePosition === "center"
      ? ["center", "center"]
      : safePosition.split("-");
  const margin = options.margin ?? Math.min(width, height) * 0.025;
  const topInset = options.topInset ?? 0;
  const bottomInset = options.bottomInset ?? 0;

  const xByAnchor = {
    left: minX + margin,
    center: minX + (width - itemWidth) / 2,
    right: minX + width - margin - itemWidth,
  };
  const yByAnchor = {
    top: minY + margin + topInset,
    center: minY + (height - itemHeight) / 2,
    bottom: minY + height - margin - bottomInset - itemHeight,
  };

  return {
    x: xByAnchor[horizontal],
    y: yByAnchor[vertical],
  };
}

export function readableTextColor(hexColor) {
  const match = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hexColor);
  if (!match) return "#18211d";

  const [red, green, blue] = match.slice(1).map((channel) => Number.parseInt(channel, 16));
  const luminance = (red * 299 + green * 587 + blue * 114) / 1000;
  return luminance >= 150 ? "#18211d" : "#ffffff";
}
