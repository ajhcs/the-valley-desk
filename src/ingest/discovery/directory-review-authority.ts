import type { DirectoryTrustedContext } from './directory-review';

// Trusted PR/release inputs, separate from candidate-controlled data.
// Root approved the exact source slice after Sol's retained independent review.
// Same-user modification of trusted code is outside this boundary; these roles
// identify agent workflow responsibility, not independently authenticated people.
export const DIRECTORY_REVIEW_AUTHORITY: DirectoryTrustedContext = {
  selectionSha256: '0e790590fd6d58c71320fb6935f7316115257c2afa7a7efdee9d9c7d429856a3',
  operator: 'agent:root',
  reviewer: 'agent:sol_gl04_review',
  priorState: null, // First directory generation; the legacy v3 catalog is preserved.
};
export const DIRECTORY_REVIEW_ARTIFACT = {
  path: 'docs/discovery/go-live/execution/GL04-selection-review.json',
  sha256: 'b490c497a550618fb3fb2b30726e9b40f8e0f44aeea7dea637d7c92883b09f91',
} as const;
