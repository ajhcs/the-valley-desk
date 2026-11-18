import type { DirectoryTrustedContext } from './directory-review';

// Reviewed source inputs pinned separately from candidate records.
export const DIRECTORY_REVIEW_AUTHORITY: DirectoryTrustedContext = {
  "selectionSha256": "15caf66ccca13778623c41ee6e8fd166da681c80eacac96c30f54fe12ab0cbc3",
  "operator": "editorial:cole",
  "reviewer": "verification:codex",
  "priorState": {
    "path": "docs/discovery/go-live/evidence/GL05/generations/6149a74e0293121195a7374f77a79c6a91af5960d6d8e9914da38e415e10ad72.json",
    "sha256": "6149a74e0293121195a7374f77a79c6a91af5960d6d8e9914da38e415e10ad72"
  }
};

export const DIRECTORY_REVIEW_ARTIFACT = {
  "path": "docs/discovery/go-live/execution/GL06-first-release-review.json",
  "sha256": "d186c751dea161dbea72e011fb5ae69a37bb44db1802efd24a9f9c14850efdf2"
} as const;
