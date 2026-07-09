// Minimal ambient declaration for the monotonic clock source, kept
// deliberately narrow instead of pulling in the full `DOM` lib (which would
// blur the "core has zero DOM/browser dependency" boundary). Both Node.js
// (via `perf_hooks`, exposed as a global since Node 16) and every browser
// provide a global `performance.now()`.
declare const performance: { now(): number };
