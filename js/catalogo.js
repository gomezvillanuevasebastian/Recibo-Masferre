// Catálogo de códigos de barras (generado del Excel RP06-24)
let cat = null;
let porCodigo = null;   // código normalizado -> [[clave, unidad, piezas], ...]
let porClave = null;    // clave -> [[codigo, unidad, piezas], ...]

const norm = c => String(c).trim().replace(/\s+/g, '').replace(/^0+(?=\d)/, '');

export async function cargarCatalogo() {
  if (cat) return cat;
  const r = await fetch('data/catalogo.json');
  if (!r.ok) throw new Error('No se pudo cargar el catálogo de códigos.');
  cat = await r.json();
  porCodigo = new Map();
  porClave = new Map();
  for (const [codigo, lista] of Object.entries(cat.codigos)) {
    const n = norm(codigo);
    const prev = porCodigo.get(n);
    porCodigo.set(n, prev ? prev.concat(lista) : lista);
    for (const [clave, unidad, piezas] of lista) {
      const k = String(clave);
      if (!porClave.has(k)) porClave.set(k, []);
      porClave.get(k).push([codigo, unidad, piezas]);
    }
  }
  return cat;
}

export const totalClaves = () => (cat ? Object.keys(cat.claves).length : 0);
export const totalCodigos = () => (porCodigo ? porCodigo.size : 0);

export function buscarCodigo(codigo) {
  return porCodigo?.get(norm(codigo)) || [];
}

export function infoClave(clave) {
  const k = norm(clave);
  const c = cat?.claves[k];
  return c ? { clave: k, desc: c[0], marca: c[1], codigos: porClave.get(k) || [] } : null;
}

// Cuántas "unidades de factura" equivale un código escaneado.
// Ej.: factura en BOLSA, se escanea el EMPAQUE de 150 bolsas -> suma 150.
export function factor(clave, unidadEscaneada, piezasEscaneadas, unidadFactura) {
  const lista = porClave?.get(String(clave)) || [];
  const palabras = String(unidadFactura || '').toUpperCase().split(/[^A-ZÑ0-9]+/);
  const base = lista.find(([, u]) => u && palabras.includes(u.toUpperCase()));
  const pzBase = base ? Number(base[2]) : 1;
  if (!pzBase) return 1;
  const f = Number(piezasEscaneadas || 1) / pzBase;
  return Math.round(f * 10000) / 10000;
}
