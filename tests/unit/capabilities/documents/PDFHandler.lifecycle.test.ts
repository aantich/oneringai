import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PDFHandler } from '../../../../src/capabilities/documents/handlers/PDFHandler.js';
import { PNG } from 'pngjs';
const wire = vi.hoisted(() => ({
  getDocumentProxy: vi.fn(), getMeta: vi.fn(), extractText: vi.fn(), extractImages: vi.fn(),
}));
vi.mock('unpdf', () => wire);
beforeEach(() => { vi.resetAllMocks(); wire.getMeta.mockResolvedValue({ info: {} }); wire.extractText.mockResolvedValue({ totalPages: 2, text: ['first', 'second'] }); wire.extractImages.mockResolvedValue([]); });
describe('PDF extraction failure and lifecycle boundaries', () => {
  it('destroys the shared proxy when text extraction fails and never transfers the caller buffer', async () => {
    const destroy = vi.fn().mockResolvedValue(undefined), buffer = Buffer.from('source');
    wire.getDocumentProxy.mockResolvedValue({ loadingTask: { destroy } }); wire.extractText.mockRejectedValue(new Error('text failure'));
    await expect(new PDFHandler().handle(buffer, 'fail.pdf', 'pdf', {})).rejects.toThrow('text failure');
    expect(destroy).toHaveBeenCalledOnce();
    const copy = wire.getDocumentProxy.mock.calls[0]![0];
    expect([...copy]).toEqual([...buffer]); expect(copy.buffer).not.toBe(buffer.buffer);
  });
  it('retains text and later-page images after metadata and one page fail, then destroys once', async () => {
    const destroy = vi.fn().mockResolvedValue(undefined), proxy = { loadingTask: { destroy } };
    wire.getDocumentProxy.mockResolvedValue(proxy); wire.getMeta.mockRejectedValue(new Error('metadata failure'));
    wire.extractImages.mockRejectedValueOnce(new Error('image failure')).mockResolvedValueOnce([{ data: new Uint8ClampedArray([1, 2, 3, 4]), channels: 4, width: 1, height: 1, key: 'second-page-image' }]);
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const pieces = await new PDFHandler().handle(Buffer.from('source'), 'partial.pdf', 'pdf', {});
      expect(pieces.filter(piece => piece.type === 'text')).toHaveLength(2);
      const images = pieces.filter(piece => piece.type === 'image'); expect(images).toHaveLength(1);
      expect([...PNG.sync.read(Buffer.from(images[0]!.base64, 'base64')).data]).toEqual([1, 2, 3, 4]);
      expect(wire.extractImages.mock.calls).toEqual([[proxy, 1], [proxy, 2]]);
      expect(warning).toHaveBeenCalledTimes(2); expect(destroy).toHaveBeenCalledOnce();
    } finally { warning.mockRestore(); }
  });
  it('skips optional metadata and images while still releasing the PDF', async () => {
    const destroy = vi.fn().mockResolvedValue(undefined); wire.getDocumentProxy.mockResolvedValue({ loadingTask: { destroy } });
    const pieces = await new PDFHandler().handle(Buffer.from('source'), 'text.pdf', 'pdf', { extractImages: false, formatOptions: { pdf: { includeMetadata: false } } });
    expect(pieces).toHaveLength(2); expect(wire.getMeta).not.toHaveBeenCalled(); expect(wire.extractImages).not.toHaveBeenCalled(); expect(destroy).toHaveBeenCalledOnce();
  });
});
