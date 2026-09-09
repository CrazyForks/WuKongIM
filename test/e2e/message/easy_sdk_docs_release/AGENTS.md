# Web EasySDK documentation release acceptance

This opt-in scenario compiles the literal bilingual Web tutorial TypeScript
against one exact npm artifact, then runs it in Chromium against a real
256-hash-slot single-node cluster with Token authentication enabled.

- The Go test owns cluster lifecycle through `test/e2e/suite` and process-tree cleanup.
- `prepare.mjs` verifies the consumer lock's SDK version and npm integrity before
  installation; npm lifecycle scripts stay disabled. Keep tools exactly locked.
- `smoke.mjs` owns a loopback BFF, two isolated browser sessions and bounded
  bidirectional delivery, cleanup, reconnect and connection-timeout assertions.
- Execute tutorial code only in the browser. Browser clients receive only their
  own BFF-issued credentials; Product HTTP provisioning and online-status checks
  stay in the Node harness. Never export credentials, payloads or raw browser logs.
- Upload only the bounded plan and receipt. A receipt names exact package,
  source, tutorial, consumer/tool lock and browser identities, and does not
  certify multi-node recovery or earlier live matrices.
- Require `WK_E2E_EASYSDK_ARTIFACTS` to opt in; ordinary E2E runs skip this case.

## Run

Install the locked tools here with `npm ci --ignore-scripts`, install their
Chromium with `npx --no-install playwright install chromium`, then discover a
plan and run `node prepare.mjs <artifact-directory>` from this directory.

```bash
WK_E2E_EASYSDK_ARTIFACTS=/absolute/artifact-directory GOWORK=off go test -tags=e2e ./test/e2e/message/easy_sdk_docs_release -count=1 -timeout=5m -p=1 -v
```
