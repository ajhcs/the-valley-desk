-- Repair legacy rows created before approval and runtime publication were one
-- atomic operation. A live publication is authoritative; otherwise the item
-- returns to review instead of remaining ambiguously approved but invisible.
UPDATE content_candidates
SET
  item_status = 'published',
  content_json = (
    SELECT p.content_json FROM published_content p
    WHERE p.candidate_id = content_candidates.id
  )
WHERE queue_status = 'approved'
  AND EXISTS (
    SELECT 1 FROM published_content p
    WHERE p.candidate_id = content_candidates.id
  );

UPDATE content_candidates
SET queue_status = 'review', reviewed_at = NULL
WHERE queue_status = 'approved'
  AND NOT EXISTS (
    SELECT 1 FROM published_content p
    WHERE p.candidate_id = content_candidates.id
  );
