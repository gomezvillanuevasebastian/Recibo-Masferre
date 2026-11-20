"""Convierte el Excel RP06-24 (códigos de barras por clave) en data/catalogo.json para la app.
Uso: python3 build_catalog.py RP06-24.xlsx app/data/catalogo.json
"""
import sys, json, openpyxl
src, dst = sys.argv[1], sys.argv[2]
wb = openpyxl.load_workbook(src, read_only=True)
ws = wb.worksheets[0]
claves = {}   # clave -> [descripcion, marca]
codigos = {}  # barcode -> [[clave, unidad, piezas], ...]
for r in ws.iter_rows(min_row=2, values_only=True):
    if r[0] is None:
        continue
    try:
        k = int(r[0])
    except (TypeError, ValueError):
        continue
    desc = str(r[2] or '').strip()
    desc = ' '.join(desc.split())
    claves.setdefault(k, [desc, str(r[5] or '').strip()])
    bc = str(r[16] or '').strip()
    if not bc:
        continue
    pz = r[10]
    try:
        pz = float(pz)
        pz = int(pz) if pz == int(pz) else round(pz, 4)
    except (TypeError, ValueError):
        pz = 1
    codigos.setdefault(bc, []).append([k, str(r[7] or '').strip(), pz])
out = {'v': 1, 'claves': claves, 'codigos': codigos}
with open(dst, 'w', encoding='utf-8') as f:
    json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
print(len(claves), 'claves', len(codigos), 'códigos')
