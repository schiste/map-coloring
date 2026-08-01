/**
 * Return the next palette index for a country.
 *
 * `currentIndex` is null when the country has no color.
 * Return null if the country should become uncolored.
 */
export function getNextColorIndex(currentIndex, paletteLength) {
  if (!Number.isInteger(paletteLength) || paletteLength < 2) {
    throw new RangeError("paletteLength must be an integer of at least 2");
  }

  if (currentIndex === null) return 0;
  if (!Number.isInteger(currentIndex) || currentIndex < 0 || currentIndex >= paletteLength) {
    throw new RangeError("currentIndex must be null or a valid palette index");
  }

  return currentIndex === paletteLength - 1 ? null : currentIndex + 1;
}
