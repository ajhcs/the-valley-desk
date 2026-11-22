# Paper-to-repository links

`paper_repository_links` records that a paper's full text links to a repository that is already a directory project. It does not say the paper released the repository: the release label failed its audit (15% wrong in 200), so the site shows these links under their own plainer headings, "Papers that link to this repository" on project pages and "Code linked from this paper" on publication pages. The publication `projects` field keeps its meaning of software the paper releases.

Only the paper id and project id are stored. Removed papers and removed projects drop out of both pages immediately, because the queries read through `research_visible` and the project catalogue.

## Apply

1. Record a Time Travel bookmark.
2. Apply `migrations/0048_paper_repository_links.sql` through a scoped migration directory, as for 0047. The Worker reads the table as empty until it exists, so the deploy and the migration can go in either order.
3. Generate and load the links from the reviewed CSV, then confirm the row count:

   ```sh
   python3 ops/load-paper-links.py existing-project-links.csv > links.sql
   npx --no-install wrangler d1 execute the-valley-desk --remote --file links.sql
   npx --no-install wrangler d1 execute the-valley-desk --remote --command "SELECT count(*) FROM paper_repository_links"
   ```

The load only adds rows and is safe to replay. Use `--replace` to supersede an earlier file.
