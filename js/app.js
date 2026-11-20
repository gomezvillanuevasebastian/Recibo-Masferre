import { leerFactura } from './factura.js';
import { cargarCatalogo, buscarCodigo, infoClave, factor, totalClaves } from './catalogo.js';
import { escucharEscaner, abrirCamara, cerrarCamara, sonido } from './escaner.js';

const $ = (s, r = document) => r.querySelector(s);
const app = $('#app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dinero = n => '$' + Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cant = n => { const r = Math.round(Number(n || 0) * 1000) / 1000; return r.toLocaleString('es-MX', { maximumFractionDigits: 3 }); };
const hoy = () => new Date().toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' });

// ---------------- Almacenamiento local ----------------
const ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { aviso('No se pudo guardar en el equipo (memoria llena).', 'error'); return false; } },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};
const lista = () => ls.get('recepciones', []);
const leer = id => ls.get('rec:' + id, null);
function guardar(r) {
  r.actualizada = Date.now();
  ls.set('rec:' + r.id, r);
  const l = lista().filter(x => x !== r.id);
  l.unshift(r.id);
  ls.set('recepciones', l);
}
function borrar(id) { ls.del('rec:' + id); ls.set('recepciones', lista().filter(x => x !== id)); }
const prefs = () => ls.get('prefs', { nombre: '', sucursal: '' });

// ---------------- Cálculos ----------------
function avance(r) {
  const total = r.partidas.length;
  let completas = 0, faltan = 0, sobran = 0, pzSol = 0, pzRec = 0;
  for (const p of r.partidas) {
    pzSol += p.sol; pzRec += p.rec;
    if (p.rec >= p.sol - 1e-6) completas++;
    if (p.rec < p.sol - 1e-6) faltan++;
    if (p.rec > p.sol + 1e-6) sobran++;
  }
  const extras = r.extras.length;
  return { total, completas, pendientes: total - completas, faltan, sobran, extras, pzSol, pzRec, pct: total ? Math.floor((completas / total) * 100) : 0 };
}
const estadoPartida = p => (p.rec > p.sol + 1e-6 ? 'sobra' : p.rec >= p.sol - 1e-6 ? 'completa' : p.rec > 0 ? 'parcial' : 'pendiente');

// ---------------- UI compartida ----------------
let toastT = null;
function aviso(msg, tipo = 'info') {
  const t = $('#toast');
  t.className = 'toast ' + tipo;
  t.textContent = msg;
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.add('oculto'), 3000);
}
function modal(html, alMontar) {
  const m = $('#modal');
  m.innerHTML = `<div class="modal-caja">${html}</div>`;
  m.classList.remove('oculto');
  m.onclick = e => { if (e.target === m || e.target.closest('[data-cerrar]')) cerrarModal(); };
  alMontar?.(m);
}
function cerrarModal() { const m = $('#modal'); m.classList.add('oculto'); m.innerHTML = ''; }
const modalAbierto = () => !$('#modal').classList.contains('oculto');

function ir(hash) { if (location.hash === hash) render(); else location.hash = hash; }

// ---------------- Rutas ----------------
let vista = { nombre: 'inicio' };
window.addEventListener('hashchange', render);

function render() {
  cerrarCamara();
  const h = location.hash.replace(/^#\/?/, '').split('/');
  if (h[0] === 'r' && h[1]) {
    const r = leer(h[1]);
    if (!r) { ir('#/'); return; }
    if (h[2] === 'detalle') return vistaDetalle(r);
    if (h[2] === 'resumen') return vistaResumen(r);
    if (r.estado === 'cerrada') return vistaResumen(r);
    return vistaEscaneo(r);
  }
  vistaInicio();
}

// ================= INICIO =================
let pestana = 'pendientes';
function vistaInicio() {
  vista = { nombre: 'inicio' };
  const recs = lista().map(leer).filter(Boolean);
  const abiertas = recs.filter(r => r.estado !== 'cerrada');
  const cerradas = recs.filter(r => r.estado === 'cerrada');
  const mostrar = pestana === 'pendientes' ? abiertas : cerradas;
  app.innerHTML = `
    <header class="barra-logo">
      <img src="img/masferre.png" alt="Masferre" class="logo">
      <div class="titulo-app">Recibo de mercancía<small>Proveedor Truper</small></div>
      <button class="icono" id="btnInfo" aria-label="Información">ⓘ</button>
    </header>
    <main class="contenido">
      <button class="btn grande primario" id="btnCargar">
        <span class="ico">＋</span> Cargar factura (PDF o XML)
      </button>
      <div class="segmentos">
        <button class="${pestana === 'pendientes' ? 'activo' : ''}" data-tab="pendientes">Por recibir (${abiertas.length})</button>
        <button class="${pestana === 'recibidas' ? 'activo' : ''}" data-tab="recibidas">Recibidas (${cerradas.length})</button>
      </div>
      ${mostrar.length ? mostrar.map(tarjeta).join('') : vacio(pestana)}
    </main>`;
  $('#btnCargar').onclick = () => $('#archivo').click();
  $('#btnInfo').onclick = infoApp;
  app.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { pestana = b.dataset.tab; vistaInicio(); });
  app.querySelectorAll('[data-abrir]').forEach(b => b.onclick = () => ir('#/r/' + b.dataset.abrir));
  app.querySelectorAll('[data-borrar]').forEach(b => b.onclick = () => confirmarBorrar(b.dataset.borrar));
}

function tarjeta(r) {
  const a = avance(r);
  const cerrada = r.estado === 'cerrada';
  return `
    <article class="tarjeta ${cerrada ? (a.faltan || a.sobran || a.extras ? 'con-dif' : 'ok') : 'abierta'}">
      <h3>Factura ${esc(r.folio || 'sin folio')}</h3>
      <div class="dato">Fecha factura: <b>${esc(r.fecha)}</b></div>
      <div class="dato">Sucursal: <b>${esc(r.sucursal || '-')}</b></div>
      <div class="dato">Importe facturado: <b>${dinero(r.total)}</b></div>
      <div class="dato">Recepción de partidas: <b>${a.completas} de ${a.total}</b></div>
      <div class="progreso"><div style="width:${a.pct}%"></div></div>
      <div class="dato">Pendientes: <b>${a.pendientes}</b>${a.sobran ? ` · Con sobrante: <b>${a.sobran}</b>` : ''}${a.extras ? ` · No facturados: <b>${a.extras}</b>` : ''}</div>
      ${cerrada ? `<div class="dato">Recibió: <b>${esc(r.recibio)}</b> · ${esc(r.cerradaTxt)}</div>` : ''}
      <div class="acciones">
        <button class="btn ${cerrada ? 'secundario' : 'primario'}" data-abrir="${r.id}">${cerrada ? 'Ver reporte' : r.log.length ? 'Continuar' : 'Empezar a recibir'}</button>
        ${cerrada ? '' : `<button class="btn texto" data-borrar="${r.id}">Eliminar</button>`}
      </div>
    </article>`;
}

function vacio(tab) {
  return `<div class="vacio">
    <img src="img/chambitas.png" alt="" class="chambitas">
    <p>${tab === 'pendientes' ? '¡Hola! Carga la factura que llegó con el camión para empezar a recibir.' : 'Aquí verás las recepciones terminadas.'}</p>
  </div>`;
}

function infoApp() {
  modal(`<h2>Recibo de mercancía</h2>
    <p>Catálogo cargado: <b>${totalClaves().toLocaleString('es-MX')}</b> claves con código de barras.</p>
    <p>Para usar un escáner de código de barras, conéctalo por USB o Bluetooth. Funciona como teclado: solo apunta y dispara, no necesitas tocar la pantalla.</p>
    <p class="tenue">Los datos se guardan en este equipo y la app funciona sin internet.</p>
    <button class="btn primario ancho" data-cerrar>Entendido</button>`);
}

function confirmarBorrar(id) {
  const r = leer(id);
  modal(`<h2>¿Eliminar recepción?</h2>
    <p>Se borrará la factura ${esc(r.folio)} y todo lo escaneado en este equipo.</p>
    <div class="fila-btn"><button class="btn secundario" data-cerrar>Cancelar</button>
    <button class="btn peligro" id="siBorrar">Eliminar</button></div>`, m => {
    $('#siBorrar', m).onclick = () => { borrar(id); cerrarModal(); vistaInicio(); };
  });
}

// ---------- Cargar factura ----------
$('#archivo').addEventListener('change', async e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  modal(`<div class="cargando"><div class="rueda"></div><p id="msgCarga">Leyendo factura…</p></div>`);
  try {
    await cargarCatalogo();
    const fac = await leerFactura(f);
    const ya = lista().map(leer).find(r => r && ((fac.uuid && r.uuid === fac.uuid) || (r.folio === fac.folio && fac.folio)));
    if (ya) {
      cerrarModal();
      aviso('Esta factura ya estaba cargada.', 'aviso');
      ir('#/r/' + ya.id);
      return;
    }
    const r = {
      id: Date.now().toString(36),
      ...fac,
      archivo: f.name,
      creada: Date.now(),
      estado: 'abierta',
      partidas: fac.partidas.map(p => ({ ...p, rec: 0, enCatalogo: !!infoClave(p.cod) })),
      extras: [],
      log: [],
    };
    const sinCat = r.partidas.filter(p => !p.enCatalogo).length;
    guardar(r);
    cerrarModal();
    modal(`<img src="img/chambitas.png" class="chambitas chica" alt="">
      <h2>Factura ${esc(r.folio)} lista</h2>
      <p><b>${r.partidas.length}</b> partidas · <b>${cant(r.partidas.reduce((s, p) => s + p.sol, 0))}</b> piezas · ${dinero(r.total)}</p>
      ${sinCat ? `<p class="txt-aviso">${sinCat} claves no tienen código de barras en el catálogo; se capturan en modo manual.</p>` : '<p class="txt-ok">Todas las claves tienen código de barras.</p>'}
      <label class="campo">¿Quién recibe?<input id="nomRecibe" value="${esc(prefs().nombre)}" placeholder="Nombre del inventarista" autocomplete="name"></label>
      <button class="btn primario ancho grande" id="btnEmpezar">Empezar a recibir</button>`, m => {
      $('#btnEmpezar', m).onclick = () => {
        const n = $('#nomRecibe', m).value.trim();
        const rr = leer(r.id); rr.recibe = n; guardar(rr);
        ls.set('prefs', { ...prefs(), nombre: n });
        cerrarModal(); ir('#/r/' + r.id);
      };
    });
  } catch (err) {
    console.error(err);
    modal(`<h2>No se pudo leer la factura</h2><p>${esc(err.message)}</p><button class="btn primario ancho" data-cerrar>Cerrar</button>`);
  }
});

// ================= ESCANEO =================
let modo = 'escaner';
let ultimo = null;   // { tipo, titulo, sub, partida, clave, desc, codigo }
let manualSel = null;

function vistaEscaneo(r) {
  vista = { nombre: 'escaneo', id: r.id };
  const a = avance(r);
  app.innerHTML = `
    <header class="barra">
      <button class="icono" id="atras" aria-label="Regresar">←</button>
      <div class="titulo">Recepción factura ${esc(r.folio)}</div>
      <button class="icono" id="btnDeshacer" aria-label="Deshacer" title="Deshacer último" ${r.log.length ? '' : 'disabled'}>↶</button>
    </header>
    <div id="banner"></div>
    <main class="contenido escaneo">
      <section class="encabezado-rec">
        <div class="fila-esp"><span>Importe: <b>${dinero(r.total)}</b></span><span>${esc(r.sucursal)}</span></div>
        <div class="fila-esp"><span class="grande-txt">Recepción de partidas: <b id="txtAvance">${a.completas} de ${a.total}</b></span><span id="txtPct">${a.pct}%</span></div>
        <div class="progreso"><div id="barra" style="width:${a.pct}%"></div></div>
      </section>
      <div class="segmentos modos">
        <button data-modo="escaner" class="${modo === 'escaner' ? 'activo' : ''}">▥ Modo escáner</button>
        <button data-modo="camara" class="${modo === 'camara' ? 'activo' : ''}">◉ Cámara</button>
        <button data-modo="manual" class="${modo === 'manual' ? 'activo' : ''}">⌨ Manual</button>
      </div>
      <section id="zonaModo"></section>
      <section id="ultimo" class="ultimo"></section>
      <div class="pie-acciones">
        <button class="btn secundario" id="btnDetalle">Ver detalle de las partidas</button>
        <button class="btn primario" id="btnTerminar">Terminar recepción</button>
      </div>
    </main>`;
  $('#atras').onclick = () => ir('#/');
  $('#btnDetalle').onclick = () => ir(`#/r/${r.id}/detalle`);
  $('#btnTerminar').onclick = () => ir(`#/r/${r.id}/resumen`);
  $('#btnDeshacer').onclick = () => deshacer(r.id);
  app.querySelectorAll('[data-modo]').forEach(b => b.onclick = () => { modo = b.dataset.modo; vistaEscaneo(leer(r.id)); });
  pintarModo(r);
  pintarUltimo(r);
}

function pintarModo(r) {
  const z = $('#zonaModo');
  cerrarCamara();
  if (modo === 'escaner') {
    z.innerHTML = `<div class="zona-escaner">
      <div class="codigo-visual"><span id="ultCodigo">${esc(ultimo?.codigo || 'Escanea un producto')}</span></div>
      <p class="tenue">Apunta el escáner al código de barras y dispara. Cada lectura suma al conteo.</p></div>`;
  } else if (modo === 'camara') {
    z.innerHTML = `<div class="zona-camara"><video id="video" playsinline muted></video><div class="mira"></div>
      <p class="tenue" id="msgCam">Coloca el código de barras dentro del recuadro.</p></div>`;
    abrirCamara($('#video'), (c, origen) => procesarCodigo(r.id, c, origen)).catch(e => {
      $('#msgCam').textContent = 'No se pudo abrir la cámara: ' + (e.message || e.name) + '. Revisa el permiso de cámara.';
    });
  } else {
    z.innerHTML = `<div class="zona-manual">
      <label class="campo">Clave o código de barras
        <div class="fila"><input id="inClave" inputmode="numeric" autocomplete="off" placeholder="Ej. 14818">
        <button class="btn secundario" id="btnBuscar">Buscar</button></div></label>
      <div id="manualInfo"></div>
    </div>`;
    const inp = $('#inClave');
    const buscar = () => manualBuscar(r.id, inp.value);
    $('#btnBuscar').onclick = buscar;
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); buscar(); } });
    inp.addEventListener('input', () => sugerencias(r.id, inp.value));
    if (manualSel) manualMostrar(r.id, manualSel);
    setTimeout(() => inp.focus(), 50);
  }
}

function sugerencias(id, txt) {
  const q = txt.trim().toUpperCase();
  const box = $('#manualInfo');
  if (q.length < 2 || /^\d{8,}$/.test(q)) { if (!manualSel) box.innerHTML = ''; return; }
  const r = leer(id);
  const qn = q.replace(/^0+/, '');
  const res = r.partidas.filter(p => p.cod.startsWith(qn) || p.desc.toUpperCase().includes(q)).slice(0, 6);
  manualSel = null;
  box.innerHTML = res.length ? `<div class="sugerencias">${res.map(p => `
    <button data-cod="${esc(p.cod)}"><b>${esc(p.codTxt || p.cod)}</b> ${esc(p.desc)} <span class="pill ${estadoPartida(p)}">${cant(p.rec)}/${cant(p.sol)}</span></button>`).join('')}</div>` : '';
  box.querySelectorAll('[data-cod]').forEach(b => b.onclick = () => manualMostrar(id, b.dataset.cod));
}

function manualBuscar(id, txt) {
  const t = txt.trim();
  if (!t) return;
  const r = leer(id);
  // ¿Es un código de barras?
  if (t.length >= 8) {
    const ents = buscarCodigo(t);
    const e = ents.find(([k]) => r.partidas.some(p => p.cod === String(k))) || ents[0];
    if (e) return manualMostrar(id, String(e[0]));
  }
  const cod = t.replace(/^0+(?=\d)/, '');
  if (r.partidas.some(p => p.cod === cod) || infoClave(cod)) return manualMostrar(id, cod);
  sonido('error');
  $('#manualInfo').innerHTML = `<p class="txt-error">No encontré la clave ${esc(t)}.</p>`;
}

function manualMostrar(id, cod) {
  manualSel = cod;
  const r = leer(id);
  const p = r.partidas.find(x => x.cod === cod);
  const info = infoClave(cod);
  const box = $('#manualInfo');
  if (!box) return;
  box.innerHTML = `<div class="manual-prod ${p ? '' : 'no-factura'}">
    <div class="clave">${esc(p?.codTxt || cod)} ${p ? `<span class="pill ${estadoPartida(p)}">${cant(p.rec)} de ${cant(p.sol)}</span>` : '<span class="pill sobra">No viene en la factura</span>'}</div>
    <div class="desc">${esc(p?.desc || info?.desc || '')}</div>
    <div class="tenue">${esc(p?.marca || info?.marca || '')} · ${esc(p?.unidad || '')}</div>
    <div class="cantidad">
      <button class="btn redondo" id="menos">−</button>
      <input id="inCant" type="number" inputmode="decimal" min="0" step="any" value="${p ? Math.max(1, Math.min(p.sol - p.rec, 9999)) || 1 : 1}">
      <button class="btn redondo" id="mas">＋</button>
    </div>
    <button class="btn primario ancho grande" id="btnSumar">Sumar al conteo</button>
  </div>`;
  const inC = $('#inCant');
  $('#menos').onclick = () => { inC.value = Math.max(0, (parseFloat(inC.value) || 0) - 1); };
  $('#mas').onclick = () => { inC.value = (parseFloat(inC.value) || 0) + 1; };
  $('#btnSumar').onclick = () => {
    const q = parseFloat(inC.value);
    if (!(q > 0)) { aviso('Escribe una cantidad mayor a cero.', 'aviso'); return; }
    registrar(id, { cod, cantidad: q, codigo: '', origen: 'manual' });
    manualSel = null;
    const inp = $('#inClave'); if (inp) { inp.value = ''; inp.focus(); }
    $('#manualInfo').innerHTML = '';
  };
}

function procesarCodigo(id, codigo, origen) {
  if (vista.nombre !== 'escaneo' || vista.id !== id || modalAbierto()) return;
  const r = leer(id);
  const ents = buscarCodigo(codigo);
  if (!ents.length) {
    // Quizá escanearon/teclearon directamente la clave
    const cod = codigo.replace(/^0+(?=\d)/, '');
    if (r.partidas.some(p => p.cod === cod)) return registrar(id, { cod, cantidad: 1, codigo, origen });
    sonido('error');
    ultimo = { tipo: 'error', titulo: 'Código no encontrado', sub: `El código ${codigo} no está en el catálogo. Captúralo en modo manual.`, codigo };
    pintarBanner(); pintarUltimo(r);
    return;
  }
  // Preferir la clave que viene en la factura y que aún tiene pendiente
  const enFac = ents.filter(([k]) => r.partidas.some(p => p.cod === String(k)));
  let e = enFac.find(([k]) => { const p = r.partidas.find(x => x.cod === String(k)); return p.rec < p.sol; }) || enFac[0] || ents[0];
  const [clave, unidad, piezas] = e;
  const p = r.partidas.find(x => x.cod === String(clave));
  const q = p ? factor(clave, unidad, piezas, p.unidad) : Number(piezas) || 1;
  registrar(id, { cod: String(clave), cantidad: q, codigo, origen, unidadCod: unidad });
}

function registrar(id, { cod, cantidad, codigo, origen, unidadCod }) {
  const r = leer(id);
  if (r.estado === 'cerrada') return;
  const p = r.partidas.find(x => x.cod === cod);
  r.log.push({ t: Date.now(), cod, q: cantidad, c: codigo, o: origen });
  let tipo, titulo, sub;
  if (p) {
    const antes = p.rec;
    p.rec = Math.round((p.rec + cantidad) * 10000) / 10000;
    if (p.rec > p.sol + 1e-6) {
      tipo = 'aviso'; titulo = '¡Sobra mercancía!'; sub = `Recibiste ${cant(p.rec)} y la factura dice ${cant(p.sol)}.`;
    } else if (p.rec >= p.sol - 1e-6 && antes < p.sol - 1e-6) {
      tipo = 'completo'; titulo = 'Partida completa'; sub = `Clave ${p.codTxt || cod}`;
    } else {
      tipo = 'ok'; titulo = 'Partida registrada'; sub = `Clave ${p.codTxt || cod}`;
    }
    if (cantidad !== 1) sub += ` · se sumaron ${cant(cantidad)}${unidadCod ? ' (' + unidadCod.toLowerCase() + ')' : ''}`;
  } else {
    const info = infoClave(cod);
    let x = r.extras.find(e => e.cod === cod);
    if (!x) { x = { cod, desc: info?.desc || '', marca: info?.marca || '', rec: 0 }; r.extras.push(x); }
    x.rec = Math.round((x.rec + cantidad) * 10000) / 10000;
    tipo = 'error'; titulo = 'No viene en la factura'; sub = `Clave ${cod}. Sepáralo y avisa al encargado.`;
  }
  guardar(r);
  sonido(tipo);
  ultimo = { tipo, titulo, sub, cod, codigo: codigo || cod };
  if (vista.nombre === 'escaneo') {
    pintarBanner();
    actualizarCabecera(r);
    pintarUltimo(r);
    const uc = $('#ultCodigo'); if (uc) uc.textContent = codigo || cod;
    const bd = $('#btnDeshacer'); if (bd) bd.disabled = false;
    const a = avance(r);
    if (p && a.pendientes === 0 && tipo === 'completo') pedidoCompleto(r);
  }
}

function deshacer(id) {
  const r = leer(id);
  const l = r.log.pop();
  if (!l) return;
  const p = r.partidas.find(x => x.cod === l.cod);
  if (p) p.rec = Math.max(0, Math.round((p.rec - l.q) * 10000) / 10000);
  else {
    const x = r.extras.find(e => e.cod === l.cod);
    if (x) { x.rec = Math.round((x.rec - l.q) * 10000) / 10000; if (x.rec <= 0) r.extras = r.extras.filter(e => e !== x); }
  }
  guardar(r);
  ultimo = { tipo: 'info', titulo: 'Se deshizo la última lectura', sub: `Clave ${l.cod}: se restaron ${cant(l.q)}`, cod: l.cod, codigo: l.c || l.cod };
  vistaEscaneo(r);
  pintarBanner();
}

function actualizarCabecera(r) {
  const a = avance(r);
  const t = $('#txtAvance'); if (t) t.textContent = `${a.completas} de ${a.total}`;
  const pc = $('#txtPct'); if (pc) pc.textContent = a.pct + '%';
  const b = $('#barra'); if (b) b.style.width = a.pct + '%';
}

let bannerT = null;
function pintarBanner() {
  const b = $('#banner');
  if (!b || !ultimo) return;
  b.className = 'banner ' + ultimo.tipo;
  b.innerHTML = `<b>${esc(ultimo.titulo)}</b><span>${esc(ultimo.sub)}</span>`;
  clearTimeout(bannerT);
  bannerT = setTimeout(() => { b.className = 'banner oculto'; }, ultimo.tipo === 'error' || ultimo.tipo === 'aviso' ? 6000 : 2500);
}

function pintarUltimo(r) {
  const box = $('#ultimo');
  if (!box) return;
  if (!ultimo || !ultimo.cod) {
    box.innerHTML = `<div class="ultimo-vacio"><img src="img/chambitas.png" alt="" class="chambitas mini"><p>${ultimo?.tipo === 'error' ? esc(ultimo.sub) : 'Aquí aparecerá el último producto escaneado.'}</p></div>`;
    return;
  }
  const p = r.partidas.find(x => x.cod === ultimo.cod);
  const x = r.extras.find(e => e.cod === ultimo.cod);
  const info = infoClave(ultimo.cod);
  const desc = p?.desc || x?.desc || info?.desc || '';
  const est = p ? estadoPartida(p) : 'sobra';
  box.innerHTML = `
    <div class="tit">Último producto escaneado</div>
    <div class="prod ${est}">
      <div class="clave">${esc(p?.codTxt || ultimo.cod)} <span class="tenue">| ${esc(p?.marca || info?.marca || '')}</span></div>
      <div class="desc">${esc(desc)}</div>
      ${p ? `<div class="numeros">
        <div><small>Cantidad recibida</small><b>${cant(p.rec)}</b></div>
        <div><small>Cantidad solicitada</small><b>${cant(p.sol)}</b></div>
        <div class="${p.rec > p.sol ? 'rojo' : ''}"><small>${p.rec > p.sol ? 'Sobrante' : 'Cantidad pendiente'}</small><b>${cant(Math.abs(p.sol - p.rec))}</b></div>
      </div><div class="tenue">${esc(p.unidad)}</div>` : `<div class="numeros"><div class="rojo"><small>Recibido sin factura</small><b>${cant(x?.rec || 0)}</b></div></div>`}
    </div>`;
}

function pedidoCompleto(r) {
  modal(`<img src="img/chambitas.png" class="chambitas chica" alt="">
    <h2>¡Pedido completo!</h2>
    <p>Has escaneado todas las partidas de la factura ${esc(r.folio)}.</p>
    <p class="tenue">Revisa el resumen antes de aceptar la recepción. Una vez aceptada no podrás hacer cambios.</p>
    <div class="fila-btn"><button class="btn secundario" data-cerrar>Seguir revisando</button>
    <button class="btn primario" id="irResumen">Ver resumen</button></div>`, m => {
    $('#irResumen', m).onclick = () => { cerrarModal(); ir(`#/r/${r.id}/resumen`); };
  });
}

// ================= DETALLE =================
let filtro = 'pendientes';
let busqueda = '';
function vistaDetalle(r) {
  vista = { nombre: 'detalle', id: r.id };
  const a = avance(r);
  const cerrada = r.estado === 'cerrada';
  const conteo = {
    pendientes: r.partidas.filter(p => p.rec < p.sol - 1e-6).length,
    completas: r.partidas.filter(p => Math.abs(p.rec - p.sol) < 1e-6).length,
    sobrantes: r.partidas.filter(p => p.rec > p.sol + 1e-6).length + r.extras.length,
    todas: r.partidas.length,
  };
  app.innerHTML = `
    <header class="barra">
      <button class="icono" id="atras" aria-label="Regresar">←</button>
      <div class="titulo">Partidas · ${esc(r.folio)}</div><span class="badge">${a.completas}/${a.total}</span>
    </header>
    <main class="contenido">
      <input class="buscador" id="buscar" placeholder="Buscar clave o descripción" value="${esc(busqueda)}">
      <div class="segmentos chicos">
        ${['pendientes', 'completas', 'sobrantes', 'todas'].map(f => `<button data-f="${f}" class="${filtro === f ? 'activo' : ''}">${f[0].toUpperCase() + f.slice(1)} (${conteo[f]})</button>`).join('')}
      </div>
      <div id="listaPartidas" class="lista"></div>
    </main>`;
  $('#atras').onclick = () => ir(cerrada ? `#/r/${r.id}/resumen` : `#/r/${r.id}`);
  app.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { filtro = b.dataset.f; vistaDetalle(leer(r.id)); });
  const inp = $('#buscar');
  inp.oninput = () => { busqueda = inp.value; pintarLista(r); };
  pintarLista(r);
}

function pintarLista(r) {
  const q = busqueda.trim().toUpperCase();
  let ps = r.partidas;
  if (filtro === 'pendientes') ps = ps.filter(p => p.rec < p.sol - 1e-6);
  if (filtro === 'completas') ps = ps.filter(p => Math.abs(p.rec - p.sol) < 1e-6);
  if (filtro === 'sobrantes') ps = ps.filter(p => p.rec > p.sol + 1e-6);
  if (q) ps = ps.filter(p => (p.codTxt || p.cod).includes(q.replace(/^0+/, '')) || p.desc.toUpperCase().includes(q));
  let extras = filtro === 'sobrantes' || filtro === 'todas' ? r.extras : [];
  const max = 300;
  const html = ps.slice(0, max).map(p => `
    <button class="renglon ${estadoPartida(p)}" data-cod="${esc(p.cod)}">
      <div><b>${esc(p.codTxt || p.cod)}</b> <span class="tenue">${esc(p.marca)}</span><div class="desc">${esc(p.desc)}</div></div>
      <div class="cuenta"><b>${cant(p.rec)}</b><small>de ${cant(p.sol)}</small></div>
    </button>`).join('') +
    extras.map(x => `<div class="renglon sobra"><div><b>${esc(x.cod)}</b> <span class="pill sobra">Sin factura</span><div class="desc">${esc(x.desc)}</div></div><div class="cuenta"><b>${cant(x.rec)}</b><small>de 0</small></div></div>`).join('');
  $('#listaPartidas').innerHTML = html || `<div class="vacio"><p>${filtro === 'pendientes' ? '¡No hay pendientes!' : 'Sin partidas.'}</p></div>` ;
  if (ps.length > max) $('#listaPartidas').insertAdjacentHTML('beforeend', `<p class="tenue centro">Mostrando ${max} de ${ps.length}. Usa el buscador.</p>`);
  if (r.estado !== 'cerrada') {
    $('#listaPartidas').querySelectorAll('[data-cod]').forEach(b => b.onclick = () => ajustar(r.id, b.dataset.cod));
  }
}

function ajustar(id, cod) {
  const r = leer(id);
  const p = r.partidas.find(x => x.cod === cod);
  modal(`<h2>${esc(p.codTxt || p.cod)}</h2><p>${esc(p.desc)}</p>
    <p class="tenue">${esc(p.marca)} · ${esc(p.unidad)} · Facturado: <b>${cant(p.sol)}</b></p>
    <label class="campo">Cantidad recibida
      <div class="cantidad"><button class="btn redondo" id="menos">−</button>
      <input id="inCant" type="number" inputmode="decimal" min="0" step="any" value="${p.rec}">
      <button class="btn redondo" id="mas">＋</button></div></label>
    <div class="fila-btn"><button class="btn secundario" data-cerrar>Cancelar</button>
    <button class="btn primario" id="okAjuste">Guardar</button></div>`, m => {
    const inC = $('#inCant', m);
    $('#menos', m).onclick = () => { inC.value = Math.max(0, (parseFloat(inC.value) || 0) - 1); };
    $('#mas', m).onclick = () => { inC.value = (parseFloat(inC.value) || 0) + 1; };
    $('#okAjuste', m).onclick = () => {
      const v = parseFloat(inC.value);
      if (!(v >= 0)) return;
      const rr = leer(id);
      const pp = rr.partidas.find(x => x.cod === cod);
      rr.log.push({ t: Date.now(), cod, q: v - pp.rec, c: '', o: 'ajuste' });
      pp.rec = v;
      guardar(rr);
      cerrarModal();
      vistaDetalle(rr);
    };
  });
}

// ================= RESUMEN / CIERRE =================
function vistaResumen(r) {
  vista = { nombre: 'resumen', id: r.id };
  const a = avance(r);
  const cerrada = r.estado === 'cerrada';
  const faltantes = r.partidas.filter(p => p.rec < p.sol - 1e-6);
  const sobrantes = r.partidas.filter(p => p.rec > p.sol + 1e-6);
  const impFalt = faltantes.reduce((s, p) => s + (p.sol - p.rec) * p.precio, 0);
  const todoBien = !faltantes.length && !sobrantes.length && !r.extras.length;
  const tabla = (titulo, filas, clase) => filas.length ? `
    <h3 class="sec ${clase}">${titulo} (${filas.length})</h3>
    <div class="tabla">${filas.map(p => `<div class="tr"><span><b>${esc(p.codTxt || p.cod)}</b> ${esc(p.desc)}</span><span class="num">${cant(p.rec)} / ${cant(p.sol ?? 0)}</span></div>`).join('')}</div>` : '';
  app.innerHTML = `
    <header class="barra">
      <button class="icono" id="atras" aria-label="Regresar">←</button>
      <div class="titulo">${cerrada ? 'Reporte de recepción' : 'Terminar recepción'}</div>
    </header>
    <main class="contenido">
      <section class="resumen-cab ${todoBien ? 'ok' : 'dif'}">
        <img src="img/chambitas.png" class="chambitas chica" alt="">
        <div>
          <h2>${todoBien ? '¡Todo cuadra con la factura!' : 'Hay diferencias con la factura'}</h2>
          <p>Factura <b>${esc(r.folio)}</b> · ${esc(r.fecha)} · ${esc(r.emisor)}<br>${esc(r.sucursal)} · ${dinero(r.total)}</p>
          ${cerrada ? `<p>Recibió <b>${esc(r.recibio)}</b> el ${esc(r.cerradaTxt)}</p>` : ''}
        </div>
      </section>
      <div class="kpis">
        <div><b>${a.completas}</b><small>Completas</small></div>
        <div class="${faltantes.length ? 'rojo' : ''}"><b>${faltantes.length}</b><small>Con faltante</small></div>
        <div class="${sobrantes.length ? 'naranja' : ''}"><b>${sobrantes.length}</b><small>Con sobrante</small></div>
        <div class="${r.extras.length ? 'naranja' : ''}"><b>${r.extras.length}</b><small>No facturados</small></div>
      </div>
      <p class="centro">Piezas recibidas <b>${cant(a.pzRec)}</b> de <b>${cant(a.pzSol)}</b>${impFalt > 0.005 ? ` · Faltante aprox. <b>${dinero(impFalt)}</b> + IVA` : ''}</p>
      ${tabla('Faltantes', faltantes, 'rojo')}
      ${tabla('Sobrantes', sobrantes, 'naranja')}
      ${tabla('Recibido sin factura', r.extras.map(x => ({ ...x, sol: 0 })), 'naranja')}
      ${cerrada ? `
        <div class="fila-btn">
          <button class="btn secundario" id="btnCSV">Descargar Excel (CSV)</button>
          <button class="btn secundario" id="btnCompartir">Compartir</button>
          <button class="btn secundario" id="btnImprimir">Imprimir</button>
        </div>
        <button class="btn texto ancho" id="btnDetalle">Ver todas las partidas</button>` : `
        <label class="campo">Nombre de quien recibe<input id="nomRecibe" value="${esc(r.recibe || prefs().nombre)}" placeholder="Nombre del inventarista"></label>
        <label class="campo">Observaciones (opcional)<textarea id="obs" rows="2" placeholder="Ej. caja dañada, faltó una tarima…">${esc(r.obs || '')}</textarea></label>
        <div class="fila-btn">
          <button class="btn secundario" id="btnSeguir">Seguir escaneando</button>
          <button class="btn primario" id="btnAceptar">Aceptar recepción</button>
        </div>`}
    </main>`;
  $('#atras').onclick = () => ir(cerrada ? '#/' : `#/r/${r.id}`);
  if (cerrada) {
    $('#btnCSV').onclick = () => descargarCSV(r);
    $('#btnCompartir').onclick = () => compartir(r);
    $('#btnImprimir').onclick = () => window.print();
    $('#btnDetalle').onclick = () => { filtro = 'todas'; ir(`#/r/${r.id}/detalle`); };
  } else {
    $('#btnSeguir').onclick = () => ir(`#/r/${r.id}`);
    $('#btnAceptar').onclick = () => {
      const nom = $('#nomRecibe').value.trim();
      if (!nom) { aviso('Escribe el nombre de quien recibe.', 'aviso'); $('#nomRecibe').focus(); return; }
      const obs = $('#obs').value.trim();
      modal(`<h2>¿Aceptar la recepción?</h2>
        <p>${todoBien ? 'Todas las partidas cuadran con la factura.' : `Quedarán registradas <b>${faltantes.length}</b> partidas con faltante, <b>${sobrantes.length}</b> con sobrante y <b>${r.extras.length}</b> sin factura.`}</p>
        <p class="tenue">Una vez aceptada no podrás hacer modificaciones.</p>
        <div class="fila-btn"><button class="btn secundario" data-cerrar>Cancelar</button>
        <button class="btn primario" id="siAceptar">Aceptar</button></div>`, m => {
        $('#siAceptar', m).onclick = () => {
          const rr = leer(r.id);
          rr.estado = 'cerrada'; rr.recibio = nom; rr.obs = obs; rr.cerrada = Date.now(); rr.cerradaTxt = hoy();
          guardar(rr);
          ls.set('prefs', { ...prefs(), nombre: nom });
          cerrarModal();
          sonido('completo');
          pestana = 'recibidas';
          vistaResumen(rr);
        };
      });
    };
  }
}

function filasCSV(r) {
  const filas = [['Factura', 'Fecha factura', 'Sucursal', 'Clave', 'Descripción', 'Marca', 'Unidad', 'Facturado', 'Recibido', 'Diferencia', 'Estado', 'Precio unitario', 'Importe diferencia']];
  const nom = { completa: 'Completa', parcial: 'Faltante', pendiente: 'Faltante', sobra: 'Sobrante' };
  for (const p of r.partidas) {
    const d = Math.round((p.rec - p.sol) * 10000) / 10000;
    filas.push([r.folio, r.fecha, r.sucursal, p.codTxt || p.cod, p.desc, p.marca, p.unidad, p.sol, p.rec, d, nom[estadoPartida(p)], p.precio, (d * p.precio).toFixed(2)]);
  }
  for (const x of r.extras) filas.push([r.folio, r.fecha, r.sucursal, x.cod, x.desc, x.marca, '', 0, x.rec, x.rec, 'Sin factura', '', '']);
  return filas;
}
function descargarCSV(r) {
  const csv = '﻿' + filasCSV(r).map(f => f.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = `Recepcion_${r.folio}_${(r.sucursal || '').replace(/\W+/g, '_')}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
async function compartir(r) {
  const a = avance(r);
  const falt = r.partidas.filter(p => p.rec < p.sol - 1e-6);
  const sobr = r.partidas.filter(p => p.rec > p.sol + 1e-6);
  let txt = `Recepción factura ${r.folio} (${r.sucursal})\nRecibió: ${r.recibio} · ${r.cerradaTxt}\nPartidas completas: ${a.completas} de ${a.total}\n`;
  if (falt.length) txt += `\nFALTANTES:\n` + falt.map(p => `• ${p.codTxt || p.cod} ${p.desc}: ${cant(p.rec)} de ${cant(p.sol)}`).join('\n') + '\n';
  if (sobr.length) txt += `\nSOBRANTES:\n` + sobr.map(p => `• ${p.codTxt || p.cod} ${p.desc}: ${cant(p.rec)} de ${cant(p.sol)}`).join('\n') + '\n';
  if (r.extras.length) txt += `\nSIN FACTURA:\n` + r.extras.map(x => `• ${x.cod} ${x.desc}: ${cant(x.rec)}`).join('\n') + '\n';
  if (r.obs) txt += `\nObservaciones: ${r.obs}\n`;
  if (!falt.length && !sobr.length && !r.extras.length) txt += '\nTodo cuadra con la factura ✅';
  try {
    if (navigator.share) await navigator.share({ title: `Recepción ${r.folio}`, text: txt });
    else { await navigator.clipboard.writeText(txt); aviso('Resumen copiado. Pégalo en WhatsApp o correo.', 'ok'); }
  } catch { /* cancelado */ }
}

// ================= ARRANQUE =================
escucharEscaner((c, o) => {
  if (vista.nombre === 'escaneo') {
    if (modo === 'manual') { modo = 'escaner'; vistaEscaneo(leer(vista.id)); }
    procesarCodigo(vista.id, c, o);
  } else if (vista.nombre === 'inicio') {
    aviso('Primero abre una factura para empezar a escanear.', 'aviso');
  }
}, () => !modalAbierto() && (vista.nombre === 'escaneo' || vista.nombre === 'inicio'));

render();
cargarCatalogo().catch(e => aviso(e.message, 'error'));
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
