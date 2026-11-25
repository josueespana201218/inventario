// Base de datos SQLite (módulo nativo de Node: node:sqlite)
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });
const dbPath = process.env.DB_PATH || path.join(dataDir, 'inventario.db');

const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

db.exec(`
CREATE TABLE IF NOT EXISTS config (
  clave TEXT PRIMARY KEY,
  valor TEXT
);

CREATE TABLE IF NOT EXISTS categorias (
  id          INTEGER PRIMARY KEY,
  nombre      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  descripcion TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS proveedores (
  id        INTEGER PRIMARY KEY,
  nombre    TEXT NOT NULL,
  documento TEXT NOT NULL DEFAULT '',
  telefono  TEXT NOT NULL DEFAULT '',
  email     TEXT NOT NULL DEFAULT '',
  direccion TEXT NOT NULL DEFAULT '',
  creado    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS clientes (
  id        INTEGER PRIMARY KEY,
  nombre    TEXT NOT NULL,
  documento TEXT NOT NULL DEFAULT '',
  telefono  TEXT NOT NULL DEFAULT '',
  email     TEXT NOT NULL DEFAULT '',
  direccion TEXT NOT NULL DEFAULT '',
  creado    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS productos (
  id           INTEGER PRIMARY KEY,
  codigo       TEXT NOT NULL,
  nombre       TEXT NOT NULL,
  descripcion  TEXT NOT NULL DEFAULT '',
  categoria_id INTEGER REFERENCES categorias(id) ON DELETE SET NULL,
  unidad       TEXT NOT NULL DEFAULT 'UND',
  precio_costo REAL NOT NULL DEFAULT 0 CHECK (precio_costo >= 0),
  precio_venta REAL NOT NULL DEFAULT 0 CHECK (precio_venta >= 0),
  stock        REAL NOT NULL DEFAULT 0 CHECK (stock >= 0),
  stock_minimo REAL NOT NULL DEFAULT 0 CHECK (stock_minimo >= 0),
  activo       INTEGER NOT NULL DEFAULT 1,
  creado       TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_productos_codigo ON productos(codigo COLLATE NOCASE) WHERE activo = 1;

CREATE TABLE IF NOT EXISTS entradas (
  id           INTEGER PRIMARY KEY,
  fecha        TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  proveedor_id INTEGER REFERENCES proveedores(id),
  documento    TEXT NOT NULL DEFAULT '',
  nota         TEXT NOT NULL DEFAULT '',
  total        REAL NOT NULL DEFAULT 0,
  estado       TEXT NOT NULL DEFAULT 'VIGENTE' CHECK (estado IN ('VIGENTE','ANULADA'))
);
CREATE TABLE IF NOT EXISTS entrada_items (
  id             INTEGER PRIMARY KEY,
  entrada_id     INTEGER NOT NULL REFERENCES entradas(id) ON DELETE CASCADE,
  producto_id    INTEGER NOT NULL REFERENCES productos(id),
  cantidad       REAL NOT NULL CHECK (cantidad > 0),
  costo_unitario REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS salidas (
  id     INTEGER PRIMARY KEY,
  fecha  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  motivo TEXT NOT NULL,
  nota   TEXT NOT NULL DEFAULT '',
  estado TEXT NOT NULL DEFAULT 'VIGENTE' CHECK (estado IN ('VIGENTE','ANULADA'))
);
CREATE TABLE IF NOT EXISTS salida_items (
  id             INTEGER PRIMARY KEY,
  salida_id      INTEGER NOT NULL REFERENCES salidas(id) ON DELETE CASCADE,
  producto_id    INTEGER NOT NULL REFERENCES productos(id),
  cantidad       REAL NOT NULL CHECK (cantidad > 0),
  costo_unitario REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS ventas (
  id          INTEGER PRIMARY KEY,
  fecha       TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  cliente_id  INTEGER REFERENCES clientes(id),
  metodo_pago TEXT NOT NULL DEFAULT 'Efectivo',
  subtotal    REAL NOT NULL DEFAULT 0,
  descuento   REAL NOT NULL DEFAULT 0,
  total       REAL NOT NULL DEFAULT 0,
  recibido    REAL,
  nota        TEXT NOT NULL DEFAULT '',
  estado      TEXT NOT NULL DEFAULT 'VIGENTE' CHECK (estado IN ('VIGENTE','ANULADA'))
);
CREATE TABLE IF NOT EXISTS venta_items (
  id              INTEGER PRIMARY KEY,
  venta_id        INTEGER NOT NULL REFERENCES ventas(id) ON DELETE CASCADE,
  producto_id     INTEGER NOT NULL REFERENCES productos(id),
  cantidad        REAL NOT NULL CHECK (cantidad > 0),
  precio_unitario REAL NOT NULL DEFAULT 0,
  costo_unitario  REAL NOT NULL DEFAULT 0,
  subtotal        REAL NOT NULL DEFAULT 0
);

-- Kardex: cada cambio de stock queda registrado aquí
CREATE TABLE IF NOT EXISTS movimientos (
  id               INTEGER PRIMARY KEY,
  fecha            TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  tipo             TEXT NOT NULL CHECK (tipo IN ('INICIAL','ENTRADA','SALIDA','VENTA','ANULACION','AJUSTE')),
  producto_id      INTEGER NOT NULL REFERENCES productos(id),
  cantidad         REAL NOT NULL,
  costo_unitario   REAL NOT NULL DEFAULT 0,
  stock_resultante REAL NOT NULL,
  ref_tipo         TEXT,
  ref_id           INTEGER,
  nota             TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS ix_mov_producto ON movimientos(producto_id, fecha);
CREATE INDEX IF NOT EXISTS ix_mov_fecha ON movimientos(fecha);
CREATE INDEX IF NOT EXISTS ix_ventas_fecha ON ventas(fecha);
CREATE INDEX IF NOT EXISTS ix_vi_venta ON venta_items(venta_id);
CREATE INDEX IF NOT EXISTS ix_vi_producto ON venta_items(producto_id);
CREATE INDEX IF NOT EXISTS ix_ei_entrada ON entrada_items(entrada_id);
CREATE INDEX IF NOT EXISTS ix_si_salida ON salida_items(salida_id);
`);

const defaults = {
  negocio_nombre: 'AilanyTech',
  negocio_documento: '',
  negocio_direccion: '',
  negocio_telefono: '',
  moneda: '$',
  moneda_codigo: 'USD',
  ticket_pie: '¡Gracias por su compra!',
};
const insCfg = db.prepare('INSERT OR IGNORE INTO config (clave, valor) VALUES (?, ?)');
for (const [k, v] of Object.entries(defaults)) insCfg.run(k, v);
// Bases creadas con el nombre genérico anterior pasan a AilanyTech (no toca nombres puestos por el usuario)
db.prepare("UPDATE config SET valor = 'AilanyTech' WHERE clave = 'negocio_nombre' AND valor = 'Mi Negocio'").run();

// Ejecuta fn dentro de una transacción
function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

module.exports = { db, tx, dbPath };
