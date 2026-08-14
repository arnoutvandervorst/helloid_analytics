/* Minimal .xlsx reader, dependency-free. An xlsx file is a ZIP of XML parts;
   the browser (and Node 18+) ships the only non-trivial piece — raw-deflate
   decompression — as DecompressionStream, so no library is needed.

   Scope: cached cell VALUES only. Shared strings, inline strings, numbers,
   booleans and formula results (<v> next to <f>) come through; styles, number
   formats and the formulas themselves are ignored. That is exactly what the
   Nedap matrix workbook import needs: what the user sees in the grid.

   API: HR.xlsx.read(arrayBuffer) -> Promise<Map<sheetName, string[][]>>
        HR.xlsx.isZip(arrayBuffer) -> boolean
   Rows are dense arrays indexed from row 1 / column A; missing cells are ''. */
(function () {
  'use strict';

  function isZip(buf) {
    const b = new Uint8Array(buf);
    return b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 3 && b[3] === 4;
  }

  /* ---- ZIP ---------------------------------------------------------------- */

  function findEocd(view) {
    // End-of-central-directory record: scan back over the (max 64k) comment.
    const min = Math.max(0, view.byteLength - 65557);
    for (let i = view.byteLength - 22; i >= min; i--) {
      if (view.getUint32(i, true) === 0x06054b50) return i;
    }
    throw new Error('not a zip: end of central directory not found');
  }

  function entries(buf) {
    const view = new DataView(buf);
    const eocd = findEocd(view);
    const count = view.getUint16(eocd + 10, true);
    let p = view.getUint32(eocd + 16, true);
    const out = new Map();
    const dec = new TextDecoder();
    for (let i = 0; i < count; i++) {
      if (view.getUint32(p, true) !== 0x02014b50) throw new Error('zip: bad central directory entry');
      const method = view.getUint16(p + 10, true);
      const csize = view.getUint32(p + 20, true);
      const nameLen = view.getUint16(p + 28, true);
      const extraLen = view.getUint16(p + 30, true);
      const commentLen = view.getUint16(p + 32, true);
      const offset = view.getUint32(p + 42, true);
      const name = dec.decode(new Uint8Array(buf, p + 46, nameLen));
      out.set(name, { method, csize, offset });
      p += 46 + nameLen + extraLen + commentLen;
    }
    return out;
  }

  async function inflate(buf, entry) {
    const view = new DataView(buf);
    const p = entry.offset;
    if (view.getUint32(p, true) !== 0x04034b50) throw new Error('zip: bad local file header');
    const nameLen = view.getUint16(p + 26, true);
    const extraLen = view.getUint16(p + 28, true);
    const data = buf.slice(p + 30 + nameLen + extraLen, p + 30 + nameLen + extraLen + entry.csize);
    if (entry.method === 0) return new TextDecoder().decode(data);
    if (entry.method !== 8) throw new Error('zip: unsupported compression method ' + entry.method);
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    return new TextDecoder().decode(bytes);
  }

  /* ---- spreadsheet XML (regex-scanned: OOXML writers emit regular markup) -- */

  const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  function unescapeXml(s) {
    if (s.indexOf('&') === -1) return s;
    return s.replace(/&(#x?[0-9a-fA-F]+|[a-z]+);/g, (m, code) => {
      if (code[0] === '#') {
        const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return isNaN(n) ? m : String.fromCodePoint(n);
      }
      return ENT[code] !== undefined ? ENT[code] : m;
    });
  }

  // Join all <t> runs inside a fragment (plain and rich-text shared strings).
  function textRuns(xml) {
    let out = '';
    const re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g;
    let m;
    while ((m = re.exec(xml)) !== null) out += unescapeXml(m[1] || '');
    return out;
  }

  function sharedStrings(xml) {
    const out = [];
    if (!xml) return out;
    const re = /<si>([\s\S]*?)<\/si>/g;
    let m;
    while ((m = re.exec(xml)) !== null) out.push(textRuns(m[1]));
    return out;
  }

  function colIndex(ref) {
    let n = 0;
    for (let i = 0; i < ref.length; i++) {
      const c = ref.charCodeAt(i);
      if (c < 65 || c > 90) break;
      n = n * 26 + (c - 64);
    }
    return n - 1;
  }

  function sheetRows(xml, sst) {
    const rows = [];
    const rowRe = /<row [^>]*?r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g;
    const cellRe = /<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let rm;
    while ((rm = rowRe.exec(xml)) !== null) {
      const r = parseInt(rm[1], 10) - 1;
      const cells = [];
      let cm;
      while ((cm = cellRe.exec(rm[2])) !== null) {
        const attrs = cm[1];
        const body = cm[2] || '';
        const refM = /r="([A-Z]+)\d+"/.exec(attrs);
        if (!refM) continue;
        const col = colIndex(refM[1]);
        const typeM = /t="(\w+)"/.exec(attrs);
        const type = typeM ? typeM[1] : '';
        let value = '';
        if (type === 'inlineStr') {
          value = textRuns(body);
        } else {
          const vM = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(body);
          if (vM) {
            value = unescapeXml(vM[1]);
            if (type === 's') value = sst[parseInt(value, 10)] || '';
            else if (type === 'b') value = value === '1' ? 'TRUE' : 'FALSE';
          }
        }
        if (value !== '') cells[col] = value;
      }
      if (cells.length) {
        for (let i = 0; i < cells.length; i++) if (cells[i] === undefined) cells[i] = '';
        rows[r] = cells;
      }
    }
    for (let i = 0; i < rows.length; i++) if (rows[i] === undefined) rows[i] = [];
    return rows;
  }

  /* ---- workbook ----------------------------------------------------------- */

  async function read(buf) {
    const zip = entries(buf);
    const need = async name => {
      const e = zip.get(name);
      if (!e) throw new Error('xlsx: missing part ' + name);
      return inflate(buf, e);
    };
    const opt = async name => (zip.get(name) ? inflate(buf, zip.get(name)) : '');

    const wbXml = await need('xl/workbook.xml');
    const relsXml = await need('xl/_rels/workbook.xml.rels');
    const sst = sharedStrings(await opt('xl/sharedStrings.xml'));

    const rels = new Map();
    const relRe = /<Relationship [^>]*?Id="([^"]+)"[^>]*?Target="([^"]+)"[^>]*?\/?>/g;
    let m;
    while ((m = relRe.exec(relsXml)) !== null) rels.set(m[1], m[2]);

    const sheets = new Map();
    const sheetRe = /<sheet [^>]*?\/>/g;
    while ((m = sheetRe.exec(wbXml)) !== null) {
      const tag = m[0];
      const name = /name="([^"]+)"/.exec(tag);
      const rid = /r:id="([^"]+)"/.exec(tag);
      if (!name || !rid || !rels.has(rid[1])) continue;
      let target = rels.get(rid[1]).replace(/^\//, '');
      if (target.indexOf('xl/') !== 0) target = 'xl/' + target;
      const entry = zip.get(target);
      if (!entry) continue;
      sheets.set(unescapeXml(name[1]), sheetRows(await inflate(buf, entry), sst));
    }
    return sheets;
  }

  window.HR = window.HR || {};
  window.HR.xlsx = { read, isZip };
})();
