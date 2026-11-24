import zlib from 'node:zlib';

// A small .pptx writer: text boxes, rectangles and pictures on 16:9 slides. No dependencies.
// Enough for review decks that Google Drive converts to Google Slides on upload.

export const SLIDE_W = 12192000; // EMU (13.333 in)
export const SLIDE_H = 6858000; // EMU (7.5 in)
export const emu = (inches) => Math.round(inches * 914400);

// ---- zip (deflate, with Node's built-in CRC32) ----
export function zip(files) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const { name, data } of files) {
    const raw = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
    const packed = zlib.deflateRawSync(raw);
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = zlib.crc32(raw);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(0x0800, 6); // UTF-8 names
    head.writeUInt16LE(8, 8); // deflate
    head.writeUInt32LE(0, 10); // time/date
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(packed.length, 18);
    head.writeUInt32LE(raw.length, 22);
    head.writeUInt16LE(nameBuf.length, 26);
    head.writeUInt16LE(0, 28);
    locals.push(head, nameBuf, packed);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0x0800, 8);
    cen.writeUInt16LE(8, 10);
    cen.writeUInt32LE(0, 12);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(packed.length, 20);
    cen.writeUInt32LE(raw.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt32LE(offset, 42);
    central.push(cen, nameBuf);
    offset += head.length + nameBuf.length + packed.length;
  }
  const cenBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cenBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cenBuf, end]);
}

// ---- slide parts ----
// XML 1.0 forbids most control characters (Slides uses \v for soft line breaks): drop them.
const esc = (s) => String(s ?? '').replace(/[\u000b]/g, ' ').replace(/[\u0000-\u0008\u000c\u000e-\u001f\ufffe\uffff]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const xfrm = (x, y, w, h) => `<a:xfrm><a:off x="${Math.round(x)}" y="${Math.round(y)}"/><a:ext cx="${Math.round(w)}" cy="${Math.round(h)}"/></a:xfrm>`;

/**
 * Text box. `text` may be a string or an array of paragraphs; each paragraph is a string or
 * { text, bold, color, size } (size in points). Defaults: 12 pt, dark grey.
 */
function textShape(id, el) {
  const paras = (Array.isArray(el.text) ? el.text : [el.text]).map((p) => (typeof p === 'string' ? { text: p } : p));
  const runs = paras
    .map((p) => {
      const size = Math.round((p.size ?? el.size ?? 12) * 100);
      const color = (p.color ?? el.color ?? '333333').replace('#', '');
      const bold = p.bold ?? el.bold ? ' b="1"' : '';
      const algn = el.align ? ` algn="${el.align}"` : '';
      return `<a:p><a:pPr${algn}/><a:r><a:rPr lang="en-GB" sz="${size}"${bold} dirty="0"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:latin typeface="${esc(el.font ?? 'Arial')}"/></a:rPr><a:t>${esc(p.text)}</a:t></a:r></a:p>`;
    })
    .join('');
  const fill = el.fill ? `<a:solidFill><a:srgbClr val="${el.fill.replace('#', '')}"/></a:solidFill>` : '<a:noFill/>';
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Text ${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(el.x, el.y, el.w, el.h)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${fill}</p:spPr><p:txBody><a:bodyPr wrap="square" lIns="45720" rIns="45720" tIns="27432" bIns="27432" anchor="${el.anchor ?? 't'}"><a:normAutofit/></a:bodyPr><a:lstStyle/>${runs}</p:txBody></p:sp>`;
}

function rectShape(id, el) {
  const line = el.line ? `<a:ln w="${el.lineWidth ?? 12700}"><a:solidFill><a:srgbClr val="${el.line.replace('#', '')}"/></a:solidFill></a:ln>` : '<a:ln><a:noFill/></a:ln>';
  const fill = el.fill ? `<a:solidFill><a:srgbClr val="${el.fill.replace('#', '')}"/></a:solidFill>` : '<a:noFill/>';
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Shape ${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(el.x, el.y, el.w, el.h)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${fill}${line}</p:spPr></p:sp>`;
}

function picShape(id, el, rid) {
  return `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="Picture ${id}"${el.title ? ` descr="${esc(el.title)}"` : ''}/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xfrm(el.x, el.y, el.w, el.h)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
}

const THEME = `${XML}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Studio"><a:themeElements><a:clrScheme name="Studio"><a:dk1><a:srgbClr val="1A1A1A"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="333333"/></a:dk2><a:lt2><a:srgbClr val="F4F2EE"/></a:lt2><a:accent1><a:srgbClr val="2F6F8F"/></a:accent1><a:accent2><a:srgbClr val="C98A3C"/></a:accent2><a:accent3><a:srgbClr val="6B8F71"/></a:accent3><a:accent4><a:srgbClr val="8F5B6B"/></a:accent4><a:accent5><a:srgbClr val="5B6B8F"/></a:accent5><a:accent6><a:srgbClr val="8F8F5B"/></a:accent6><a:hlink><a:srgbClr val="2F6F8F"/></a:hlink><a:folHlink><a:srgbClr val="5B6B8F"/></a:folHlink></a:clrScheme><a:fontScheme name="Studio"><a:majorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Studio"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;

const MASTER = `${XML}<p:sldMaster ${NS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`;
const LAYOUT = `${XML}<p:sldLayout ${NS} type="blank" preserve="1"><p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;
const rels = (items) => `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items.map(([id, type, target]) => `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/>`).join('')}</Relationships>`;

/**
 * Builds a .pptx. slides: [{ background?: hex, elements: [ {type:'text'|'rect'|'image', x,y,w,h (EMU), ...} ] }].
 * Images: { type:'image', data: Buffer, ext: 'jpg'|'png', ... }.
 */
export function buildPptx({ slides, title = 'Deck', width = SLIDE_W, height = SLIDE_H }) {
  const files = [];
  const media = [];
  const slideXml = slides.map((s, si) => {
    const srels = [['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml']];
    let id = 2;
    const shapes = s.elements
      .map((el) => {
        if (el.type === 'text') return textShape(id++, el);
        if (el.type === 'rect') return rectShape(id++, el);
        if (el.type === 'image') {
          const name = `image${media.length + 1}.${el.ext === 'png' ? 'png' : 'jpg'}`;
          media.push({ name, data: el.data });
          const rid = `rId${srels.length + 1}`;
          srels.push([rid, 'image', `../media/${name}`]);
          return picShape(id++, el, rid);
        }
        return '';
      })
      .join('');
    const bg = s.background ? `<p:bg><p:bgPr><a:solidFill><a:srgbClr val="${s.background.replace('#', '')}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>` : '';
    files.push({ name: `ppt/slides/_rels/slide${si + 1}.xml.rels`, data: rels(srels) });
    return `${XML}<p:sld ${NS}><p:cSld>${bg}<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${shapes}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
  });
  slideXml.forEach((x, i) => files.push({ name: `ppt/slides/slide${i + 1}.xml`, data: x }));
  for (const m of media) files.push({ name: `ppt/media/${m.name}`, data: m.data });

  const types = `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpg" ContentType="image/jpeg"/><Default Extension="png" ContentType="image/png"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>${slides.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('')}</Types>`;
  const pres = `${XML}<p:presentation ${NS}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 3}"/>`).join('')}</p:sldIdLst><p:sldSz cx="${width}" cy="${height}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`;
  const presRels = rels([['rId1', 'slideMaster', 'slideMasters/slideMaster1.xml'], ['rId2', 'theme', 'theme/theme1.xml'], ...slides.map((_, i) => [`rId${i + 3}`, 'slide', `slides/slide${i + 1}.xml`])]);
  const core = `${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${esc(title)}</dc:title></cp:coreProperties>`;

  return zip([
    { name: '[Content_Types].xml', data: types },
    { name: '_rels/.rels', data: `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>` },
    { name: 'docProps/core.xml', data: core },
    { name: 'ppt/presentation.xml', data: pres },
    { name: 'ppt/_rels/presentation.xml.rels', data: presRels },
    { name: 'ppt/slideMasters/slideMaster1.xml', data: MASTER },
    { name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels', data: rels([['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'], ['rId2', 'theme', '../theme/theme1.xml']]) },
    { name: 'ppt/slideLayouts/slideLayout1.xml', data: LAYOUT },
    { name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels', data: rels([['rId1', 'slideMaster', '../slideMasters/slideMaster1.xml']]) },
    { name: 'ppt/theme/theme1.xml', data: THEME },
    ...files,
  ]);
}
