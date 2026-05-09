#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

log() {
  printf '\n[%s] %s\n' "Pal" "$1"
}

fail() {
  printf '\n[Pal] Error: %s\n' "$1" >&2
  exit 1
}

find_android_tool() {
  local tool_name="$1"

  if command -v "$tool_name" >/dev/null 2>&1; then
    command -v "$tool_name"
    return 0
  fi

  local sdk_root="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
  local candidates=()

  if [[ -n "$sdk_root" ]]; then
    candidates+=(
      "$sdk_root/platform-tools/$tool_name"
      "$sdk_root/emulator/$tool_name"
      "$sdk_root/cmdline-tools/latest/bin/$tool_name"
      "$sdk_root/tools/bin/$tool_name"
    )
  fi

  if [[ -n "${LOCALAPPDATA:-}" ]]; then
    candidates+=(
      "$LOCALAPPDATA/Android/Sdk/platform-tools/$tool_name.exe"
      "$LOCALAPPDATA/Android/Sdk/emulator/$tool_name.exe"
      "$LOCALAPPDATA/Android/Sdk/cmdline-tools/latest/bin/$tool_name.bat"
      "$LOCALAPPDATA/Android/Sdk/tools/bin/$tool_name.bat"
    )
  fi

  for candidate in "${candidates[@]}"; do
    if [[ -x "$candidate" || -f "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  return 1
}

ADB="$(find_android_tool adb || true)"
EMULATOR="$(find_android_tool emulator || true)"
AVDMANAGER="$(find_android_tool avdmanager || true)"

[[ -n "$ADB" ]] || fail "adb was not found. Install Android SDK platform-tools or add adb to PATH."

list_ready_devices() {
  "$ADB" devices | awk 'NR > 1 && $2 == "device" { print $1 }'
}

wait_for_boot() {
  local serial="$1"
  local timeout_seconds="${2:-180}"
  local elapsed=0

  log "Waiting for emulator $serial to finish booting..."
  "$ADB" -s "$serial" wait-for-device

  until [[ "$("$ADB" -s "$serial" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" == "1" ]]; do
    sleep 3
    elapsed=$((elapsed + 3))
    if (( elapsed >= timeout_seconds )); then
      fail "Timed out waiting for emulator $serial to boot."
    fi
  done

  "$ADB" -s "$serial" shell input keyevent 82 >/dev/null 2>&1 || true
}

first_ready_device="$(list_ready_devices | head -n 1 || true)"

if [[ -n "$first_ready_device" ]]; then
  log "Found ready Android device: $first_ready_device"
else
  [[ -n "$EMULATOR" ]] || fail "No device is ready and Android emulator was not found."
  [[ -n "$AVDMANAGER" ]] || fail "No device is ready and avdmanager was not found, so no emulator can be selected."

  mapfile -t avds < <("$AVDMANAGER" list avd | awk -F': ' '/^[[:space:]]*Name: / { print $2 }')

  if (( ${#avds[@]} == 0 )); then
    fail "No ready device found and no Android Virtual Devices are configured."
  fi

  log "No ready device found. Available Android emulators:"
  printf '  %s\n' "${avds[@]}"

  selected_avd="${PAL_ANDROID_AVD:-${avds[0]}}"
  log "Starting emulator: $selected_avd"
  "$EMULATOR" -avd "$selected_avd" >/dev/null 2>&1 &

  "$ADB" wait-for-device
  booting_serial="$(list_ready_devices | head -n 1 || true)"
  [[ -n "$booting_serial" ]] || fail "Emulator started, but adb did not report a ready device."
  wait_for_boot "$booting_serial"
fi

log "Running Pal on Android..."
run_args=(run-android)

if command -v node >/dev/null 2>&1; then
  if node -e "require('node:net').connect(8081, '127.0.0.1').once('connect', function () { process.exit(0); }).once('error', function () { process.exit(1); });"; then
    log "Metro is already running on port 8081; reusing it."
    run_args+=(--no-packager)
  fi
fi

npx react-native "${run_args[@]}"
