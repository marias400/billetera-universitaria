#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ADB="$ROOT/.tools/platform-tools/adb"
SCRCPY="$ROOT/.tools/scrcpy-macos-aarch64-v5.0.1/scrcpy"
DEVICE_PREFS="$ROOT/.android-demo-devices"
[[ -x "$ADB" ]] || ADB="$(command -v adb || true)"
[[ -x "$SCRCPY" ]] || SCRCPY="$(command -v scrcpy || true)"

if [[ -z "$ADB" || ! -x "$ADB" || -z "$SCRCPY" || ! -x "$SCRCPY" ]]; then
  echo "Faltan ADB o scrcpy. Instalá Android Platform Tools y scrcpy, asegurate de que adb y scrcpy estén en PATH y volvé a ejecutar este script."
  exit 1
fi

MOTO_ADDR=""
SAMSUNG_ADDR=""
if [[ -r "$DEVICE_PREFS" ]]; then
  while IFS='=' read -r key value; do
    case "$key" in
      MOTO_ADDR) MOTO_ADDR="$value" ;;
      SAMSUNG_ADDR) SAMSUNG_ADDR="$value" ;;
    esac
  done < "$DEVICE_PREFS"
fi

read_address() {
  local prompt="$1" current="$2" answer
  if [[ -n "$current" ]]; then
    read -r -p "$prompt [$current] (Enter para usarlo): " answer
    printf '%s' "${answer:-$current}"
  else
    read -r -p "$prompt: " answer
    printf '%s' "$answer"
  fi
}

MOTO_ADDR="$(read_address "Moto G23, IP:puerto de conexión" "$MOTO_ADDR")"
read -r -p "Moto G23, IP:puerto de vinculación (Enter si ya está vinculado): " MOTO_PAIR_ADDR
MOTO_PAIR_CODE=""
if [[ -n "$MOTO_PAIR_ADDR" ]]; then
  read -r -p "Código temporal del Moto: " -s MOTO_PAIR_CODE
  echo
fi
SAMSUNG_ADDR="$(read_address "Samsung S22, IP:puerto de conexión" "$SAMSUNG_ADDR")"
read -r -p "Samsung S22, IP:puerto de vinculación (Enter si ya está vinculado): " SAMSUNG_PAIR_ADDR
SAMSUNG_PAIR_CODE=""
if [[ -n "$SAMSUNG_PAIR_ADDR" ]]; then
  read -r -p "Código temporal del Samsung: " -s SAMSUNG_PAIR_CODE
  echo
fi

for value in "$MOTO_ADDR" "$SAMSUNG_ADDR"; do
  if [[ ! "$value" =~ ^[0-9.]+:[0-9]+$ ]]; then
    echo "Formato de dirección inválido: usá IP:puerto."
    exit 2
  fi
done
for value in "$MOTO_PAIR_ADDR" "$SAMSUNG_PAIR_ADDR"; do
  if [[ -n "$value" && ! "$value" =~ ^[0-9.]+:[0-9]+$ ]]; then
    echo "Formato de dirección de vinculación inválido: usá IP:puerto."
    exit 2
  fi
done
for value in "$MOTO_PAIR_CODE" "$SAMSUNG_PAIR_CODE"; do
  if [[ -n "$value" && ! "$value" =~ ^[0-9]{6}$ ]]; then
    echo "El código de vinculación debe tener seis dígitos."
    exit 2
  fi
done

echo
echo "Iniciando ADB..."
"$ADB" start-server >/dev/null
if [[ -n "$MOTO_PAIR_ADDR" ]]; then
  echo "Vinculando Moto G23..."
  "$ADB" pair "$MOTO_PAIR_ADDR" "$MOTO_PAIR_CODE"
  unset MOTO_PAIR_CODE
fi
if [[ -n "$SAMSUNG_PAIR_ADDR" ]]; then
  echo "Vinculando Samsung S22..."
  "$ADB" pair "$SAMSUNG_PAIR_ADDR" "$SAMSUNG_PAIR_CODE"
  unset SAMSUNG_PAIR_CODE
fi
echo "Conectando ambos teléfonos..."
"$ADB" connect "$MOTO_ADDR"
"$ADB" connect "$SAMSUNG_ADDR"
sleep 2

for name in "Moto G23" "Samsung S22"; do
  if [[ "$name" == "Moto G23" ]]; then device="$MOTO_ADDR"; else device="$SAMSUNG_ADDR"; fi
  while [[ "$("$ADB" -s "$device" get-state 2>/dev/null || true)" != "device" ]]; do
    echo "No pude conectar $name con $device. Revisá que esté en la misma red Wi-Fi y mirá el IP:puerto actual en Depuración inalámbrica."
    new_device="$(read_address "$name, nuevo IP:puerto de conexión" "")"
    if [[ ! "$new_device" =~ ^[0-9.]+:[0-9]+$ ]]; then
      echo "Formato inválido. Ejecutá el lanzador de nuevo cuando tengas el IP:puerto."
      exit 3
    fi
    "$ADB" disconnect "$device" >/dev/null 2>&1 || true
    "$ADB" connect "$new_device"
    device="$new_device"
    if [[ "$name" == "Moto G23" ]]; then MOTO_ADDR="$device"; else SAMSUNG_ADDR="$device"; fi
  done
done

umask 077
{
  printf 'MOTO_ADDR=%s\n' "$MOTO_ADDR"
  printf 'SAMSUNG_ADDR=%s\n' "$SAMSUNG_ADDR"
} > "$DEVICE_PREFS"

mkdir -p "$ROOT/logs"
export PATH="$(dirname "$ROOT")/.tools/node/bin:$PATH"
if ! curl -fsS http://127.0.0.1:4001/health >/dev/null 2>&1; then
  echo "Iniciando la API local..."
  (cd "$ROOT" && npm run server) >>"$ROOT/logs/android-demo-server.log" 2>&1 &
fi
if ! curl -fsS http://127.0.0.1:5173/ >/dev/null 2>&1; then
  echo "Iniciando la interfaz local..."
  (cd "$ROOT" && npm run dev -- --host 0.0.0.0) >>"$ROOT/logs/android-demo-vite.log" 2>&1 &
fi

ready=0
for _ in {1..30}; do
  if curl -fsS http://127.0.0.1:4001/health >/dev/null 2>&1 && curl -fsS http://127.0.0.1:5173/ >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done
if [[ "$ready" -ne 1 ]]; then
  echo "La app no inició. Revisá los registros en $ROOT/logs/ y ejecutá npm run server y npm run dev -- --host 0.0.0.0."
  exit 4
fi

echo "Preparando el acceso local a la app en ambos teléfonos..."
export ADB
"$ADB" -s "$MOTO_ADDR" reverse tcp:5173 tcp:5173
"$ADB" -s "$SAMSUNG_ADDR" reverse tcp:5173 tcp:5173
"$ADB" -s "$MOTO_ADDR" shell am start -a android.intent.action.VIEW -d http://localhost:5173 >/dev/null
"$ADB" -s "$SAMSUNG_ADDR" shell am start -a android.intent.action.VIEW -d http://localhost:5173 >/dev/null

echo "Abriendo las dos pantallas. Cerrá ambas ventanas de scrcpy para terminar."
"$SCRCPY" -s "$MOTO_ADDR" --window-title="Moto G23" --window-x=30 --window-y=60 --window-width=540 --window-height=900 --stay-awake --no-audio &
MOTO_PID=$!
"$SCRCPY" -s "$SAMSUNG_ADDR" --window-title="Samsung S22" --window-x=600 --window-y=60 --window-width=540 --window-height=900 --stay-awake --no-audio &
SAMSUNG_PID=$!
trap 'kill "$MOTO_PID" "$SAMSUNG_PID" 2>/dev/null || true' EXIT INT TERM
wait "$MOTO_PID" "$SAMSUNG_PID"
