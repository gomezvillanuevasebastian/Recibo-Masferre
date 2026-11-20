// Lectura de facturas: PDF (formato Sanver) y XML CFDI 4.0 / 3.3
import * as pdfjs from '../vendor/pdf.min.mjs';
pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.min.mjs', import.meta.url).href;

const num = s => parseFloat(String(s).replace(/[$,\s]/g, '')) || 0;
const clean = s => String(s || '').replace(/\s+/g, ' ').trim();

export async function leerFactura(file) {
  const nombre = file.name.toLowerCase();
  const buf = await file.arrayBuffer();
  if (nombre.endsWith('.xml')) return leerXML(new TextDecoder('utf-8').decode(buf));
  const head = new Uint8Array(buf.slice(0, 5));
  if (String.fromCharCode(...head) === '%PDF-') return leerPDF(buf);
  const txt = new TextDecoder('utf-8').decode(buf);
  if (txt.includes('Comprobante')) return leerXML(txt);
  throw new Error('El archivo no es un PDF ni un XML de factura.');
}

// ---------- XML CFDI ----------
export function leerXML(texto) {
  const doc = new DOMParser().parseFromString(texto, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('El XML no se pudo leer.');
  const byLocal = (root, name) => Array.from(root.getElementsByTagName('*')).filter(e => e.localName === name);
  const comp = byLocal(doc, 'Comprobante')[0];
  if (!comp) throw new Error('El XML no es un CFDI.');
  const emisor = byLocal(doc, 'Emisor')[0];
  const receptor = byLocal(doc, 'Receptor')[0];
  const timbre = byLocal(doc, 'TimbreFiscalDigital')[0];
  const partidas = byLocal(doc, 'Concepto').map(c => {
    const cod = (c.getAttribute('NoIdentificacion') || '').trim();
    return {
      cod: cod.replace(/^0+(?=\d)/, ''),
      codTxt: cod,
      desc: clean(c.getAttribute('Descripcion')),
      marca: '',
      unidad: clean(c.getAttribute('Unidad') || c.getAttribute('ClaveUnidad')),
      sol: num(c.getAttribute('Cantidad')),
      precio: num(c.getAttribute('ValorUnitario')),
      importe: num(c.getAttribute('Importe')),
    };
  });
  return {
    origen: 'xml',
    folio: clean((comp.getAttribute('Serie') || '') + '-' + (comp.getAttribute('Folio') || '')).replace(/^-|-$/g, ''),
    fecha: (comp.getAttribute('Fecha') || '').slice(0, 10),
    emisor: clean(emisor?.getAttribute('Nombre')),
    sucursal: clean(receptor?.getAttribute('Nombre')),
    subtotal: num(comp.getAttribute('SubTotal')),
    total: num(comp.getAttribute('Total')),
    uuid: timbre?.getAttribute('UUID') || '',
    partidas: unir(partidas),
  };
}

// ---------- PDF ----------
const COLS = [
  ['cant', /^CANT\.?$/], ['sat', /^CLAVE$/], ['desc', /^DESCRIPCION$/], ['marca', /^MARCA$/],
  ['unidad', /^UNIDAD$/], ['cod', /^COD\.?INT$/], ['precio', /^P\.?UNITARIO$/], ['importe', /^IMPORTE$/],
];

export async function leerPDF(buf, onProgreso) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), isEvalSupported: false }).promise;
  const partidas = [];
  let textoTodo = '';
  let cols = null;
  for (let p = 1; p <= doc.numPages; p++) {
    onProgreso?.(p, doc.numPages);
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const items = tc.items
      .filter(it => it.str && it.str.trim())
      .map(it => ({ s: it.str.trim(), x: it.transform[4], y: it.transform[5], w: it.width }));
    // Agrupar en renglones por coordenada Y
    items.sort((a, b) => b.y - a.y || a.x - b.x);
    const filas = [];
    for (const it of items) {
      const f = filas.find(r => Math.abs(r.y - it.y) < 2.2);
      if (f) f.items.push(it); else filas.push({ y: it.y, items: [it] });
    }
    filas.sort((a, b) => b.y - a.y);
    for (const f of filas) f.items.sort((a, b) => a.x - b.x);
    textoTodo += filas.map(f => f.items.map(i => i.s).join('  ')).join('\n') + '\n';

    // Encabezado de columnas de esta página
    const enc = filas.find(f => f.items.some(i => /^COD\.?INT$/.test(i.s)) && f.items.some(i => /^CANT\.?$/.test(i.s)));
    if (enc) {
      cols = COLS.map(([k, re]) => {
        const it = enc.items.find(i => re.test(i.s));
        return it ? { k, x: it.x } : null;
      }).filter(Boolean).sort((a, b) => a.x - b.x);
    }
    if (!cols) continue;
    const colDe = x => {
      let c = cols[0].k;
      for (const col of cols) if (x >= col.x - 14) c = col.k;
      return c;
    };
    let pend = null;
    const encY = enc ? enc.y : 9999;
    for (const f of filas) {
      if (f.y >= encY) continue;
      const r = {};
      for (const it of f.items) {
        const k = colDe(it.x);
        r[k] = r[k] ? r[k] + ' ' + it.s : it.s;
      }
      const esInicio = r.cant && /^[\d,]+\.\d+$/.test(r.cant.trim()) && r.sat && /^\d{6,8}$/.test(r.sat.trim());
      const tieneCod = r.cod && /^\d{4,8}$/.test(r.cod.trim());
      if (esInicio) {
        if (pend && pend.cod) partidas.push(pend);
        pend = {
          sol: num(r.cant), sat: r.sat.trim(), desc: clean(r.desc), marca: clean(r.marca),
          unidad: clean(r.unidad), codTxt: tieneCod ? r.cod.trim() : '', precio: num(r.precio), importe: num(r.importe),
        };
        pend.cod = pend.codTxt.replace(/^0+(?=\d)/, '');
        if (pend.cod) { partidas.push(pend); pend = null; }
      } else if (pend && tieneCod) {
        // Renglón partido en dos: completar con la continuación
        pend.codTxt = r.cod.trim();
        pend.cod = pend.codTxt.replace(/^0+(?=\d)/, '');
        if (r.marca) pend.marca = clean(r.marca);
        if (r.unidad) pend.unidad = clean(r.unidad);
        if (r.desc) pend.desc = clean(pend.desc + ' ' + r.desc);
        pend.precio = num(r.precio) || pend.precio;
        pend.importe = num(r.importe) || pend.importe;
        partidas.push(pend); pend = null;
      } else if (pend && (r.marca || r.unidad)) {
        if (r.marca && !pend.marca) pend.marca = clean(r.marca);
      } else if (!esInicio && (/SUBTOTAL|ESTE DOCUMENTO/.test(f.items.map(i => i.s).join(' ')))) {
        pend = null;
      }
    }
    if (pend && pend.cod) { partidas.push(pend); pend = null; }
  }
  if (!partidas.length) throw new Error('No encontré partidas en el PDF. ¿Es una factura de Sanver?');
  const m = (re) => (textoTodo.match(re) || [])[1] || '';
  for (const p of partidas) p.desc = p.desc.replace(/\s+K$/, '');
  return {
    origen: 'pdf',
    folio: m(/\b([A-Z]{1,4}-\d{5,})\b/),
    fecha: m(/\b(\d{1,2}\/[A-Za-z]{3}\/\d{4})\b/),
    emisor: clean(textoTodo.split('\n').find(l => /SANVER|S\.A\./.test(l)) ? 'SANVER FORTE' : ''),
    sucursal: clean(m(/CONSIGNAR A:[^\n]*\n[^\n]*?(SUCURSAL [A-Z0-9 ]+)/) || m(/ZONA:\s*([^\n]+)/)),
    subtotal: num(m(/SUBTOTAL\s+(\$[\d,]+\.\d\d)/)),
    total: num(m(/(?<!SUB)TOTAL\s+(\$[\d,]+\.\d\d)/)),
    uuid: m(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i),
    partidas: unir(partidas),
  };
}

// Si la misma clave viene en varias partidas, se suman en una sola
function unir(lista) {
  const mapa = new Map();
  for (const p of lista) {
    const k = p.cod || p.codTxt;
    const prev = mapa.get(k);
    if (prev) { prev.sol += p.sol; prev.importe += p.importe; prev.lineas++; }
    else mapa.set(k, { ...p, lineas: 1 });
  }
  return [...mapa.values()];
}
