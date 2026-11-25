# Sistema de Inventario

Desarrollado por **AilanyTech**.

App web para controlar inventario, compras, salidas y ventas. Funciona en el navegador; los datos se guardan en un archivo SQLite local (`data/inventario.db`).

## Requisitos

- Node.js 22.13 o superior (usa el módulo `node:sqlite` incluido en Node; no hay que compilar nada)

## Cómo ejecutar

```bash
npm install        # solo la primera vez
npm run seed       # opcional: carga productos de ejemplo
npm start          # abre http://localhost:3000
```

Mientras desarrollas puedes usar `npm run dev`, que reinicia el servidor cuando cambias el código.

Para usarlo desde otros equipos o celulares de la misma red, inícialo con `HOST=0.0.0.0` (en PowerShell: `$env:HOST="0.0.0.0"; npm start`) y entra a `http://IP-DE-ESTA-PC:3000`. **Ojo:** la app todavía no tiene usuarios ni contraseñas, así que cualquiera en la red podrá usarla.

## Funciones

| Módulo | Qué hace |
|---|---|
| **Panel** | Ventas del día y del mes, ganancia bruta, valor del inventario, gráfico de 14 días, más vendidos, alertas de stock bajo |
| **Nueva venta (POS)** | Búsqueda por código o nombre (compatible con lector de código de barras), carrito, descuento, métodos de pago, vuelto, ticket imprimible, atajo F2 para cobrar |
| **Ventas** | Historial filtrable por fechas, detalle, reimpresión de ticket, anulación (devuelve el stock) |
| **Entradas** | Ingreso de mercadería por proveedor y factura; actualiza el costo con **promedio ponderado** |
| **Salidas** | Mermas, productos dañados, consumo interno, devoluciones a proveedor, etc. |
| **Kardex** | Todos los movimientos de stock con saldo resultante, filtrables por producto, tipo y fecha |
| **Productos** | Alta/edición, categorías, unidades de medida, stock mínimo, **ajuste por conteo físico**, exportación CSV |
| **Clientes / Proveedores / Categorías** | Catálogos con búsqueda |
| **Reportes** | Ventas por día, por método de pago, por categoría, productos más vendidos con ganancia, compras, mermas e inventario valorizado |
| **Configuración** | Datos del negocio para el ticket, símbolo de moneda y descarga de copia de seguridad |

## Reglas de negocio

- El stock **solo** cambia con movimientos (stock inicial, entrada, salida, venta, anulación, ajuste), y cada uno queda en el kardex.
- No se puede vender ni sacar más de lo que hay en stock.
- Las ventas, entradas y salidas no se borran: se **anulan**, y la anulación revierte el stock.
- Cada venta guarda el costo del producto en ese momento, así la ganancia histórica es correcta aunque el costo cambie después.
- Un producto con historial no se borra: se desactiva y su kardex se conserva.

## Estructura

```
server.js        API REST (Express)
db.js            Esquema de la base de datos SQLite
seed.js          Datos de ejemplo
public/          Frontend (HTML + CSS + JavaScript, sin compilación)
data/            Base de datos (se crea automáticamente)
```
