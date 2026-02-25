#!/usr/bin/env node
/**
 * @antigravity/agent — wrapper para compatibilidad con npx
 * Redirige al agente instalado localmente
 */
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// Buscar el agente en rutas conocidas
const possible = [
    path.join(__dirname, '../../agent/src/index.js'),           // desde node_modules
    path.join(process.env.HOME, 'antigravity-agent/src/index.js'),  // instalación global
    path.join(__dirname, 'src/index.js'),                        // mismo directorio
];

let agentPath = null;
for (const p of possible) {
    if (fs.existsSync(p)) { agentPath = p; break; }
}

if (!agentPath) {
    console.error('❌ Agente no encontrado. Instala con:');
    console.error('   git clone https://github.com/VirtualTec2025/antigravity-remote && cd antigravity-remote/agent && npm install && npm link');
    process.exit(1);
}

require(agentPath);
