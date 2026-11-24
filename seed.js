// Carga datos de ejemplo (solo si no hay productos todavía): npm run seed
const { db, tx } = require('./db');

if (db.prepare('SELECT COUNT(*) AS n FROM productos').get().n > 0) {
  console.log('Ya existen productos; no se cargaron datos de ejemplo.');
  process.exit(0);
}

tx(() => {
  const cat = {};
  for (const n of ['Bebidas', 'Abarrotes', 'Limpieza', 'Snacks', 'Lácteos']) {
    cat[n] = Number(db.prepare('INSERT INTO categorias (nombre) VALUES (?)').run(n).lastInsertRowid);
  }
  db.prepare("INSERT INTO proveedores (nombre, documento, telefono) VALUES ('Distribuidora Central', '20123456789', '555-1234')").run();
  db.prepare("INSERT INTO proveedores (nombre, documento, telefono) VALUES ('Mayorista del Norte', '20987654321', '555-9876')").run();
  db.prepare("INSERT INTO clientes (nombre, documento, telefono) VALUES ('Juan Pérez', '12345678', '999-111-222')").run();
  db.prepare("INSERT INTO clientes (nombre, documento, telefono) VALUES ('Bodega La Esquina', '20555666777', '999-333-444')").run();

  const productos = [
    ['7750001', 'Gaseosa cola 500 ml', 'Bebidas', 'UND', 1.2, 2.5, 48, 12],
    ['7750002', 'Agua mineral 625 ml', 'Bebidas', 'UND', 0.6, 1.5, 60, 24],
    ['7750003', 'Jugo de naranja 1 L', 'Bebidas', 'UND', 2.1, 3.8, 6, 10],
    ['7750010', 'Arroz extra', 'Abarrotes', 'KG', 2.8, 4.2, 50, 20],
    ['7750011', 'Azúcar rubia', 'Abarrotes', 'KG', 2.5, 3.6, 40, 15],
    ['7750012', 'Aceite vegetal 1 L', 'Abarrotes', 'UND', 6.5, 9.0, 18, 6],
    ['7750013', 'Fideos spaghetti 500 g', 'Abarrotes', 'PAQ', 1.9, 3.0, 30, 10],
    ['7750020', 'Detergente 900 g', 'Limpieza', 'UND', 5.2, 8.5, 12, 5],
    ['7750021', 'Lejía 1 L', 'Limpieza', 'UND', 1.8, 3.2, 3, 6],
    ['7750030', 'Papas fritas 45 g', 'Snacks', 'UND', 0.9, 1.8, 40, 15],
    ['7750031', 'Galletas de chocolate', 'Snacks', 'PAQ', 0.7, 1.3, 0, 10],
    ['7750040', 'Leche evaporada 400 g', 'Lácteos', 'UND', 2.6, 3.9, 36, 12],
    ['7750041', 'Yogurt fresa 1 L', 'Lácteos', 'UND', 4.0, 6.5, 8, 6],
  ];
  const insP = db.prepare(`INSERT INTO productos (codigo, nombre, categoria_id, unidad, precio_costo, precio_venta, stock, stock_minimo)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  const insM = db.prepare(`INSERT INTO movimientos (tipo, producto_id, cantidad, costo_unitario, stock_resultante, nota)
                           VALUES ('INICIAL', ?, ?, ?, ?, 'Stock inicial')`);
  for (const [codigo, nombre, c, unidad, costo, venta, stock, min] of productos) {
    const id = Number(insP.run(codigo, nombre, cat[c], unidad, costo, venta, stock, min).lastInsertRowid);
    if (stock > 0) insM.run(id, stock, costo, stock);
  }
});

console.log('Datos de ejemplo cargados ✔');
