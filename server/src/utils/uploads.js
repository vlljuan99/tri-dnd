export function extensionForMimeType(mimeType) {
  if (mimeType?.includes('webp')) return '.webp';
  if (mimeType?.includes('jpeg') || mimeType?.includes('jpg')) return '.jpg';
  return '.png';
}
