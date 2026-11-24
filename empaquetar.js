// Genera un paquete portable para Windows en dist/ (no requiere instalar Node en la otra PC).
//   npm run empaquetar              -> paquete con base de datos vacía
//   npm run empaquetar -- --con-datos -> incluye una copia de los datos actuales
const fs = require('fs');
const path = require('path');
const { execFileSync, execSync } = require('child_process');
const pkg = require('./package.json');

const conDatos = process.argv.includes('--con-datos');
const raiz = __dirname;
const dist = path.join(raiz, 'dist');
const nombre = 'Inventario';
const destino = path.join(dist, nombre);
const zip = path.join(dist, `${nombre}-v${pkg.version}${conDatos ? '-con-datos' : ''}.zip`);

if (process.platform !== 'win32') console.warn('Aviso: el paquete incluye el node.exe de este sistema; genéralo en Windows para usarlo en Windows.');

console.log('Preparando carpeta…');
fs.rmSync(destino, { recursive: true, force: true });
fs.mkdirSync(destino, { recursive: true });

// Código de la aplicación
for (const f of ['server.js', 'db.js', 'seed.js', 'package.json']) fs.copyFileSync(path.join(raiz, f), path.join(destino, f));
fs.cpSync(path.join(raiz, 'public'), path.join(destino, 'public'), { recursive: true });

// Dependencias de producción
console.log('Instalando dependencias de producción…');
fs.copyFileSync(path.join(raiz, 'package-lock.json'), path.join(destino, 'package-lock.json'));
execSync('npm ci --omit=dev --no-fund --no-audit', { cwd: destino, stdio: 'inherit' });

// Runtime de Node (el mismo que está ejecutando este script)
console.log('Copiando node.exe…');
fs.copyFileSync(process.execPath, path.join(destino, process.platform === 'win32' ? 'node.exe' : 'node'));

// Datos actuales (opcional)
if (conDatos) {
  const { db } = require('./db');
  fs.mkdirSync(path.join(destino, 'data'), { recursive: true });
  const archivo = path.join(destino, 'data', 'inventario.db');
  db.exec(`VACUUM INTO '${archivo.replace(/'/g, "''")}'`);
  console.log('Datos actuales incluidos.');
}

// Lanzadores
const crlf = s => s.trim().replace(/\r?\n/g, '\r\n') + '\r\n';
fs.writeFileSync(path.join(destino, 'Iniciar Inventario.bat'), crlf(`
@echo off
title Inventario - no cierres esta ventana mientras usas el sistema
cd /d "%~dp0"
if "%PORT%"=="" set PORT=3000
echo.
echo   Iniciando Inventario en http://localhost:%PORT%
echo   Para cerrar el sistema, cierra esta ventana.
echo.
start "" /b cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:%PORT%"
"%~dp0node.exe" --disable-warning=ExperimentalWarning server.js
pause
`));

fs.writeFileSync(path.join(destino, 'Crear acceso directo en el escritorio.bat'), crlf(`
@echo off
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Desktop')+'\\Inventario.lnk'); $s.TargetPath='%~dp0Iniciar Inventario.bat'; $s.WorkingDirectory='%~dp0'; $s.IconLocation='%~dp0node.exe,0'; $s.Save()"
echo Acceso directo "Inventario" creado en el escritorio.
pause
`));

fs.writeFileSync(path.join(destino, 'LEEME.txt'), crlf(`
INVENTARIO v${pkg.version} - Instalación
=======================================

Requisitos: Windows 10 u 11 de 64 bits. No hace falta instalar nada más.

1. Copia la carpeta "Inventario" a un lugar donde tengas permisos de escritura,
   por ejemplo C:\\Inventario o Documentos. (No la pongas en "Archivos de programa".)
2. Doble clic en "Crear acceso directo en el escritorio.bat" (solo la primera vez).
3. Para usar el sistema: doble clic en "Iniciar Inventario" (o en el acceso directo).
   Se abrirá el navegador en http://localhost:3000.
   Mientras lo usas, deja abierta la ventana negra; al cerrarla se detiene el sistema.

Datos
-----
Todo se guarda en la carpeta "data" (archivo inventario.db).
Haz copias de seguridad desde Configuración > Descargar copia de seguridad,
o copiando esa carpeta con el sistema cerrado.

Actualizar a una versión nueva
------------------------------
Reemplaza todos los archivos EXCEPTO la carpeta "data".

Datos de ejemplo (opcional)
---------------------------
Con el sistema cerrado, abre una consola en esta carpeta y ejecuta:
   node.exe seed.js
`));

// Comprimir
console.log('Comprimiendo…');
fs.rmSync(zip, { force: true });
try {
  execFileSync('tar', ['-a', '-c', '-f', zip, '-C', dist, nombre], { stdio: 'inherit' });
} catch {
  execFileSync('powershell', ['-NoProfile', '-Command', `Compress-Archive -Path '${destino}' -DestinationPath '${zip}' -Force`], { stdio: 'inherit' });
}

const mb = (fs.statSync(zip).size / 1024 / 1024).toFixed(1);
console.log(`\nPaquete listo: ${zip} (${mb} MB)`);
console.log(`Carpeta sin comprimir: ${destino}`);
