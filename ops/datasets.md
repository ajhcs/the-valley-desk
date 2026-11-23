# Dataset directory operations

Migration 0050 creates `dataset_visibility` with the switch off. Load reviewed dataset JSONL with `ops/load-research.py --datasets PATH`; use `--respect-removals` for imports. Dataset IDs in `dataset_removals` hide records immediately. Add removal IDs using `--dataset-removals PATH` (a JSON array), and refresh summaries after removals.

Run `ops/research-summary.sql` after every import, removal, or visibility change. It refreshes counts, partner counts, and dataset filter choices. Switching off hides dataset records immediately; refreshed summaries are required for current counts and choices when switching on. The visibility change and summary refresh are separate operational actions; neither is performed by this documentation.
