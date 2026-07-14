#!/usr/bin/env bash

set -euo pipefail

PINNED_COMMIT='17f425162f3538c40b26e353a4c7f8d539592af4'
CONFIG_RELATIVE='local-chains/v32.0/multi_chain'
L1_RPC_URL="${L1_RPC_URL:-http://127.0.0.1:8545}"
L2_RPC_URL="${L2_RPC_URL:-http://127.0.0.1:3050}"
L2_RPC_URL_SECOND="${L2_RPC_URL_SECOND:-http://127.0.0.1:3051}"
L1_CHAIN_ID='31337'
L2_CHAIN_ID='6565'
L2_CHAIN_ID_SECOND='6566'
L2_BRIDGEHUB='0x0000000000000000000000000000000000010002'
ZERO_HASH='0x0000000000000000000000000000000000000000000000000000000000000000'
DEFAULT_L1_SENDER='0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
SDK_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd -P)"
LOG_DIR="${ATOMIC_INTEROP_LOG_DIR:-$SDK_ROOT/logs/atomic-interop}"

usage() {
  cat <<'EOF'
Usage: atomic-interop-env.sh <command> [zksync-os-server-dir]

Commands:
  doctor    Validate tools, checkout pin, cleanliness, and preset files.
  start     Run the pinned upstream launcher in the foreground.
  wait      Wait for L1 and both L2 RPCs to report the expected chain IDs.
  status    Inspect RPC chain IDs and reciprocal chain registration.
  register  Register chains 6565 and 6566 with each other on L1.
  env       Print non-secret environment exports for local tests.
  smoke     Run the upstream atomic-swap driver (requires a test key in env).
  help      Show this help.

Set ZKSYNC_OS_SERVER_DIR instead of passing the checkout path. Stop `start` with
Ctrl-C in the same terminal/session so the upstream cleanup trap can run.
EOF
}

info() {
  printf '[atomic-interop] %s\n' "$*"
}

warn() {
  printf '[atomic-interop] warning: %s\n' "$*" >&2
}

die() {
  printf '[atomic-interop] error: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "Required command '$1' is not available."
}

resolve_server_dir() {
  local candidate="${1:-${ZKSYNC_OS_SERVER_DIR:-}}"
  [[ -n "$candidate" ]] || die 'Pass zksync-os-server-dir or set ZKSYNC_OS_SERVER_DIR.'
  [[ -d "$candidate" ]] || die "zksync-os-server directory does not exist: $candidate"
  (cd "$candidate" && pwd -P)
}

validate_checkout() {
  local server_dir="$1"
  local head dirty anvil_help

  require_command git
  require_command cargo
  require_command anvil
  require_command cast
  require_command curl
  require_command gzip
  require_command npm
  require_command realpath

  git -C "$server_dir" rev-parse --is-inside-work-tree >/dev/null 2>&1 ||
    die "Not a Git checkout: $server_dir"

  head="$(git -C "$server_dir" rev-parse HEAD)"
  [[ "$head" == "$PINNED_COMMIT" ]] ||
    die "Expected zksync-os-server $PINNED_COMMIT, found $head. Use a dedicated checkout."

  dirty="$(git -C "$server_dir" status --short --untracked-files=no)"
  [[ -z "$dirty" ]] ||
    die 'The zksync-os-server checkout has tracked changes. Use a clean dedicated checkout.'

  [[ -x "$server_dir/run_local.sh" ]] || die 'Pinned checkout is missing executable run_local.sh.'
  [[ -f "$server_dir/$CONFIG_RELATIVE/chain_6565.yaml" ]] || die 'Missing chain_6565.yaml.'
  [[ -f "$server_dir/$CONFIG_RELATIVE/chain_6566.yaml" ]] || die 'Missing chain_6566.yaml.'
  [[ -f "$server_dir/local-chains/v32.0/l1-state.json.gz" ]] || die 'Missing v32.0 L1 state.'
  [[ -f "$server_dir/$CONFIG_RELATIVE/atomic-swap/package-lock.json" ]] ||
    die 'Missing pinned atomic-swap package lock.'

  anvil_help="$(anvil --help)"
  [[ "$anvil_help" == *'--mixed-mining'* ]] ||
    die 'Installed anvil does not support the required --mixed-mining flag.'
  [[ "$anvil_help" == *'--slots-in-an-epoch'* ]] ||
    die 'Installed anvil does not support the required --slots-in-an-epoch flag.'
}

rpc_chain_id() {
  cast chain-id \
    --rpc-url "$1" \
    --rpc-timeout "${ATOMIC_INTEROP_RPC_TIMEOUT_SECONDS:-2}" \
    2>/dev/null
}

base_token_asset_id() {
  cast call \
    "$L2_BRIDGEHUB" \
    'baseTokenAssetId(uint256)(bytes32)' \
    "$2" \
    --rpc-url "$1" \
    --rpc-timeout "${ATOMIC_INTEROP_RPC_TIMEOUT_SECONDS:-2}" \
    2>/dev/null
}

bridgehub_address() {
  local config="$1/$CONFIG_RELATIVE/chain_6565.yaml"
  local address
  address="$(awk -F"'" '/^[[:space:]]*bridgehub_address:/ { print $2; exit }' "$config")"
  [[ "$address" =~ ^0x[0-9a-fA-F]{40}$ ]] || die "Could not read bridgehub_address from $config"
  printf '%s\n' "$address"
}

print_chain() {
  local label="$1"
  local url="$2"
  local expected="$3"
  local actual

  if ! actual="$(rpc_chain_id "$url")"; then
    warn "$label is unavailable at $url"
    return 1
  fi
  if [[ "$actual" != "$expected" ]]; then
    warn "$label at $url reported chain ID $actual; expected $expected"
    return 1
  fi
  info "$label ready: chain $actual at $url"
}

registration_values() {
  local a_to_b b_to_a
  a_to_b="$(base_token_asset_id "$L2_RPC_URL" "$L2_CHAIN_ID_SECOND")" || return 1
  b_to_a="$(base_token_asset_id "$L2_RPC_URL_SECOND" "$L2_CHAIN_ID")" || return 1
  printf '%s\n%s\n' "$a_to_b" "$b_to_a"
}

cmd_doctor() {
  local server_dir="$1"
  validate_checkout "$server_dir"
  info "checkout pinned and clean: $server_dir"
  info "preset: $CONFIG_RELATIVE"
  info "logs: $LOG_DIR"
}

cmd_status() {
  local values a_to_b b_to_a

  require_command cast
  print_chain 'L1' "$L1_RPC_URL" "$L1_CHAIN_ID" || return 1
  print_chain 'L2 A' "$L2_RPC_URL" "$L2_CHAIN_ID" || return 1
  print_chain 'L2 B' "$L2_RPC_URL_SECOND" "$L2_CHAIN_ID_SECOND" || return 1

  if ! values="$(registration_values)"; then
    warn 'Could not read reciprocal baseTokenAssetId values.'
    return 1
  fi
  a_to_b="$(printf '%s\n' "$values" | sed -n '1p')"
  b_to_a="$(printf '%s\n' "$values" | sed -n '2p')"

  if [[ "$a_to_b" == "$ZERO_HASH" ]]; then
    warn "chain $L2_CHAIN_ID has not registered chain $L2_CHAIN_ID_SECOND"
  else
    info "chain $L2_CHAIN_ID knows chain $L2_CHAIN_ID_SECOND: $a_to_b"
  fi
  if [[ "$b_to_a" == "$ZERO_HASH" ]]; then
    warn "chain $L2_CHAIN_ID_SECOND has not registered chain $L2_CHAIN_ID"
  else
    info "chain $L2_CHAIN_ID_SECOND knows chain $L2_CHAIN_ID: $b_to_a"
  fi
}

cmd_wait() {
  local timeout="${ATOMIC_INTEROP_START_TIMEOUT_SECONDS:-1800}"
  local deadline=$((SECONDS + timeout))
  local l1 a b

  require_command cast
  info "waiting up to ${timeout}s for the local atomic interop RPCs"
  while ((SECONDS < deadline)); do
    l1="$(rpc_chain_id "$L1_RPC_URL" || true)"
    a="$(rpc_chain_id "$L2_RPC_URL" || true)"
    b="$(rpc_chain_id "$L2_RPC_URL_SECOND" || true)"
    if [[ "$l1" == "$L1_CHAIN_ID" && "$a" == "$L2_CHAIN_ID" && "$b" == "$L2_CHAIN_ID_SECOND" ]]; then
      cmd_status
      return 0
    fi
    sleep 2
  done
  die "RPC readiness timed out after ${timeout}s. Inspect the active start session and $LOG_DIR."
}

ensure_ports_free() {
  local port
  if command -v lsof >/dev/null 2>&1; then
    for port in 8545 3050 3051; do
      if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
        die "TCP port $port is already in use. Inspect the existing process before starting."
      fi
    done
    return
  fi

  if rpc_chain_id "$L1_RPC_URL" >/dev/null ||
    rpc_chain_id "$L2_RPC_URL" >/dev/null ||
    rpc_chain_id "$L2_RPC_URL_SECOND" >/dev/null; then
    die 'A configured RPC already responds. Inspect it before starting another environment.'
  fi
}

cmd_start() {
  local server_dir="$1"
  cmd_doctor "$server_dir"
  ensure_ports_free
  mkdir -p "$LOG_DIR"
  info 'starting upstream run_local.sh; keep this terminal/session ID for teardown'
  cd "$server_dir"
  exec ./run_local.sh "./$CONFIG_RELATIVE" --logs-dir "$LOG_DIR"
}

send_registration() {
  local registration_sender="$1"
  local remote_chain_id="$2"
  local local_chain_id="$3"
  local sender="$4"

  info "registering chain $remote_chain_id on chain $local_chain_id"
  if ! cast send \
    --unlocked \
    --from "$sender" \
    "$registration_sender" \
    'registerChain(uint256,uint256)' \
    "$remote_chain_id" \
    "$local_chain_id" \
    --rpc-url "$L1_RPC_URL" \
    --timeout 120 \
    --quiet; then
    die 'Chain registration failed. Set ATOMIC_INTEROP_L1_SENDER to a funded, unlocked Anvil account.'
  fi
}

cmd_register() {
  local server_dir="$1"
  local bridgehub registration_sender sender a_to_b b_to_a timeout deadline

  validate_checkout "$server_dir"
  cmd_status
  bridgehub="$(bridgehub_address "$server_dir")"
  registration_sender="$(cast call \
    "$bridgehub" \
    'chainRegistrationSender()(address)' \
    --rpc-url "$L1_RPC_URL" \
    --rpc-timeout "${ATOMIC_INTEROP_RPC_TIMEOUT_SECONDS:-2}")"
  [[ "$registration_sender" =~ ^0x[0-9a-fA-F]{40}$ ]] ||
    die "Bridgehub returned an invalid chainRegistrationSender: $registration_sender"

  sender="${ATOMIC_INTEROP_L1_SENDER:-$DEFAULT_L1_SENDER}"
  [[ "$sender" =~ ^0x[0-9a-fA-F]{40}$ ]] || die 'ATOMIC_INTEROP_L1_SENDER must be an address.'

  a_to_b="$(base_token_asset_id "$L2_RPC_URL" "$L2_CHAIN_ID_SECOND")"
  b_to_a="$(base_token_asset_id "$L2_RPC_URL_SECOND" "$L2_CHAIN_ID")"
  if [[ "$a_to_b" == "$ZERO_HASH" ]]; then
    send_registration "$registration_sender" "$L2_CHAIN_ID_SECOND" "$L2_CHAIN_ID" "$sender"
  else
    info "chain $L2_CHAIN_ID already knows chain $L2_CHAIN_ID_SECOND"
  fi
  if [[ "$b_to_a" == "$ZERO_HASH" ]]; then
    send_registration "$registration_sender" "$L2_CHAIN_ID" "$L2_CHAIN_ID_SECOND" "$sender"
  else
    info "chain $L2_CHAIN_ID_SECOND already knows chain $L2_CHAIN_ID"
  fi

  timeout="${ATOMIC_INTEROP_REGISTRATION_TIMEOUT_SECONDS:-300}"
  deadline=$((SECONDS + timeout))
  while ((SECONDS < deadline)); do
    a_to_b="$(base_token_asset_id "$L2_RPC_URL" "$L2_CHAIN_ID_SECOND" || true)"
    b_to_a="$(base_token_asset_id "$L2_RPC_URL_SECOND" "$L2_CHAIN_ID" || true)"
    if [[ -n "$a_to_b" && "$a_to_b" != "$ZERO_HASH" && -n "$b_to_a" && "$b_to_a" != "$ZERO_HASH" ]]; then
      info 'reciprocal chain registration is ready'
      cmd_status
      return 0
    fi
    sleep 2
  done
  die "Chain registration did not propagate within ${timeout}s. Inspect the chain logs in $LOG_DIR."
}

cmd_env() {
  printf 'export L1_RPC_URL=%q\n' "$L1_RPC_URL"
  printf 'export L2_RPC_URL=%q\n' "$L2_RPC_URL"
  printf 'export L2_RPC_URL_SECOND=%q\n' "$L2_RPC_URL_SECOND"
  printf 'export L2_CHAIN_ID=%q\n' "$L2_CHAIN_ID"
  printf 'export L2_CHAIN_ID_SECOND=%q\n' "$L2_CHAIN_ID_SECOND"
}

cmd_smoke() {
  local server_dir="$1"
  local private_key="${ATOMIC_INTEROP_PRIVATE_KEY:-${PRIVATE_KEY:-}}"
  local a_to_b b_to_a driver_dir

  validate_checkout "$server_dir"
  cmd_status
  [[ "$private_key" =~ ^0x[0-9a-fA-F]{64}$ ]] ||
    die 'Set PRIVATE_KEY or ATOMIC_INTEROP_PRIVATE_KEY to a funded local 32-byte test key.'

  a_to_b="$(base_token_asset_id "$L2_RPC_URL" "$L2_CHAIN_ID_SECOND")"
  b_to_a="$(base_token_asset_id "$L2_RPC_URL_SECOND" "$L2_CHAIN_ID")"
  [[ "$a_to_b" != "$ZERO_HASH" && "$b_to_a" != "$ZERO_HASH" ]] ||
    die 'Reciprocal chain registration is missing. Run register first.'

  driver_dir="$server_dir/$CONFIG_RELATIVE/atomic-swap"
  if [[ "${ATOMIC_INTEROP_SKIP_INSTALL:-0}" != '1' ]]; then
    info 'installing the pinned upstream smoke-driver dependencies with npm ci'
    (cd "$driver_dir" && npm ci)
  fi

  info 'running the upstream atomic-swap environment smoke test'
  (
    export PRIVATE_KEY="$private_key"
    export L1_RPC_URL
    export L2_RPC_URL
    export L2_RPC_URL_SECOND
    cd "$driver_dir"
    npm run atomic-swap
  )
}

command_name="${1:-help}"
if [[ $# -gt 0 ]]; then
  shift
fi

case "$command_name" in
  doctor)
    server_dir="$(resolve_server_dir "${1:-}")" || exit 1
    cmd_doctor "$server_dir"
    ;;
  start)
    server_dir="$(resolve_server_dir "${1:-}")" || exit 1
    cmd_start "$server_dir"
    ;;
  wait)
    cmd_wait
    ;;
  status)
    cmd_status
    ;;
  register)
    server_dir="$(resolve_server_dir "${1:-}")" || exit 1
    cmd_register "$server_dir"
    ;;
  env)
    cmd_env
    ;;
  smoke)
    server_dir="$(resolve_server_dir "${1:-}")" || exit 1
    cmd_smoke "$server_dir"
    ;;
  help|-h|--help)
    usage
    ;;
  *)
    usage >&2
    die "Unknown command: $command_name"
    ;;
esac
