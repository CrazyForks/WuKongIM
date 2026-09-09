#!/usr/bin/env bash
set -euo pipefail

probe="${GITHUB_WORKSPACE}/test/e2e/message/easy_sdk_docs_release/sandbox.mjs"
if node "$probe"; then
  exit 0
else
  result=$?
fi
[[ "$result" == 78 ]]
[[ "${GITHUB_RUN_ID}" =~ ^[0-9]+$ ]]
browser_path="$(node "$probe" path)"
[[ "$browser_path" == "$HOME/.cache/ms-playwright/"* ]]
[[ "$browser_path" =~ ^/[a-zA-Z0-9_./-]+$ ]]
[[ -x "$browser_path" ]]

# Ubuntu restricts unprivileged user namespaces. Grant only this exact browser
# executable the userns capability; do not disable the host-wide restriction.
profile_path="${RUNNER_TEMP}/wk-easy-sdk-chromium-${GITHUB_RUN_ID}.apparmor"
cat > "$profile_path" <<EOF
profile wk-easy-sdk-chromium-${GITHUB_RUN_ID} "$browser_path" flags=(unconfined) {
  userns,
}
EOF
printf 'EASY_SDK_CHROMIUM_PROFILE=%s\n' "$profile_path" >> "$GITHUB_ENV"
sudo apparmor_parser -r "$profile_path"
node "$probe"
