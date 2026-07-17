#!/bin/zsh
set -e

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
APPS_DIR="$HOME/Applications"

mkdir -p "$APPS_DIR" "$PROJECT_DIR/.data"
printf '%s\n' "$PROJECT_DIR" > "$HOME/.sijol-path"

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "No se encontró Node.js o npm. Instálelos antes de continuar."
  read -k 1 "?Presione una tecla para cerrar."
  exit 1
fi

cd "$PROJECT_DIR"
npm install
npm test

/usr/bin/osacompile -o "$APPS_DIR/SIJ-OL.app" "$PROJECT_DIR/macos/SIJ-OL.applescript"
/usr/bin/osacompile -o "$APPS_DIR/Detener SIJ-OL.app" "$PROJECT_DIR/macos/Detener-SIJ-OL.applescript"

echo
echo "INSTALACIÓN TERMINADA"
echo "Abra SIJ-OL desde: $APPS_DIR/SIJ-OL.app"
echo "Puede arrastrar SIJ-OL.app al Dock."
/usr/bin/open "$APPS_DIR"
read -k 1 "?Presione una tecla para cerrar."
