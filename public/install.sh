#!/usr/bin/env bash
# ▲ Antigravity Agent — Quick Installer
# Run: curl -sSL https://your-server.com/install.sh | AG_KEY=ag_xxx bash

set -e

BOLD="\033[1m"
CYAN="\033[36m"
GREEN="\033[32m"
RED="\033[31m"
RESET="\033[0m"

echo ""
echo -e "${BOLD}${CYAN}  ▲ ANTIGRAVITY AGENT INSTALLER${RESET}"
echo -e "${CYAN}  ─────────────────────────────────────${RESET}"
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
  echo -e "${RED}  ✕ Node.js no encontrado. Instálalo primero:${RESET}"
  echo -e "    https://nodejs.org"
  exit 1
fi

NODE_VER=$(node -v | cut -c 2- | cut -d. -f1)
if [ "$NODE_VER" -lt 18 ]; then
  echo -e "${RED}  ✕ Node.js 18+ requerido (tienes $(node -v))${RESET}"
  exit 1
fi

# Check API key
if [ -z "$AG_KEY" ]; then
  echo -e "${RED}  ✕ AG_KEY no definida.${RESET}"
  echo ""
  echo -e "  Usa: ${CYAN}curl ... | AG_KEY=ag_xxx bash${RESET}"
  exit 1
fi

INSTALL_DIR="$HOME/.antigravity/agent"
CONFIG_FILE="$HOME/.antigravity/config.json"
SERVER_URL="${AG_SERVER:-https://antigravity-remote.onrender.com}"

echo -e "  ${BOLD}Directorio:${RESET} $INSTALL_DIR"
echo -e "  ${BOLD}Servidor:${RESET}   $SERVER_URL"
echo ""

# Create directories
mkdir -p "$INSTALL_DIR/src"

# Save config
mkdir -p "$HOME/.antigravity"
cat > "$CONFIG_FILE" << EOF
{
  "apiKey": "$AG_KEY",
  "serverUrl": "$SERVER_URL",
  "autoApprove": false,
  "autoApproveRisk": "none"
}
EOF

echo -e "  ${GREEN}✓${RESET} Config guardada en $CONFIG_FILE"

# Create launcher script
LAUNCHER="$HOME/.local/bin/antigravity-agent"
mkdir -p "$HOME/.local/bin"
cat > "$LAUNCHER" << LAUNCHER_EOF
#!/usr/bin/env bash
AG_KEY="$AG_KEY" AG_SERVER="$SERVER_URL" node "$INSTALL_DIR/src/index.js" "\$@"
LAUNCHER_EOF
chmod +x "$LAUNCHER"

echo -e "  ${GREEN}✓${RESET} Launcher creado en $LAUNCHER"
echo ""

# Add to PATH if needed
if [[ ":$PATH:" != *":$HOME/.local/bin:"* ]]; then
  echo ""
  echo -e "  ${BOLD}Añade esto a tu ~/.zshrc o ~/.bashrc:${RESET}"
  echo -e "  ${CYAN}export PATH=\"\$HOME/.local/bin:\$PATH\"${RESET}"
fi

echo ""
echo -e "${GREEN}  ✓ ¡Instalación completa!${RESET}"
echo ""
echo -e "  Ejecuta el agente con:"
echo -e "  ${CYAN}  antigravity-agent${RESET}"
echo ""
