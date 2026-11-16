import type { DirectoryTrustedContext } from './directory-review';

// Trusted PR/release inputs, separate from candidate-controlled data.
// Root approved the exact source slice after Sol's retained independent review.
// Same-user modification of trusted code is outside this boundary; these roles
// identify agent workflow responsibility, not independently authenticated people.
export const DIRECTORY_REVIEW_AUTHORITY: DirectoryTrustedContext = {
  selectionSha256: 'bfdf4e30af54b9b87fe2af85c518a50a47b77ce393c3245107e04dd9ff40f4f7',
  operator: 'agent:root',
  reviewer: 'agent:sol_gl04_review',
  priorState: {
    path: 'docs/discovery/go-live/evidence/GL04/generations/cfb33800e554f75836f2fcc2c659b3edd37eb97ac66d7b1efd61f5f71bdb3891.json',
    sha256: 'cfb33800e554f75836f2fcc2c659b3edd37eb97ac66d7b1efd61f5f71bdb3891',
  },
};
export const DIRECTORY_REVIEW_ARTIFACT = {
  path: 'docs/discovery/go-live/execution/GL05-selection-review.json',
  sha256: 'c0566029032d7e27df634d7bf63aa26d67f5cfa7254b3dd5f8b3192f78780782',
} as const;
