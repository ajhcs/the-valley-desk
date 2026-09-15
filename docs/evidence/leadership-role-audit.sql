-- Read-only candidate inventory for a separately authorized leadership-role repair.
-- Do not turn this into an UPDATE without source-by-source editorial review.

SELECT
  r.id AS role_id,
  r.person_id,
  p.display_name,
  p.normalized_name,
  r.institution_id,
  r.title,
  r.source_id,
  r.evidence_url,
  r.effective_from,
  r.effective_to
FROM executive_roles AS r
JOIN covered_people AS p ON p.id = r.person_id
WHERE r.person_id LIKE 'person-inst-%'
ORDER BY r.institution_id, r.effective_from, r.person_id;

SELECT
  institution_id,
  COUNT(*) AS dynamic_roles,
  SUM(CASE WHEN effective_to IS NOT NULL THEN 1 ELSE 0 END) AS closed_dynamic_roles
FROM executive_roles
WHERE person_id LIKE 'person-inst-%'
GROUP BY institution_id
ORDER BY institution_id;
