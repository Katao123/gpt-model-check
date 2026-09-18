# Documentation examples

All five examples use synthetic data and are visibly labeled **SIMULATED**. They are not live model results, saved user reports, or evidence of detection accuracy. No model requests are made while generating them.

`build.mjs` uses the production `decisionDetails` and `presentationFor` functions, the bundled five state illustrations, and a simplified dark conversation layout. The static record/retry labels in the images are illustrative, not working controls.

To regenerate from the repository root:

```sh
node docs/examples/build.mjs
node docs/examples/capture.mjs
```

Capturing images requires Playwright and its Chromium browser in your development environment. Alternatively, set `GPT_MODEL_CHECK_PLAYWRIGHT_MODULE` to the absolute entry file of an existing Playwright installation. These are optional documentation tools; users of the skill do not need Playwright.

The generated `gallery.html` is ignored by Git. The five PNGs in `assets/examples/` are committed and embedded in both READMEs. Runtime code, scoring thresholds, and installed state illustrations are not changed by this workflow.
