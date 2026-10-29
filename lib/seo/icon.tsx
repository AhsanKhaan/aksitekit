import { ImageResponse } from 'next/og';

/**
 * The starter's neutral icon (a page with three lines), drawn at build time with next/og so no image file is
 * committed. The designer replaces it with the project's own mark. The same shape is app/icon.svg.
 */
export function iconImage(size: number): ImageResponse {
  const bar = (top: number, width: number) => <div style={{ position: 'absolute', left: size * 0.24, top: size * top, width: size * width, height: size * 0.1, background: '#ffffff' }} />;
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', position: 'relative', background: '#1d4ed8', borderRadius: size * 0.2 }}>
        {bar(0.28, 0.52)}
        {bar(0.45, 0.52)}
        {bar(0.62, 0.36)}
      </div>
    ),
    { width: size, height: size },
  );
}

/** An .ico file that holds one PNG image (supported by every browser in use, and by crawlers that ask for /favicon.ico). */
export function icoFromPng(png: ArrayBuffer, size: number): Uint8Array<ArrayBuffer> {
  const body = new Uint8Array(png);
  const out = new Uint8Array(new ArrayBuffer(22 + body.length));
  const view = new DataView(out.buffer);
  view.setUint16(2, 1, true); // type: icon
  view.setUint16(4, 1, true); // one image
  out[6] = size >= 256 ? 0 : size;
  out[7] = size >= 256 ? 0 : size;
  view.setUint16(10, 1, true); // colour planes
  view.setUint16(12, 32, true); // bits per pixel
  view.setUint32(14, body.length, true);
  view.setUint32(18, 22, true); // offset of the image data
  out.set(body, 22);
  return out;
}
