# Recibo de mercancía Masferre (prototipo)

App web instalable (PWA) para recibir mercancía de Truper/Sanver contra la factura.

## Cómo funciona
1. **Cargar factura**: PDF de Sanver o XML del CFDI. La app arma la lista de partidas (clave = COD.INT).
2. **Escanear**: con escáner universal (USB/Bluetooth, modo teclado) o con la cámara. Cada lectura suma; si se escanea una caja/empaque, suma las piezas que trae según el Excel RP06-24.
3. **Manual**: teclear clave (o buscar por descripción) y cantidad.
4. **Terminar**: resumen de faltantes, sobrantes y productos sin factura; se acepta con nombre de quien recibe y se puede descargar CSV o compartir por WhatsApp.

Todo se guarda en el equipo y funciona sin internet después de abrirla la primera vez.

## Publicarla
Necesita un sitio con HTTPS (para la cámara y para instalarla). Cualquier hosting estático sirve: GitHub Pages, Netlify, o un servidor propio. Sube el contenido de esta carpeta tal cual.
En Android: abrir el enlace en Chrome → menú ⋮ → "Instalar app" / "Agregar a pantalla principal".

## Actualizar el catálogo de códigos
Cuando cambie el Excel RP06-24:
```
python3 herramientas/build_catalog.py "RP06-24 Codigo de barras por truper.xlsx" data/catalogo.json
```
y volver a subir la carpeta. Cambia `VERSION` en `sw.js` para que los equipos tomen la versión nueva.

## Probar en la computadora
```
python3 -m http.server 8000
```
y abrir http://localhost:8000
