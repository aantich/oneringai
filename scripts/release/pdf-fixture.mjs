/** Valid offline PDF: RGB, grayscale and alpha-masked images on separate pages. */
export function imagePdfFixture() {
  const objects = [];
  const add = body => { objects.push(body); return objects.length; };
  const stream = (dictionary, data) => `${dictionary} /Length ${Buffer.byteLength(data)} >>\nstream\n${data}\nendstream`;
  add('<< /Type /Catalog /Pages 2 0 R >>'); add('');
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const pages = [];
  for (let index = 0; index < 3; index++) {
    const mask = index === 2 ? add(stream('<< /Type /XObject /Subtype /Image /Width 64 /Height 64 /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /ASCIIHexDecode', '80'.repeat(4096) + '>')) : null;
    const pixels = (index === 1 ? '50' : index === 0 ? 'FF0000' : '00FF00').repeat(4096) + '>';
    const image = add(stream(`<< /Type /XObject /Subtype /Image /Width 64 /Height 64 /ColorSpace /${index === 1 ? 'DeviceGray' : 'DeviceRGB'} /BitsPerComponent 8 /Filter /ASCIIHexDecode${mask ? ` /SMask ${mask} 0 R` : ''}`, pixels));
    const content = add(stream('<<', `BT /F1 12 Tf 20 150 Td (release-pdf-${index + 1}) Tj ET\nq 64 0 0 64 20 20 cm /Im1 Do Q`));
    pages.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 ${font} 0 R >> /XObject << /Im1 ${image} 0 R >> >> /Contents ${content} 0 R >>`));
  }
  objects[1] = `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map(page => `${page} 0 R`).join(' ')}] >>`;
  let pdf = '%PDF-1.4\n'; const offsets = [];
  objects.forEach((body, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n `).join('\n')}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf);
}
