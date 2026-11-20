// Entrada de códigos: escáner universal (funciona como teclado) y cámara

// Los escáneres USB/Bluetooth "teclean" el código muy rápido y terminan con Enter.
export function escucharEscaner(alLeer, activo) {
  let buf = '';
  let ultimo = 0;
  let timer = null;
  const terminar = () => {
    const c = buf.trim();
    buf = '';
    if (c.length >= 4) alLeer(c, 'escaner');
  };
  document.addEventListener('keydown', e => {
    if (!activo()) return;
    const t = e.target;
    // Si el usuario está escribiendo en un campo, no interceptar
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') && !t.dataset.escaner) return;
    const ahora = Date.now();
    if (ahora - ultimo > 300) buf = '';
    ultimo = ahora;
    clearTimeout(timer);
    if (e.key === 'Enter' || e.key === 'Tab') {
      if (buf) { e.preventDefault(); terminar(); }
      return;
    }
    if (e.key.length === 1) {
      buf += e.key;
      e.preventDefault();
      // Algunos escáneres no mandan Enter: cerrar al dejar de recibir caracteres
      timer = setTimeout(() => { if (buf.length >= 8) terminar(); }, 120);
    }
  }, true);
}

// ---------- Cámara ----------
let stream = null;
let corriendo = false;
let lectorZX = null;

export async function abrirCamara(video, alLeer) {
  cerrarCamara();
  corriendo = true;
  let ultimoCodigo = '', ultimoT = 0;
  const entregar = c => {
    const ahora = Date.now();
    if (c === ultimoCodigo && ahora - ultimoT < 2000) return;
    ultimoCodigo = c; ultimoT = ahora;
    alLeer(c, 'camara');
  };
  const formatos = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'qr_code'];
  if ('BarcodeDetector' in window) {
    const soportados = await window.BarcodeDetector.getSupportedFormats().catch(() => []);
    const fmts = formatos.filter(f => soportados.includes(f));
    if (fmts.length) {
      const det = new window.BarcodeDetector({ formats: fmts });
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false,
      });
      video.srcObject = stream;
      await video.play();
      const ciclo = async () => {
        if (!corriendo) return;
        try {
          const r = await det.detect(video);
          if (r.length) entregar(r[0].rawValue);
        } catch { /* cuadro sin imagen todavía */ }
        setTimeout(ciclo, 150);
      };
      ciclo();
      return;
    }
  }
  // Respaldo: ZXing (para equipos sin lector nativo)
  if (!window.ZXing) throw new Error('Este equipo no permite leer códigos con la cámara.');
  lectorZX = new window.ZXing.BrowserMultiFormatReader();
  await lectorZX.decodeFromConstraints(
    { video: { facingMode: { ideal: 'environment' } }, audio: false }, video,
    (res) => { if (res && corriendo) entregar(res.getText()); }
  );
}

export function cerrarCamara() {
  corriendo = false;
  if (lectorZX) { try { lectorZX.reset(); } catch {} lectorZX = null; }
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
}

// ---------- Sonidos y vibración ----------
let ctx = null;
export function sonido(tipo) {
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    const tonos = { ok: [[1400, 0.09]], completo: [[1200, 0.08], [1700, 0.12]], aviso: [[700, 0.15], [700, 0.15]], error: [[260, 0.35]] }[tipo] || [[1000, 0.1]];
    let t = ctx.currentTime;
    for (const [f, d] of tonos) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = tipo === 'error' ? 'square' : 'sine';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.25, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + d);
      o.connect(g).connect(ctx.destination);
      o.start(t); o.stop(t + d);
      t += d + 0.05;
    }
  } catch { /* sin audio */ }
  if (navigator.vibrate) navigator.vibrate(tipo === 'error' ? [200, 80, 200] : tipo === 'aviso' ? [120, 60, 120] : 40);
}
