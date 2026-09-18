# Third-party notices

This project is distributed under the MIT license. The following upstream notices are retained. Attribution does not imply endorsement or affiliation.

## ModelTrace

- Repository: https://github.com/xqy2006/ModelTrace
- Pinned commit: `3f0dd2f4b451ad424f3b165a108a468efe4d4d81`
- Copyright: © 2026 xqy2006
- License: [MIT](assets/LICENSE-ModelTrace.txt)
- Bundled material: reference data in `assets/bank.json`, scorer in `scripts/fingerprint-core.mjs`, and the numerical probe approach.
- Bank build timestamp: `2026-09-05T02:13:56.070726+00:00`.
- Bank SHA-256: `6a3f7e4d703990a2322cf535020309380ca858654345d8fe5db278578568bad3`.
- Scorer SHA-256: `83fa5bd611e18f8339122582335123c8ea168ed242298bb31f4e363abeeb6e4a`.

The stored bank and scorer use UTF-8 / LF. `assets/provenance.json` and the test suite track these hashes. The Astra fixture in `tests/fixtures/astra-reference.json` is a reference-data smoke-test fixture, not an independent accuracy benchmark.

## is-gpt-nerfed

- Repository: https://github.com/kiyoakii/is-gpt-nerfed
- Pinned commit: `38498671b32015b97901717207d38b4508b57301`
- Copyright: © 2026 is-gpt-nerfed contributors
- License: [MIT](assets/LICENSE-is-gpt-nerfed.txt)
- Adapted/reference material: native Codex app-server probe transport, temporary forks and numerical-probe execution patterns in `scripts/app-server.mjs` and `scripts/probes.mjs`.

## Work specific to this project

This project adds Codex skill packaging, current-task configuration checks, fresh-session sampling, runtime discovery, conservative decision gates, explanations, local receipts, state illustrations, the retry interaction, and an optional local Star reminder. These additions do not establish a calibrated identity probability or validate every client/model combination.

The five cat state illustrations in `assets/states/` were created for this project with AI image generation and are included under the project's MIT license. Codex supplies the Lucide icon renderer used by the retry link; no Lucide library is bundled here.

Node.js and Codex are external runtime requirements, not bundled software. No third-party npm package is required at runtime. CI uses GitHub Actions checkout/setup-node; tests use Node's built-in test runner and local fixtures, without live model requests.
