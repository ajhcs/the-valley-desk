# Trusted retained PA browser packet intake

The internal `intakePaBrowserOriginal` entrypoint accepts bounded original ZIP,
unchanged download receipt and acquisition-envelope bytes plus injected D1 and
private durable retention. It performs no acquisition, credential lookup, source
activation or publication. It is not routed to HTTP or scheduled execution.
The local `privatePaPacketRetainer` stores content-addressed private originals;
existing bytes are checked, never overwritten. Interrupted retention is replayable.
Neither a storage acknowledgment nor hashes authenticate browser origin: the
trusted operator and actual accepted source reviews remain the authority boundary.

Invalid byte/endpoint/tool-observation/clock bindings are rejected. Valid packets
are retained before enrollment checks; inactive/unqualified sources remain pending
review outside collection tables. Accepted active sources use the existing
collector lease, raw/page acknowledgments, native deterministic replay and
transactional permission/dependency guards to stage the existing editorial workflow.
This entrypoint always stages review only. Publication still belongs to the existing
independent guarded workflow, and this slice neither invokes nor enables it.

Packet identity binds source configuration and all three original byte hashes.
Acquisition completion and embedded export/bill dates retain their distinct meanings.
Null HTTP status/headers/final response URL/redirect chain stay null in the retained
original envelope. The browser adapter omits an unknown HTTP status in its typed
snapshot; it does not manufacture 200. Replay does not update collection check,
success, failure or scheduling state. Browser pages cannot supply an HTTP conditional
representation, and public health identifies their browser origin rather than a new
successful upstream check. Stale exports and regressed retained source/bill clocks
remain held. Retry after partial staging reuses raw observations and native drafts.

## Retained denial and unattended boundary

The September 30 ZIP attempt has a retained 2,914-byte publisher-branded HTML
403 response with a matching digest and recorded request/receipt timestamps around
20:28 UTC. A separate earlier `/data` attempt recorded 403 but failed body retention.
The branded denial supports an HTTP response observation, not identification of
an origin server, intermediary, WAF rule, user-agent rule or authentication cause.
The HTML/robots 406 hold remains separate and its policy unknown. No held route was
retried. Successful ordinary browser receipts establish those downloads, not the
cause of the earlier denial or permission for another transport.

The tracked collector uses ordinary fetch; Worker configuration has no browser
acquisition binding. Current missing unattended capability is an authorized,
bounded ordinary-browser acquisition and artifact handoff to a trusted D1 caller.
The existing Worker collection/native editorial pipeline can host the persistence
and review stages implemented here. The manually proven cloud-browser tool does
not by itself establish an unattended runtime or authenticated artifact-transfer
route. Existing protected operations/review infrastructure is a potential host for
such a separately reviewed integration; this slice adds no endpoint, secret,
service, migration, trigger or production integration. Local documentation does
not establish current Plumbob service availability, and its production memory is
absent here. No production service was inspected or started.

The publisher's retained public description offers hourly weekday downloads;
that does not diagnose the old 403. No evidence here makes publisher contact an
obligatory step for importing already obtained originals. Clarification could be
useful for a supported unattended transport, but its necessity remains unknown.
Actual rights/access/engineering/editorial/provenance reviews and a reviewed
cadence policy remain required before source qualification/activation.
