# Matched Terra screening pilot

The first pilot did **not demonstrate a speed or accuracy gain**. Nine GPT-6.1
Terra workers ran as three control, three packet and three blinded reference
reviewers. Each arm covered the same 100 native IDs, sampled from 449 outside
the first review. Each had the same source budget.
The [results receipt](GL08-terra-pilot-results.json) pins the frozen manifest and
private decision and timing receipts by hash.

| Arm | Recorded agent minutes | Wall seconds, first start to last finish | Eligible calls | Rejected | Held | Agreement with blinded labels |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Control | 1.89 | 83.87 | 0 | 1 | 99 | 98 / 100 |
| Packet | 2.68 | 104.67 | 2 provisional | 1 | 97 | 96 / 100 |
| Blinded reference | 2.20 | 63.19 | 0 | 3 | 97 | — |

The packet arm recorded **41.5% more agent time**, or 1.61 seconds per lead
against 1.13. These are worker intervals. Packet preparation took under a
second. Orchestration and post-run adjudication are outside the table. All
three arms used 50 source opens. The packet and reference logs also recorded
19 and four query operations respectively, including some cached in-page
searches. The control logged zero queries.

The two packet positives still need a confirmed dated regional link.
Post-run review found that all three arms held SleepBoost despite its exact
native ID already being in the signed catalog. Adding that known positive to
the reference yields one eligible, three rejected and 96 held. Control and
packet label agreement falls to 97 and 95 of 100. A held label marks unresolved
evidence. Agreement on the holds cannot establish accuracy, and neither arm
produced a confirmed admission-ready result. Time per such listing is undefined.

Control workers batched some steps called sequential in the protocol. One
control worker displayed its packet before its clock started. One packet
worker recorded source reservations after dispatch. The results are
descriptive and qualification is **inconclusive**.

Only two packets had exact-work source hints. A repeat needs to join the
signed catalog, qualified source observations and intake hints by native
ID before dispatch, with the source trust levels intact. The runner should
own the clocks and reserve source budget before issuing each request. Freeze
a fresh matched sample and assess confirmed positives apart from unresolved
holds.
