const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { db, tx } = require('./db');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------- utilidades
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, msg) => { throw new HttpError(status, msg); };

const round = (n, d) => { const f = 10 ** d; return Math.round((Number(n) + Number.EPSILON) * f) / f; };
const r2 = n => round(n, 2);
const r3 = n => round(n, 3);
const r4 = n => round(n, 4);
const str = v => (v == null ? '' : String(v)).trim();
const idOrNull = v => (v === '' || v == null ? null : Number(v));
function num(v, campo, { positivo = false } = {}) {
  const n = v === '' || v == null ? 0 : Number(v);
  if (!Number.isFinite(n) || n < 0 || (positivo && n <= 0)) fail(400, `Valor inválido en "${campo}"`);
  return n;
}

// Sentencias preparadas con caché
const stmts = new Map();
const S = sql => { let s = stmts.get(sql); if (!s) { s = db.prepare(sql); stmts.set(sql, s); } return s; };
const clean = p => p.map(v => (v === undefined ? null : typeof v === 'boolean' ? Number(v) : v));
const all = (sql, ...p) => S(sql).all(...clean(p));
const get = (sql, ...p) => S(sql).get(...clean(p));
const run = (sql, ...p) => S(sql).run(...clean(p));

const rango = q => [str(q.desde) || '0000-01-01', str(q.hasta) || '9999-12-31'];

// ------------------------------------------------------------ núcleo de stock
function productoActivo(id) {
  const p = get('SELECT * FROM productos WHERE id = ?', Number(id));
  if (!p || !p.activo) fail(400, `El producto #${id} no existe o fue eliminado`);
  return p;
}

// Cambia el stock de un producto y registra el movimiento en el kardex
function moverStock(productoId, delta, tipo, { refTipo = null, refId = null, nota = '', costo = null, permitirInactivo = false } = {}) {
  const p = permitirInactivo ? get('SELECT * FROM productos WHERE id = ?', productoId) : productoActivo(productoId);
  if (!p) fail(400, `El producto #${productoId} no existe`);
  const nuevo = r3(p.stock + delta);
  if (nuevo < 0) fail(400, `Stock insuficiente para "${p.nombre}". Disponible: ${p.stock} ${p.unidad}`);
  run('UPDATE productos SET stock = ? WHERE id = ?', nuevo, p.id);
  run(`INSERT INTO movimientos (tipo, producto_id, cantidad, costo_unitario, stock_resultante, ref_tipo, ref_id, nota)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    tipo, p.id, r3(delta), costo ?? p.precio_costo, nuevo, refTipo, refId, nota || '');
  return p;
}

// Productos (de la lista dada) que quedaron en o por debajo de su stock mínimo
function alertasStock(ids) {
  const unicos = [...new Set(ids.map(Number))];
  if (!unicos.length) return [];
  return all(`SELECT id, codigo, nombre, unidad, stock, stock_minimo FROM productos
              WHERE activo = 1 AND stock <= stock_minimo AND id IN (${unicos.map(() => '?').join(',')}) ORDER BY nombre`, ...unicos);
}

function leerItems(items, campoPrecio) {
  if (!Array.isArray(items) || items.length === 0) fail(400, 'Agrega al menos un producto');
  return items.map(it => ({
    producto_id: Number(it.producto_id),
    cantidad: r3(num(it.cantidad, 'cantidad', { positivo: true })),
    precio: campoPrecio ? num(it[campoPrecio], campoPrecio) : 0,
  }));
}

// ------------------------------------------------------------ configuración
app.get('/api/config', (req, res) => {
  res.json(Object.fromEntries(all('SELECT clave, valor FROM config').map(r => [r.clave, r.valor])));
});
app.put('/api/config', (req, res) => {
  const b = req.body || {};
  const permitidas = ['negocio_nombre', 'negocio_documento', 'negocio_direccion', 'negocio_telefono', 'moneda', 'moneda_codigo', 'ticket_pie'];
  tx(() => {
    for (const k of permitidas) if (k in b) run('INSERT INTO config (clave, valor) VALUES (?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor', k, str(b[k]));
  });
  res.json(Object.fromEntries(all('SELECT clave, valor FROM config').map(r => [r.clave, r.valor])));
});

// ------------------------------------------- CRUD simple (catálogos)
function crud(recurso, campos) {
  const base = `/api/${recurso}`;
  const leer = b => {
    const o = {};
    for (const c of campos) o[c] = str(b[c]);
    if (!o.nombre) fail(400, 'El nombre es obligatorio');
    return o;
  };
  app.get(base, (req, res) => {
    const term = str(req.query.q);
    if (!term) return res.json(all(`SELECT * FROM ${recurso} ORDER BY nombre COLLATE NOCASE`));
    const where = campos.map(c => `${c} LIKE ?`).join(' OR ');
    res.json(all(`SELECT * FROM ${recurso} WHERE ${where} ORDER BY nombre COLLATE NOCASE`, ...campos.map(() => `%${term}%`)));
  });
  app.post(base, (req, res) => {
    const o = leer(req.body || {});
    const r = run(`INSERT INTO ${recurso} (${campos.join(',')}) VALUES (${campos.map(() => '?').join(',')})`, ...campos.map(c => o[c]));
    res.status(201).json(get(`SELECT * FROM ${recurso} WHERE id = ?`, Number(r.lastInsertRowid)));
  });
  app.put(`${base}/:id`, (req, res) => {
    const o = leer(req.body || {});
    const r = run(`UPDATE ${recurso} SET ${campos.map(c => `${c} = ?`).join(',')} WHERE id = ?`, ...campos.map(c => o[c]), Number(req.params.id));
    if (!r.changes) fail(404, 'Registro no encontrado');
    res.json(get(`SELECT * FROM ${recurso} WHERE id = ?`, Number(req.params.id)));
  });
  app.delete(`${base}/:id`, (req, res) => {
    const r = run(`DELETE FROM ${recurso} WHERE id = ?`, Number(req.params.id));
    if (!r.changes) fail(404, 'Registro no encontrado');
    res.json({ ok: true });
  });
}
crud('categorias', ['nombre', 'descripcion']);
crud('proveedores', ['nombre', 'documento', 'telefono', 'email', 'direccion']);
crud('clientes', ['nombre', 'documento', 'telefono', 'email', 'direccion']);

// ------------------------------------------------------------------ productos
const PRODUCTO_SQL = `SELECT p.*, c.nombre AS categoria FROM productos p LEFT JOIN categorias c ON c.id = p.categoria_id`;

app.get('/api/productos', (req, res) => {
  const w = ['p.activo = 1'];
  const p = [];
  const term = str(req.query.q);
  if (term) { w.push('(p.codigo LIKE ? OR p.nombre LIKE ? OR p.descripcion LIKE ?)'); p.push(`%${term}%`, `%${term}%`, `%${term}%`); }
  if (str(req.query.categoria_id)) { w.push('p.categoria_id = ?'); p.push(Number(req.query.categoria_id)); }
  if (req.query.bajo_stock === '1') w.push('p.stock <= p.stock_minimo');
  res.json(all(`${PRODUCTO_SQL} WHERE ${w.join(' AND ')} ORDER BY p.nombre COLLATE NOCASE`, ...p));
});

app.get('/api/productos/:id', (req, res) => {
  const p = get(`${PRODUCTO_SQL} WHERE p.id = ?`, Number(req.params.id));
  if (!p) fail(404, 'Producto no encontrado');
  res.json(p);
});

function leerProducto(b, id = 0) {
  const o = {
    codigo: str(b.codigo),
    nombre: str(b.nombre),
    descripcion: str(b.descripcion),
    categoria_id: idOrNull(b.categoria_id),
    unidad: str(b.unidad) || 'UND',
    precio_costo: r4(num(b.precio_costo, 'precio de costo')),
    precio_venta: r2(num(b.precio_venta, 'precio de venta')),
    stock_minimo: r3(num(b.stock_minimo, 'stock mínimo')),
  };
  if (!o.codigo) fail(400, 'El código es obligatorio');
  if (!o.nombre) fail(400, 'El nombre es obligatorio');
  if (get('SELECT id FROM productos WHERE activo = 1 AND codigo = ? COLLATE NOCASE AND id <> ?', o.codigo, id))
    fail(409, `Ya existe un producto con el código "${o.codigo}"`);
  return o;
}

app.post('/api/productos', (req, res) => {
  const b = req.body || {};
  const o = leerProducto(b);
  const stockInicial = r3(num(b.stock_inicial, 'stock inicial'));
  const id = tx(() => {
    const r = run(`INSERT INTO productos (codigo, nombre, descripcion, categoria_id, unidad, precio_costo, precio_venta, stock_minimo)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      o.codigo, o.nombre, o.descripcion, o.categoria_id, o.unidad, o.precio_costo, o.precio_venta, o.stock_minimo);
    const id = Number(r.lastInsertRowid);
    if (stockInicial > 0) moverStock(id, stockInicial, 'INICIAL', { nota: 'Stock inicial' });
    return id;
  });
  res.status(201).json(get(`${PRODUCTO_SQL} WHERE p.id = ?`, id));
});

app.put('/api/productos/:id', (req, res) => {
  const id = Number(req.params.id);
  productoActivo(id);
  const o = leerProducto(req.body || {}, id);
  run(`UPDATE productos SET codigo = ?, nombre = ?, descripcion = ?, categoria_id = ?, unidad = ?, precio_costo = ?, precio_venta = ?, stock_minimo = ?
       WHERE id = ?`,
    o.codigo, o.nombre, o.descripcion, o.categoria_id, o.unidad, o.precio_costo, o.precio_venta, o.stock_minimo, id);
  res.json(get(`${PRODUCTO_SQL} WHERE p.id = ?`, id));
});

// Si el producto tiene historial se desactiva (se conserva el kardex); si no, se borra
app.delete('/api/productos/:id', (req, res) => {
  const id = Number(req.params.id);
  productoActivo(id);
  const tieneHistorial = get('SELECT 1 FROM movimientos WHERE producto_id = ? LIMIT 1', id);
  if (tieneHistorial) run('UPDATE productos SET activo = 0 WHERE id = ?', id);
  else run('DELETE FROM productos WHERE id = ?', id);
  res.json({ ok: true, desactivado: !!tieneHistorial });
});

// Ajuste por conteo físico
app.post('/api/productos/:id/ajuste', (req, res) => {
  const id = Number(req.params.id);
  const b = req.body || {};
  const real = r3(num(b.stock_real, 'stock real'));
  tx(() => {
    const p = productoActivo(id);
    const delta = r3(real - p.stock);
    if (delta === 0) fail(400, 'El stock indicado es igual al actual');
    moverStock(id, delta, 'AJUSTE', { nota: str(b.nota) || 'Ajuste por conteo físico' });
  });
  res.json({ ...get(`${PRODUCTO_SQL} WHERE p.id = ?`, id), alertas: alertasStock([id]) });
});

// ---------------------------------------------------------- kardex / movimientos
app.get('/api/movimientos', (req, res) => {
  const [desde, hasta] = rango(req.query);
  const w = ['date(m.fecha) BETWEEN ? AND ?'];
  const p = [desde, hasta];
  if (str(req.query.producto_id)) { w.push('m.producto_id = ?'); p.push(Number(req.query.producto_id)); }
  if (str(req.query.tipo)) { w.push('m.tipo = ?'); p.push(str(req.query.tipo)); }
  const limite = Math.min(Number(req.query.limite) || 1000, 5000);
  res.json(all(`SELECT m.*, p.codigo, p.nombre, p.unidad FROM movimientos m JOIN productos p ON p.id = m.producto_id
                WHERE ${w.join(' AND ')} ORDER BY m.id DESC LIMIT ${limite}`, ...p));
});

// ----------------------------------------------- documentos: entradas/salidas/ventas
const DOCS = {
  entradas: { items: 'entrada_items', fk: 'entrada_id', signoAnular: -1, ref: 'entrada' },
  salidas: { items: 'salida_items', fk: 'salida_id', signoAnular: +1, ref: 'salida' },
  ventas: { items: 'venta_items', fk: 'venta_id', signoAnular: +1, ref: 'venta' },
};

function detalle(recurso, id) {
  const d = DOCS[recurso];
  let doc;
  if (recurso === 'ventas') doc = get(`SELECT v.*, c.nombre AS cliente, c.documento AS cliente_documento FROM ventas v LEFT JOIN clientes c ON c.id = v.cliente_id WHERE v.id = ?`, id);
  else if (recurso === 'entradas') doc = get(`SELECT e.*, pr.nombre AS proveedor FROM entradas e LEFT JOIN proveedores pr ON pr.id = e.proveedor_id WHERE e.id = ?`, id);
  else doc = get(`SELECT s.*, (SELECT COALESCE(SUM(cantidad * costo_unitario), 0) FROM salida_items WHERE salida_id = s.id) AS total FROM salidas s WHERE s.id = ?`, id);
  if (!doc) fail(404, 'Documento no encontrado');
  doc.items = all(`SELECT i.*, p.codigo, p.nombre, p.unidad FROM ${d.items} i JOIN productos p ON p.id = i.producto_id WHERE i.${d.fk} = ? ORDER BY i.id`, id);
  return doc;
}

for (const recurso of Object.keys(DOCS)) {
  app.get(`/api/${recurso}/:id`, (req, res) => res.json(detalle(recurso, Number(req.params.id))));

  app.post(`/api/${recurso}/:id/anular`, (req, res) => {
    const d = DOCS[recurso];
    const id = Number(req.params.id);
    const motivo = str(req.body?.motivo);
    const afectados = tx(() => {
      const doc = get(`SELECT * FROM ${recurso} WHERE id = ?`, id);
      if (!doc) fail(404, 'Documento no encontrado');
      if (doc.estado === 'ANULADA') fail(400, 'El documento ya está anulado');
      const lineas = all(`SELECT * FROM ${d.items} WHERE ${d.fk} = ?`, id);
      for (const it of lineas) {
        moverStock(it.producto_id, d.signoAnular * it.cantidad, 'ANULACION', {
          refTipo: d.ref, refId: id, permitirInactivo: true,
          costo: it.costo_unitario,
          nota: `Anulación de ${d.ref} #${id}${motivo ? ': ' + motivo : ''}`,
        });
      }
      run(`UPDATE ${recurso} SET estado = 'ANULADA', nota = TRIM(nota || ?) WHERE id = ?`, motivo ? ` [Anulada: ${motivo}]` : ' [Anulada]', id);
      return lineas.map(l => l.producto_id);
    });
    res.json({ ...detalle(recurso, id), alertas: d.signoAnular < 0 ? alertasStock(afectados) : [] });
  });
}

function filtroDocs(req, alias) {
  const [desde, hasta] = rango(req.query);
  const w = [`date(${alias}.fecha) BETWEEN ? AND ?`];
  const p = [desde, hasta];
  if (str(req.query.estado)) { w.push(`${alias}.estado = ?`); p.push(str(req.query.estado)); }
  return { where: w.join(' AND '), p };
}

// ----- entradas (compras / ingresos de mercadería)
app.get('/api/entradas', (req, res) => {
  const { where, p } = filtroDocs(req, 'e');
  res.json(all(`SELECT e.*, pr.nombre AS proveedor, (SELECT COUNT(*) FROM entrada_items WHERE entrada_id = e.id) AS n_items
                FROM entradas e LEFT JOIN proveedores pr ON pr.id = e.proveedor_id WHERE ${where} ORDER BY e.id DESC`, ...p));
});

app.post('/api/entradas', (req, res) => {
  const b = req.body || {};
  const items = leerItems(b.items, 'costo_unitario');
  const id = tx(() => {
    const total = r2(items.reduce((s, i) => s + i.cantidad * i.precio, 0));
    const r = run('INSERT INTO entradas (proveedor_id, documento, nota, total) VALUES (?, ?, ?, ?)',
      idOrNull(b.proveedor_id), str(b.documento), str(b.nota), total);
    const eid = Number(r.lastInsertRowid);
    for (const it of items) {
      const p = productoActivo(it.producto_id);
      // Costo promedio ponderado
      const nuevoCosto = p.stock > 0 ? (p.stock * p.precio_costo + it.cantidad * it.precio) / (p.stock + it.cantidad) : it.precio;
      run('INSERT INTO entrada_items (entrada_id, producto_id, cantidad, costo_unitario) VALUES (?, ?, ?, ?)', eid, p.id, it.cantidad, it.precio);
      run('UPDATE productos SET precio_costo = ? WHERE id = ?', r4(nuevoCosto), p.id);
      moverStock(p.id, it.cantidad, 'ENTRADA', { refTipo: 'entrada', refId: eid, costo: it.precio, nota: str(b.documento) });
    }
    return eid;
  });
  res.status(201).json(detalle('entradas', id));
});

// ----- salidas (mermas, consumo interno, devoluciones, etc.)
app.get('/api/salidas', (req, res) => {
  const { where, p } = filtroDocs(req, 's');
  res.json(all(`SELECT s.*, (SELECT COUNT(*) FROM salida_items WHERE salida_id = s.id) AS n_items,
                (SELECT COALESCE(SUM(cantidad * costo_unitario), 0) FROM salida_items WHERE salida_id = s.id) AS total
                FROM salidas s WHERE ${where} ORDER BY s.id DESC`, ...p));
});

app.post('/api/salidas', (req, res) => {
  const b = req.body || {};
  const motivo = str(b.motivo);
  if (!motivo) fail(400, 'Indica el motivo de la salida');
  const items = leerItems(b.items);
  const id = tx(() => {
    const r = run('INSERT INTO salidas (motivo, nota) VALUES (?, ?)', motivo, str(b.nota));
    const sid = Number(r.lastInsertRowid);
    for (const it of items) {
      const p = productoActivo(it.producto_id);
      run('INSERT INTO salida_items (salida_id, producto_id, cantidad, costo_unitario) VALUES (?, ?, ?, ?)', sid, p.id, it.cantidad, p.precio_costo);
      moverStock(p.id, -it.cantidad, 'SALIDA', { refTipo: 'salida', refId: sid, nota: motivo });
    }
    return sid;
  });
  res.status(201).json({ ...detalle('salidas', id), alertas: alertasStock(items.map(i => i.producto_id)) });
});

// ----- ventas
app.get('/api/ventas', (req, res) => {
  const { where, p } = filtroDocs(req, 'v');
  res.json(all(`SELECT v.*, c.nombre AS cliente, (SELECT COUNT(*) FROM venta_items WHERE venta_id = v.id) AS n_items
                FROM ventas v LEFT JOIN clientes c ON c.id = v.cliente_id WHERE ${where} ORDER BY v.id DESC`, ...p));
});

app.post('/api/ventas', (req, res) => {
  const b = req.body || {};
  const items = leerItems(b.items, 'precio_unitario');
  const descuento = r2(num(b.descuento, 'descuento'));
  const metodo = str(b.metodo_pago) || 'Efectivo';
  const recibido = b.recibido === '' || b.recibido == null ? null : r2(num(b.recibido, 'monto recibido'));
  const id = tx(() => {
    const subtotal = r2(items.reduce((s, i) => s + i.cantidad * i.precio, 0));
    if (descuento > subtotal) fail(400, 'El descuento no puede ser mayor que el subtotal');
    const total = r2(subtotal - descuento);
    if (recibido != null && recibido < total) fail(400, 'El monto recibido es menor que el total');
    const r = run('INSERT INTO ventas (cliente_id, metodo_pago, subtotal, descuento, total, recibido, nota) VALUES (?, ?, ?, ?, ?, ?, ?)',
      idOrNull(b.cliente_id), metodo, subtotal, descuento, total, recibido, str(b.nota));
    const vid = Number(r.lastInsertRowid);
    for (const it of items) {
      const p = productoActivo(it.producto_id);
      run('INSERT INTO venta_items (venta_id, producto_id, cantidad, precio_unitario, costo_unitario, subtotal) VALUES (?, ?, ?, ?, ?, ?)',
        vid, p.id, it.cantidad, it.precio, p.precio_costo, r2(it.cantidad * it.precio));
      moverStock(p.id, -it.cantidad, 'VENTA', { refTipo: 'venta', refId: vid });
    }
    return vid;
  });
  res.status(201).json({ ...detalle('ventas', id), alertas: alertasStock(items.map(i => i.producto_id)) });
});

// ------------------------------------------------------------------ panel
const localISO = d => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

app.get('/api/dashboard', (req, res) => {
  const inventario = get(`SELECT COUNT(*) AS productos,
      COALESCE(SUM(stock * precio_costo), 0) AS valor_costo,
      COALESCE(SUM(stock * precio_venta), 0) AS valor_venta,
      COALESCE(SUM(CASE WHEN stock <= stock_minimo THEN 1 ELSE 0 END), 0) AS bajo_stock,
      COALESCE(SUM(CASE WHEN stock <= 0 THEN 1 ELSE 0 END), 0) AS agotados
    FROM productos WHERE activo = 1`);
  const hoy = get(`SELECT COUNT(*) AS n, COALESCE(SUM(total), 0) AS total FROM ventas WHERE estado = 'VIGENTE' AND date(fecha) = date('now','localtime')`);
  const mesWhere = `v.estado = 'VIGENTE' AND strftime('%Y-%m', v.fecha) = strftime('%Y-%m', 'now', 'localtime')`;
  const mes = get(`SELECT COUNT(*) AS n, COALESCE(SUM(total), 0) AS total FROM ventas v WHERE ${mesWhere}`);
  const costoMes = get(`SELECT COALESCE(SUM(vi.cantidad * vi.costo_unitario), 0) AS c FROM venta_items vi JOIN ventas v ON v.id = vi.venta_id WHERE ${mesWhere}`).c;
  mes.ganancia = r2(mes.total - costoMes);

  const porDia = new Map(all(`SELECT date(fecha) AS dia, SUM(total) AS total, COUNT(*) AS n FROM ventas
      WHERE estado = 'VIGENTE' AND date(fecha) >= date('now','localtime','-13 days') GROUP BY dia`).map(r => [r.dia, r]));
  const ventas_dias = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const dia = localISO(d);
    ventas_dias.push(porDia.get(dia) || { dia, total: 0, n: 0 });
  }

  const top = all(`SELECT p.id, p.codigo, p.nombre, p.unidad, SUM(vi.cantidad) AS cantidad, SUM(vi.subtotal) AS total
      FROM venta_items vi JOIN ventas v ON v.id = vi.venta_id JOIN productos p ON p.id = vi.producto_id
      WHERE ${mesWhere} GROUP BY p.id ORDER BY total DESC LIMIT 5`);
  const bajo = all(`SELECT id, codigo, nombre, unidad, stock, stock_minimo FROM productos
      WHERE activo = 1 AND stock <= stock_minimo ORDER BY (stock - stock_minimo), nombre LIMIT 10`);
  const ultimos = all(`SELECT m.*, p.nombre, p.unidad FROM movimientos m JOIN productos p ON p.id = m.producto_id ORDER BY m.id DESC LIMIT 8`);

  res.json({ inventario, hoy, mes, ventas_dias, top, bajo, ultimos });
});

// ------------------------------------------------------------------ reportes
app.get('/api/reportes', (req, res) => {
  const [desde, hasta] = rango(req.query);
  const w = `v.estado = 'VIGENTE' AND date(v.fecha) BETWEEN ? AND ?`;
  const resumen = get(`SELECT COUNT(*) AS ventas, COALESCE(SUM(total), 0) AS total, COALESCE(SUM(descuento), 0) AS descuentos FROM ventas v WHERE ${w}`, desde, hasta);
  resumen.costo = get(`SELECT COALESCE(SUM(vi.cantidad * vi.costo_unitario), 0) AS c FROM venta_items vi JOIN ventas v ON v.id = vi.venta_id WHERE ${w}`, desde, hasta).c;
  resumen.ganancia = r2(resumen.total - resumen.costo);
  resumen.ticket_promedio = resumen.ventas ? r2(resumen.total / resumen.ventas) : 0;
  resumen.compras = get(`SELECT COALESCE(SUM(total), 0) AS t FROM entradas e WHERE e.estado = 'VIGENTE' AND date(e.fecha) BETWEEN ? AND ?`, desde, hasta).t;
  resumen.mermas = get(`SELECT COALESCE(SUM(si.cantidad * si.costo_unitario), 0) AS t FROM salida_items si JOIN salidas s ON s.id = si.salida_id
      WHERE s.estado = 'VIGENTE' AND date(s.fecha) BETWEEN ? AND ?`, desde, hasta).t;

  const por_dia = all(`SELECT date(v.fecha) AS dia, COUNT(*) AS ventas, SUM(v.total) AS total FROM ventas v WHERE ${w} GROUP BY dia ORDER BY dia`, desde, hasta);
  const por_metodo = all(`SELECT v.metodo_pago, COUNT(*) AS ventas, SUM(v.total) AS total FROM ventas v WHERE ${w} GROUP BY v.metodo_pago ORDER BY total DESC`, desde, hasta);
  const productos = all(`SELECT p.codigo, p.nombre, p.unidad, SUM(vi.cantidad) AS cantidad, SUM(vi.subtotal) AS total,
      SUM(vi.subtotal - vi.cantidad * vi.costo_unitario) AS ganancia
      FROM venta_items vi JOIN ventas v ON v.id = vi.venta_id JOIN productos p ON p.id = vi.producto_id
      WHERE ${w} GROUP BY p.id ORDER BY total DESC LIMIT 50`, desde, hasta);
  const por_categoria = all(`SELECT COALESCE(c.nombre, 'Sin categoría') AS categoria, SUM(vi.cantidad) AS cantidad, SUM(vi.subtotal) AS total
      FROM venta_items vi JOIN ventas v ON v.id = vi.venta_id JOIN productos p ON p.id = vi.producto_id LEFT JOIN categorias c ON c.id = p.categoria_id
      WHERE ${w} GROUP BY c.id ORDER BY total DESC`, desde, hasta);
  const inventario = all(`SELECT COALESCE(c.nombre, 'Sin categoría') AS categoria, COUNT(*) AS productos, SUM(p.stock) AS unidades,
      SUM(p.stock * p.precio_costo) AS valor_costo, SUM(p.stock * p.precio_venta) AS valor_venta
      FROM productos p LEFT JOIN categorias c ON c.id = p.categoria_id WHERE p.activo = 1 GROUP BY c.id ORDER BY valor_costo DESC`);

  res.json({ desde, hasta, resumen, por_dia, por_metodo, productos, por_categoria, inventario });
});

// ------------------------------------------------------------- copia de seguridad
app.get('/api/backup', (req, res) => {
  const archivo = path.join(os.tmpdir(), `inventario-backup-${Date.now()}.db`);
  db.exec(`VACUUM INTO '${archivo.replace(/'/g, "''")}'`);
  res.download(archivo, `inventario-${localISO(new Date())}.db`, () => fs.unlink(archivo, () => {}));
});

// ------------------------------------------------------------- errores
app.use('/api', (req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));

app.use((err, req, res, next) => {
  let status = err.status || 500;
  let msg = err.message || 'Error interno';
  if (err.type === 'entity.parse.failed') { status = 400; msg = 'JSON inválido'; }
  else if (/FOREIGN KEY constraint failed/i.test(msg)) { status = 409; msg = 'No se puede eliminar: tiene registros asociados'; }
  else if (/UNIQUE constraint failed/i.test(msg)) { status = 409; msg = 'Ya existe un registro con ese nombre o código'; }
  else if (/CHECK constraint failed/i.test(msg)) { status = 400; msg = 'Datos inválidos (verifica cantidades y precios)'; }
  if (status >= 500) console.error(err);
  res.status(status).json({ error: msg });
});

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const servidor = app.listen(PORT, HOST, err => {
  if (err) return; // Express 5 también llama aquí en caso de error; lo maneja servidor.on('error')
  console.log(`Inventario listo en http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
});
servidor.on('error', e => {
  if (e.code === 'EADDRINUSE') {
    console.log(`El puerto ${PORT} ya está en uso: probablemente el Inventario ya está abierto en otra ventana.`);
    console.log(`Abre http://localhost:${PORT} en el navegador, o cierra la otra ventana y vuelve a intentarlo.`);
    process.exit(1);
  }
  throw e;
});
