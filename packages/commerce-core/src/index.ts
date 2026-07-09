// @sera/commerce-core — scaffold against the pinned canonical shapes.
// ADR-001 (SE-I09): READ-SIDE ONLY — no proceeds computation, no settlement
// math, no funds, no shape redefinition. Pinned-waterfall fixture assertions
// + the SeraDeliveryView projection are the whole package at SE0.1.
export * from './fixtures.js';
export * from './delivery-view.js';
