# ▲ Antigravity Agent

Agente local para Mac que conecta tu computadora con la plataforma Antigravity.

## Instalación rápida

```bash
# Opción 1: Con npx (sin instalar)
AG_KEY=ag_tukey npx @antigravity/agent

# Opción 2: Instalación global
npm install -g @antigravity/agent
AG_KEY=ag_tukey antigravity-agent

# Opción 3: Desde este repositorio
cd agent
npm install
AG_KEY=ag_tukey node src/index.js
```

## Configuración

1. Abre la app en tu móvil
2. Ve a **Config → API Key** y cópiala
3. Ejecuta el agente con tu key:

```bash
AG_KEY=ag_xxxx node src/index.js
```

## Variables de entorno

| Variable     | Descripción              | Default                                      |
|--------------|--------------------------|----------------------------------------------|
| `AG_KEY`     | Tu API key (requerida)   | —                                            |
| `AG_SERVER`  | URL del servidor         | `https://antigravity-remote.onrender.com`    |

## Comandos en el terminal

Una vez conectado, puedes usar estos comandos:

| Comando                | Descripción                                |
|------------------------|--------------------------------------------|
| `<texto>`              | Envía un mensaje al móvil                  |
| `/send <texto>`        | Enviar mensaje al móvil                    |
| `/approval <título>`   | Crear solicitud de aprobación              |
| `/activity <texto>`    | Registrar actividad en el feed             |
| `/status`              | Ver estado de la conexión                  |
| `/approve-all`         | Auto-aprobar solicitudes de riesgo BAJO    |
| `/no-auto`             | Desactivar auto-aprobación                 |
| `/config`              | Ver configuración actual                   |
| `/help`                | Ver todos los comandos                     |
| `/quit`                | Salir                                      |

## Integración programática

El agente puede ser usado como módulo en tu código:

```javascript
const { AgentAPI, waitForApproval } = require('./src/api');

const api = new AgentAPI('https://tu-servidor.com', 'ag_tu_key');

// Enviar mensaje al móvil
await api.sendMessage('Empecé a procesar los archivos...');

// Pedir aprobación antes de hacer algo
const { approval } = await api.requestApproval({
  title: 'Eliminar archivos temporales',
  description: 'Se van a eliminar 234 archivos en /tmp',
  command: 'rm -rf /tmp/cache/*',
  riskLevel: 'medium',
});

// Esperar respuesta del usuario en el móvil
const result = await waitForApproval(api, approval.id);

if (result.status === 'approved') {
  // Ejecutar la acción
  console.log('¡Aprobado! Ejecutando...');
} else {
  console.log('Rechazado o expirado:', result.status);
}

// Registrar actividad
await api.logActivity('Archivos procesados', '234 archivos eliminados', '🗑', 'success');
```
