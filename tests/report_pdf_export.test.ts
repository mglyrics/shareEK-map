import { describe, expect, it } from 'vitest';
import { buildPdfBytesFromJpeg } from '../src/services/adminService';

describe('Admin Report PDF Builder', () => {
  it('generates a valid single-page A4 PDF with exact xref byte offsets and embedded JPEG stream', () => {
    const fakeJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0xff, 0xd9]);
    const pdfBytes = buildPdfBytesFromJpeg(fakeJpeg, 1240, 1754);

    const text = new TextDecoder('latin1').decode(pdfBytes);

    expect(text.startsWith('%PDF-1.4\n')).toBe(true);
    expect(text.endsWith('%%EOF\n')).toBe(true);
    expect(text).toContain('/Type /Catalog /Pages 2 0 R');
    expect(text).toContain('/MediaBox [0 0 595.28 841.89]');
    expect(text).toContain('/Width 1240 /Height 1754 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length 10');

    // Verify startxref points directly to 'xref'
    const startXrefMatch = text.match(/startxref\n(\d+)\n%%EOF\n$/);
    expect(startXrefMatch).not.toBeNull();
    const xrefOffset = Number(startXrefMatch![1]);
    expect(text.slice(xrefOffset, xrefOffset + 4)).toBe('xref');

    // Verify each object offset in xref points to exact 'N 0 obj'
    const xrefSection = text.slice(xrefOffset);
    const entryMatches = [...xrefSection.matchAll(/(\d{10}) 00000 n \n/g)];
    expect(entryMatches).toHaveLength(5);
    entryMatches.forEach((m, idx) => {
      const objOffset = Number(m[1]);
      expect(text.slice(objOffset, objOffset + 7)).toBe(`${idx + 1} 0 obj`);
    });
  });
});
