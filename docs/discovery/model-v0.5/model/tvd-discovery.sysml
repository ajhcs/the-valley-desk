package TVD_Concept {
    private import ScalarValues::*;

    doc revision /* TVD-CONCEPT-0.5, 2026-11-14. Authoritative multi-source discovery concept and logical architecture.
    This successor refines TVD-CONCEPT-0.4; frozen model SHA256 2db650c71d7a8703ff01b814e1db84629b33c9de99b702e2d90bad30235387a9.
    Typed review, artifact rights and immutable snapshot contracts follow accepted discovery-policy-v1.
    Schema records and modeled checks do not authenticate source truth, editorial authority or database behavior.
    Revision 0.3 and the separate TVD_AsIs model remain unchanged historical baselines.
    Exact revision 0.3 baseline paths and hashes are retained in ../evidence/baseline.json.
    Target elements describe intended design. They do not establish implemented behavior. */

    package Records {
        enum def ReviewState { enum candidate; enum held; enum accepted; enum rejected; }
        enum def DeliveryState { enum current; enum stale; enum unknown; enum archived; enum withdrawn; }
        enum def CreatorRole { enum author; enum creator; enum maintainer; enum publisher; enum contributor; enum inventor; enum assignee; }
        enum def PublicationStage { enum preprint; enum peerReviewed; enum unreviewed; enum unknown; }
        enum def PublicationStatus { enum current; enum corrected; enum retracted; enum withdrawn; enum unknown; }
        enum def SourceOutcome { enum healthy; enum healthyEmpty; enum rateLimited; enum authFailed; enum upstreamFailed; enum parserFailed; enum timedOut; enum unavailable; enum disabled; enum unknown; }
        enum def LinkState { enum proposed; enum confirmed; enum disputed; enum superseded; }


        item def RevisionReference {
            attribute id : String;
            attribute revision : Integer;
            doc /* Positive safe integer revisions never repeat. A value changing A to B to A advances its head twice. */
        }
        enum def ProviderRoute { enum github; enum pubmed; enum crossref; enum arxiv; enum forum; enum institutional; }
        enum def SubjectKind { enum person; enum organization; enum account; enum project; enum artifact; }
        enum def PermissionDecision { enum allow; enum deny; enum unknown; }
        enum def MaterialScope { enum metadataMaterial; enum code; enum text; enum figures; enum data; enum weights; enum forumContent; }
        enum def RightsClassification { enum permitted; enum restricted; enum unknown; }
        enum def DependencyRole { enum commitGuard; enum validity; }
        abstract item def ReviewTarget {
            attribute revision : Integer;
            doc /* The concrete target subtype determines the runtime union discriminator; it is not an independently mutable native field.
            Runtime target identity comes from the typed reference, not a second independently writable ID.
            Creator targets refer to a person or organization; work targets refer to a project or artifact.
            Claim and relationship targets retain independent identities and revisions. An account is not a person.
            Target kind does not grant authority. An independent creator needs no artifact. */
        }
        item def DiscoverySubjectReference {
            attribute subjectId : String;
            attribute subjectKind : SubjectKind;
        }
        item def DiscoveryClaim {
            attribute claimId : String;
            attribute revision : Integer;
            item subjectReference : DiscoverySubjectReference;
            attribute predicate : String;
            attribute evidenceIds : String [1..*];
        }
        item def ReviewedRelationship {
            attribute relationshipId : String;
            attribute revision : Integer;
            item fromSubject : DiscoverySubjectReference;
            item toSubject : DiscoverySubjectReference;
            attribute relationshipKind : String;
            attribute evidenceIds : String [1..*];
        }
        item def CreatorReviewTarget :> ReviewTarget { ref item creator : Creator; }
        item def WorkReviewTarget :> ReviewTarget { ref item work : Work; }
        item def ClaimReviewTarget :> ReviewTarget { ref item claim : DiscoveryClaim; }
        item def RelationshipReviewTarget :> ReviewTarget { ref item relationship : ReviewedRelationship; }
        item def PrecisionDate {
            attribute precision : String;
            attribute reportedValue : String [0..1];
            attribute calendarLowerDate : String [0..1];
            attribute calendarUpperDate : String [0..1];
            attribute instantLowerEpochMs : Integer [0..1];
            attribute instantUpperEpochMs : Integer [0..1];
            doc /* Year, month and day use valid proleptic Gregorian calendar bounds at original precision.
            These coordinate intervals assert no UTC instant or timezone. An actual instant requires an explicit offset.
            Unknown timezone cannot invent an instant. Unknown dates cannot satisfy a positive date filter.
            A year crossing a move does not establish location at contribution time. */
        }
        item def ProviderIdentity {
            attribute provider : ProviderRoute;
            attribute installation : String;
            attribute nativeId : String;
            attribute identityKind : SubjectKind;
            doc /* Provider, installation, native identifier and type form an identity tuple.
            Forum installations remain distinct; account identifiers never become person identities by name matching. */
        }
        item def DependencyRevision {
            attribute kind : String;
            attribute id : String;
            attribute revision : Integer;
            attribute expiresAt : String [0..1];
            attribute role : DependencyRole;
            doc /* Only per-target predecessor projection generation is a commit-only guard. All other kinds are validity dependencies.
            A global generation increase caused by an unrelated addition does not invalidate existing projections. */
        }
        item def DependencyVector {
            item entries : DependencyRevision [1..*];
            attribute requiredKeys : String [1..*];
            doc /* The trusted projection builder enumerates every materially used key; caller lists cannot establish completeness.
            Include evidence, claims, decisions, relations, endpoints, identity, material rights, source enrollment/configuration,
            source qualification/permission activation or revocation, verification rules, geographic/relevance/review/public-field policies,
            projection generation and currentness. All expected heads must match in the committing transaction. */
        }
        item def PublicRowReference {
            attribute rowKind : String;
            attribute subjectId : String;
            attribute rowId : String;
            attribute revision : Integer;
            doc /* Immutable public work, person or organization revision. A row ID and revision cannot be reused after correction. */
        }
        item def PublicRevision {
            item row : PublicRowReference;
            item dependencies : DependencyVector;
            item decision : RevisionReference;
            attribute publicationGeneration : Integer;
            attribute publishedAt : String;
            attribute expiresAt : String;
        }
        item def SnapshotCursor {
            attribute tokenId : String;
            attribute snapshotId : String;
            attribute normalizedQuery : String;
            attribute sortMode : String;
            attribute recoveryIncarnation : String;
            attribute afterRowId : String [0..1];
            doc /* Opaque server tokens resolve to durable complete descriptors and keyset positions.
            Malformed or mismatched query/snapshot input returns 400. A supplied token is not itself authorization. */
        }
        item def SnapshotContinuation {
            attribute httpStatus : Integer;
            attribute resultKind : String;
            attribute restart : Boolean;
            doc /* Valid continuation returns 200; malformed/mismatched input returns 400.
            Material invalidation or recovery-incarnation change returns 410 invalidated; expiry returns 410 expired.
            No public rows are delivered from an invalid continuation. */
        }
        item def DiscoverySourceRequest {
            attribute schemaVersion : String;
            attribute operationId : String;
            attribute runId : String;
            attribute sourceId : String;
            attribute provider : ProviderRoute;
            attribute installation : String;
            attribute scopeId : String;
            item enrollment : RevisionReference;
            item configuration : RevisionReference;
            attribute purpose : String;
            item qualification : RevisionReference [0..1];
            item samplingAuthorization : RevisionReference [0..1];
            item permission : RevisionReference;
            item parser : RevisionReference;
            item budgetReservation : RevisionReference;
            item leaseFence : RevisionReference;
            attribute endpointConstructor : String;
            attribute checkpoint : String [0..1];
            doc /* Collection requires current qualification. Qualification-only sample requires a reviewed bounded sampling authorization instead.
            Both require current access/permission/configuration and a registered source scope. A sample cannot activate routine collection. */
        }
        item def DiscoverySourceCapture {
            item request : DiscoverySourceRequest;
            item observations : SourceObservation [0..*];
            attribute outcome : String;
            attribute completeness : String;
            attribute proposedCheckpoint : String [0..1];
            item limitationReceipt : RevisionReference [0..1];
            doc /* Provisional collector payload retains provider continuation before persistence.
            It has no durable page receipt or commit acknowledgment and cannot advance a durable checkpoint. */
        }
        item def DiscoverySourcePage {
            item request : DiscoverySourceRequest;
            item limitationReceipt : RevisionReference [0..1];
            attribute operationId : String;
            attribute runId : String;
            attribute sourceId : String;
            item pageReceipt : RevisionReference;
            item observations : SourceObservation [0..*];
            attribute outcome : String;
            attribute completeness : String;
            attribute nextCheckpoint : String [0..1];
            attribute committed : Boolean;
            doc /* This is a durable acknowledgment with committed=true, emitted only after the trusted store commits.
            Commit retained observations and page receipt before checkpoint advancement.
            Healthy-empty requires zero observations and completed traversal; partial and failed results cannot impersonate it.
            Observation provider, installation and parser must match the exact retained issued request; provider-limited requires a limitation receipt. */
        }

        item def SourceObservation {
            item identity : ProviderIdentity;
            item preciseSourceDate : PrecisionDate;
            attribute observationId : String;
            attribute sourceId : String;
            attribute providerClass : String;
            attribute nativeObjectId : String;
            attribute sourceDatePrecision : String [0..1];
            attribute provenanceOriginId : String;
            attribute sourceUrl : String;
            attribute representationSha256 : String;
            attribute observedAt : String;
            attribute sourceOccurredAt : String [0..1];
            attribute sourceVersion : String [0..1];
            attribute parserVersion : String;
            doc /* Immutable evidence identity. Fetch time and source occurrence time are separate.
            The retained representation can be unavailable; a hash alone does not prove its contents. */
        }
        abstract item def Creator {
            attribute identityReviewState : ReviewState;
            attribute creatorId : String;
            attribute displayName : String;
            attribute externalIdentityUrls : String [0..*];
            attribute evidenceIds : String [1..*];
        }
        item def Person :> Creator {
            attribute orcid : String [0..1];
            attribute githubAccountId : String [0..1];
        }
        item def Organization :> Creator {
            attribute organizationKind : String;
            attribute rorId : String [0..1];
            doc /* Institutions, labs, associations and companies retain distinct identities and types. */
        }
        abstract item def Work {
            attribute workId : String;
            attribute title : String;
            attribute healthcarePurpose : String [0..1];
            attribute reviewState : ReviewState;
            attribute deliveryState : DeliveryState;
            attribute evidenceIds : String [1..*];
            attribute indexedAt : String;
            attribute verifiedAt : String [0..1];
        }
        item def Artifact :> Work;
        item def Repository :> Artifact {
            attribute githubRepositoryId : String;
            attribute currentFullName : String;
            attribute previousAliases : String [0..*];
            attribute repositoryUrl : String;
            attribute capturedCommitSha : String [0..1];
            attribute archivedUpstream : Boolean;
            attribute forkedUpstream : Boolean;
            attribute documentationUrl : String [0..1];
            doc /* GitHub numeric identity is stored without numeric rounding.
            A fork may represent substantive local work. Fork status alone does not decide eligibility. */
        }
        item def Publication :> Artifact {
            attribute doi : String [0..1];
            attribute pmid : String [0..1];
            attribute canonicalUrl : String;
            attribute publicationStage : PublicationStage;
            attribute publicationStatus : PublicationStatus;
            attribute sourcePublicationDate : String [0..1];
            attribute reportedAuthorNames : String [0..*];
            attribute reportedAffiliationTexts : String [0..*];
            doc /* A source-reported author may remain unresolved in the creator index.
            Publication affiliation does not establish current employment. */
        }
        item def Attribution {
            attribute attributionId : String;
            ref item work : Work;
            ref item creator : Creator;
            attribute role : CreatorRole;
            attribute evidenceIds : String [1..*];
            attribute validFrom : String [0..1];
            attribute validTo : String [0..1];
            attribute observedAt : String;
        }
        item def Affiliation {
            attribute assertionBasis : String;
            attribute verificationValidThrough : String [0..1];
            ref item person : Person;
            ref item organization : Organization;
            attribute roleText : String [0..1];
            attribute validFrom : String [0..1];
            attribute validTo : String [0..1];
            attribute observedAt : String;
            attribute evidenceIds : String [1..*];
        }
        item def RegionalEligibility {
            attribute attributionMode : String;
            item contributionDate : PrecisionDate;
            ref item work : Work;
            ref item creator : Creator;
            attribute geographicPolicyRevision : String;
            attribute countyKey : String;
            attribute geographicBasis : String;
            attribute creatorRoleBasis : String;
            attribute temporalBasis : String;
            attribute evidenceIds : String [1..*];
            attribute reviewState : ReviewState;
            doc /* A regional user or adopter alone does not establish local creation or publication.
            The selected region has nine DVRPC counties. Contributor-only eligibility requires review. */
        }
        item def PublicationLink {
            ref item repository : Repository;
            ref item publication : Publication;
            attribute relationKind : String;
            attribute evidenceIds : String [1..*];
            attribute linkState : LinkState;
            doc /* Many repositories can link to one paper, and one repository can link to many papers.
            A repository may have no known linked paper. Citation links do not automatically prove authorship. */
        }
        item def LicenseAssessment {
            ref item artifact : Artifact;
            attribute artifactVersion : String;
            attribute assessmentId : String;
            attribute revision : Integer;
            attribute fetchPermission : PermissionDecision;
            attribute retentionPermission : PermissionDecision;
            attribute transformPermission : PermissionDecision;
            attribute displayPermission : PermissionDecision;
            attribute reusePermission : PermissionDecision;
            attribute scope : MaterialScope;
            attribute classification : RightsClassification;
            attribute licenseSha256 : String [0..1];
            attribute sourceUrl : String [0..1];
            attribute evidenceIds : String [0..*];
            doc /* Classifications include unknown and restricted use. Public access does not imply open-source permission.
            Metadata, code, text, figures, forum content, data and model-weight permissions remain distinct.
            Permission and rights target the exact artifact version and material scope; public access grants no blanket rights. */
        }
        item def Occurrence {
            attribute occurrenceId : String;
            ref item work : Work;
            attribute occurrenceKind : String;
            attribute sourceOccurredAt : String [0..1];
            attribute firstObservedAt : String;
            attribute evidenceIds : String [1..*];
            doc /* Repository releases, meaningful changes and publication updates reference durable work records.
            Discovery of older work does not become a newly published work event. */
        }
        item def SourceCheck {
            attribute sourceId : String;
            attribute checkedAt : String;
            attribute outcome : SourceOutcome;
            attribute lastSuccessfulAt : String [0..1];
            doc /* Source failure does not prove repository deletion, abandonment or absence of regional work. */
        }
        item def ReviewDecision {
            attribute decisionId : String;
            item candidate : ReviewTarget;
            attribute targetRevision : Integer;
            attribute decisionRevision : Integer;
            attribute policyRevision : String;
            item expectedDependencies : DependencyVector;
            attribute reason : String;
            attribute supersedesDecisionId : String [0..1];
            attribute operationId : String;
            item evidenceRevisions : RevisionReference [1..*];
            attribute decision : ReviewState;
            attribute authorityKind : String;
            attribute ruleOrReviewerId : String;
            attribute evidenceIds : String [1..*];
            attribute decidedAt : String;
        }
        item def CatalogProjection {
            item immutableRow : PublicRowReference;
            item dependencies : DependencyVector;
            ref item work : Work;
            ref item projects : Project [0..*];
            ref item publications : Publication [0..*];
            ref item creators : Creator [0..*];
            item accounts : Account [0..*];
            item accountLinks : AccountIdentityLink [0..*];
            attribute deliveryState : DeliveryState;
            attribute unknownFields : String [0..*];
            doc /* The public projection uses admitted facts. Candidate evidence and proposed identity joins stay private. */
        }

        item def PublicCreatorProjection {
            item immutableRow : PublicRowReference;
            item dependencies : DependencyVector;
            ref item creator : Creator;
            attribute professionalHealthTechBasis : String;
            attribute regionalBasis : String;
            attribute countyKey : String;
            attribute temporalLabel : String;
            attribute evidenceIds : String [1..*];
            attribute reviewState : ReviewState;
            attribute verificationValidThrough : String [0..1];
            doc /* Public creator records require admitted professional health-tech and regional claims.
            Institutional membership alone does not establish a technical role. A public paper or repository is not required.
            Current and historical professional presence remain separate; no residence claim is inferred. */
        }
        item def Account {
            attribute accountId : String;
            attribute platform : String;
            attribute nativeAccountId : String;
            attribute publicProfileUrl : String;
            attribute reportedDisplayName : String [0..1];
            doc /* An account is not a verified person. Public self-description can create a discovery lead. */
        }
        item def Project :> Work {
            attribute projectPurpose : String [0..1];
            attribute activityStatus : String;
            attribute lastPublicEvidenceAt : String [0..1];
            attribute currentActivityConfirmed : Boolean [0..1];
            doc /* A continuing effort can be documented without any public repository. Current activity needs dated evidence. */
        }
        item def AccountIdentityLink {
            ref item account : Account;
            ref item creator : Creator;
            attribute evidenceIds : String [1..*];
            attribute linkState : LinkState;
            attribute observedAt : String;
            doc /* A supported cross-kind relation connects an account to a creator. It does not merge their identities. */
        }
        item def Discussion :> Artifact {
            attribute forumId : String;
            attribute topicId : String;
            attribute postId : String;
            ref item authorAccounts : Account [0..*];
            doc /* Discussion relevance and local work attribution require evidence. Forum membership alone establishes neither. */
        }
        item def WorkRelationship {
            attribute relationshipId : String;
            ref item fromWork : Work;
            ref item toWork : Work;
            attribute relationshipKind : String;
            attribute evidenceIds : String [1..*];
            attribute linkState : LinkState;
            doc /* Typed relations include describes, implements, discussion-of and version-of. Similar titles do not prove a relation. */
        }
        item def RelevanceDecision {
            ref item work : Work;
            attribute healthcareApplication : Integer;
            attribute technologyContribution : Integer;
            attribute informaticsContribution : Integer;
            attribute healthAiContribution : Integer;
            attribute taxonomyRevision : String;
            attribute evidenceIds : String [1..*];
            attribute decisionAuthority : String;
            doc /* Decision integers encode -1 unknown, 0 no and 1 yes. Keyword matches alone remain candidates.
            Admission requires healthcareApplication=yes and at least one selected contribution=yes.
            Classifier accuracy and evidence interpretation require labeled evaluation. */
        }
        item def ProviderPolicy {
            attribute sourceId : String;
            attribute providerClass : String;
            attribute accessRoute : String;
            attribute permissionDecision : String;
            attribute enrollmentRevision : String;
            attribute maxRequests : Integer;
            attribute maxBytes : Integer;
            attribute retryPolicy : String;
            attribute refreshPolicy : String;
            doc /* Bounds and access are qualified per provider. This model selects no invented provider capacity or availability. */
        }
        item def WorkQuery {
            attribute textTerms : String [0..*];
            attribute topics : String [0..*];
            attribute creatorIds : String [0..*];
            attribute organizationIds : String [0..*];
            attribute artifactKinds : String [0..*];
            attribute countyKeys : String [0..*];
            attribute regionalTemporalMode : String;
            attribute fromSourceDate : String [0..1];
            attribute untilSourceDate : String [0..1];
            attribute sortMode : String;
            doc /* Normalized OR within a facet, AND across facets. Missing facts cannot satisfy a positive filter.
            Current regional presence and attribution at work time are separate modes.
            A partial source date satisfies a date filter only when its whole supported interval is contained in the query interval. */
        }
        item def SortKey {
            attribute queryMatchCount : Integer;
            attribute dateMissing : Boolean;
            attribute sourceEventTime : Integer;
            attribute stableWorkId : String;
            doc /* Relevance mode: descending unique query-term match count, known date first, descending source-time key, then binary stable ID.
            Recent mode omits the match coordinate. A source-time key is the lower bound of a supported date interval; the display retains precision.
            Ingestion time is not a source-event date. Calendar lower bounds use a UTC-midnight ordinal solely for sorting, not an actual UTC event claim.
            Explicit-offset instants use their actual epoch coordinate; displayed precision and date-filter domains remain distinct. */
        }
        item def SearchSnapshot {
            attribute snapshotId : String;
            item query : WorkQuery;
            attribute normalizedQuery : String;
            attribute sortMode : String;
            attribute policyHead : String;
            attribute asOf : String;
            item results : PublicRowReference [0..*];
            item creatorResults : PublicRowReference [0..*];
            attribute publicationGeneration : Integer;
            attribute invalidationEpoch : Integer;
            attribute recoveryIncarnation : String;
            attribute expiresAt : String;
            item dependencies : DependencyVector;
            doc /* Immutable finite result set. Cursors bind the actual normalized query, snapshot and sort mode.
            A query digest alone does not establish equality. Results reference immutable row revisions for both work and creators.
            P20/P21 partition guarantees apply only while valid. Material invalidation or expiry returns 410 and a restart.
            Do not silently remove members or splice new rows into a continuing snapshot. */
        }
        item def CoverageReceipt {
            attribute sourceScopeId : String;
            attribute cohortId : String;
            attribute observedWindow : String;
            attribute expectedSources : Integer;
            attribute checkedSources : Integer;
            attribute failedSources : Integer;
            attribute truncated : Boolean;
            attribute capturedIds : String [0..*];
            attribute admittedIds : String [0..*];
            attribute publishedIds : String [0..*];
            doc /* Membership counts share one retained cohort. Enrolled-scope completeness needs nonempty enrollment and complete healthy checks.
            No regional population or Internet-wide denominator is asserted. */
        }
    }

    package Future {
        item def PatentRecord :> Records::Work {
            attribute documentNumber : String;
            attribute documentKind : String;
            doc /* Deferred extension only. Applications and grants retain distinct document kinds.
            No patent collection, first-release endpoint or active part is allocated by this model. */
        }
    }
    private import Records::*;

    concern <N_DISCOVER> discoverLocalWork {
        doc description /* Readers need to discover health-technology work produced in the selected Philadelphia region. */
    }
    concern <N_TRACE> traceCreatorsAndEvidence {
        doc description /* Readers need to trace work to its creators and supporting evidence. */
    }
    concern <N_FOCUS> sustainFocusedCoverage {
        doc description /* The team needs a maintainable regional scope across code, publications, preprints, forums and institutional sources. */
    }
    concern <CONCEPT_FOCUS> repositoryFirstConcept {
        doc /* Selected concept: regional health-technology people, projects and artifacts across qualified sources. Patents remain deferred. */
    }
    part def DiscoverySystem;
    part def LogicalRole;
    part def HumanRole;
    part def ExternalProvider;
    part def ArrivalPattern;
    part <A_READER> reader : HumanRole;
    part <A_OPERATOR> operator : HumanRole {
        part <R_REVIEWER> reviewRole : LogicalRole {
            doc /* Review responsibility performed by the operator. A role does not establish a separate person or staffing quantity. */
        }
    }
    part <X_GITHUB> github : ExternalProvider;
    part <X_PUBLICATIONS> publicationProviders : ExternalProvider;
    part <X_COMMUNITIES> communities : ExternalProvider;
    part <X_INSTITUTIONAL> institutionalSources : ExternalProvider;
    part <SRC_IRREGULAR> arrivalOnChange : ArrivalPattern {
        doc /* Preserved concept ID. An irregular arrival property; not a disjoint provider class. */
    }
    part <SRC_RECURRING> arrivalOnSchedule : ArrivalPattern {
        doc /* Preserved concept ID. A recurring check property; the same provider may use both arrival patterns. */
    }
    part <SYS_TVD> tvd : DiscoverySystem {
        part <C_REGISTRY> sourceRegistry : LogicalRole { item policies : ProviderPolicy [0..*]; }
        part <C_COLLECTOR> collector : LogicalRole;
        part <C_EVIDENCE> evidenceStore : LogicalRole {
            item observations : SourceObservation [0..*];
            item checks : SourceCheck [0..*];
        }
        part <IDX_ENTITY> creatorIndex : LogicalRole {
            doc description /* The creator index retains continuing identities of people and organizations. */
            item creators : Creator [0..*];
            item accounts : Account [0..*];
            item accountLinks : AccountIdentityLink [0..*];
            item affiliations : Affiliation [0..*];
        }
        part <C_CATALOG> workCatalog : LogicalRole {
            doc description /* The work catalog retains projects and artifacts from all qualified source classes. */
            item projects : Project [0..*];
            item workRelationships : WorkRelationship [0..*];
            item relevanceDecisions : RelevanceDecision [0..*];
            item discussions : Discussion [0..*];
            item repositories : Repository [0..*];
            item publications : Publication [0..*];
            item attributions : Attribution [0..*];
            item publicationLinks : PublicationLink [0..*];
            item eligibility : RegionalEligibility [0..*];
            item licenseAssessments : LicenseAssessment [0..*];
        }
        part <REC_OCCURRENCE> occurrenceStore : LogicalRole {
            item occurrences : Occurrence [0..*];
        }
        part <C_REVIEW> reviewQueue : LogicalRole {
            item decisions : ReviewDecision [0..*];
        }
        part <C_DELIVERY> publicDelivery : LogicalRole {
            item records : CatalogProjection [0..*];
            item creatorRecords : PublicCreatorProjection [0..*];
        }
        part <VIEW_PORTAL> portal : LogicalRole {
            doc description /* The portal presents work, people, organizations and supported relationships. */
        }
        part <C_LEGACY> legacyAccess : LogicalRole;
        part <C_SEARCH> searchIndex : LogicalRole { item querySnapshots : SearchSnapshot [0..*]; }
        part <C_COVERAGE> coverageRegister : LogicalRole { item receipts : CoverageReceipt [0..*]; }
    }

    action def <F_INTERPRET> collectAndInterpret {
        doc /* Preserved aggregate function ID. The selected child functions capture, qualify, resolve and link evidence.
        Decomposition relations are documentary; no native execution schedule is asserted. */
    }
    action def <F_DISCOVER> discoverRegionalWork {
        doc description /* Discover regional work from registered code, publication, preprint, forum and institutional sources. */
        out item observations : SourceObservation [0..*];
    }
    action def <F_CAPTURE> captureEvidence {
        in item observations : SourceObservation [0..*];
        out item retained : SourceObservation [0..*];
    }
    action def <F_QUALIFY> qualifyWork {
        in item evidence : SourceObservation [1..*];
        out item eligibility : RegionalEligibility;
        doc /* Evaluate health-technology purpose, creator-role evidence and the selected nine-county geographic policy.
        Unresolved regional or healthcare eligibility holds a new candidate. */
    }
    action def <F_RESOLVE> resolveCreators {
        in item evidence : SourceObservation [1..*];
        out item attributions : Attribution [0..*];
        doc /* Keep ambiguous people unresolved. An unresolved optional person join need not hide an independently qualified organization-backed repository. */
    }
    action def <F_LINK> linkPublications {
        in item evidence : SourceObservation [1..*];
        out item links : PublicationLink [0..*];
        doc /* Inspect repository citations and publication code links. Admit exact source-backed relationships.
        Similar titles, author names or topics do not alone confirm a link. */
    }
    action def <F_REVIEW> reviewCandidates {
        in item candidate : ReviewTarget;
        out item decision : ReviewDecision;
        doc /* Retain existing human or qualified deterministic source-rule authority. Model output cannot authorize publication. */
    }
    action def <F_PUBLISH> publishCatalog {
        in item decision : ReviewDecision;
        out item projection : CatalogProjection [0..1];
        out item creatorProjection : PublicCreatorProjection [0..1];
        out item publicRevision : PublicRevision [0..1];
        doc /* Only authenticated accepted decisions and valid complete dependencies can produce an accepted projection.
        Creator targets can publish independently of any work. Claim and relationship decisions do not automatically publish endpoints.
        A SQL guard must abort the entire publication batch on any stale dependency, authority, fence or expiry. */
    }
    action def <F_BROWSE> browseConnectedWork {
        in item records : CatalogProjection [0..*];
            item creatorRecords : PublicCreatorProjection [0..*];
        doc /* Reader walk: repository to linked publication to creator and other verified work.
        Present source links, unknown fields, reuse terms and meaningful update dates. */
    }
    action def <F_REFRESH> refreshRecords {
        out item checks : SourceCheck [0..*];
        doc /* Recheck repository identity, releases, license and attribution evidence. Retain prior versions and typed failures.
        Show stale or unknown status instead of inventing a recent release. */
    }
    action def <F_ARCHIVE> preserveLegacyAccess {
        doc /* Preserve existing article and technology permalinks and machine-feed contracts during the transition.
        Review mappings and consumers before redirects, job retirement or contract replacement. */
    }

    action def <S_FIRST> firstWorkDiscovery {
        doc /* Proposed normal walk: discover, capture, qualify, resolve, review, publish, browse.
        No repository or project grouping is required for a qualifying paper, preprint or discussion. Personal creators do not require invented employment. */
    }
    action def <S_PAPER> linkedPaperDiscovery {
        doc /* Capture the exact paper identifier and relationship evidence. Link, review and publish the relationship.
        Retain reported authors when no stable person match is established. */
    }
    action def <S_AMBIGUOUS> ambiguousCreatorOrRegion {
        doc /* Capture and qualify evidence. Resolve only supported identities. Hold disputed identity or eligibility facts for review.
        Do not expose a proposed creator merge or unsupported regional claim. */
    }
    action def <S_REFRESH> upstreamRefreshFailure {
        doc /* A rate limit, failed fetch, transfer or archive state reaches refresh and review.
        Preserve identity and prior evidence. Rebuild a projection only under an admitted decision. */
    }
    action def <S_LEGACY> legacyReaderAccess {
        doc /* An existing article, technology URL or feed consumer reaches compatible legacy delivery while the new portal launches. */
    }

    requirement <R_SCOPE> RegionalHealthcareScope {
        doc /* Proposed design obligation: publish only work with source-backed healthcare purpose and regional creator eligibility.
        Code, papers, preprints, relevant discussions and institutional projects qualify independently. Patent functionality remains deferred. */
    }
    requirement <R_IDENTITY> StableWorkIdentity {
        doc /* Proposed design obligation: keep numeric repository identity stable across URL or owner changes.
        Keep creator identity, work identity and occurrences distinct. */
    }
    requirement <R_EVIDENCE> TraceableFacts {
        doc /* Proposed design obligation: retain source, version, observation time and supporting evidence for admitted facts and links. */
    }
    requirement <R_LINK> SupportedPublicationLinks {
        doc /* Proposed design obligation: retain publication identifiers and evidence-backed many-to-many repository links.
        Optional paper absence does not block an otherwise eligible repository. */
    }
    requirement <R_RIGHTS> ExplicitReuseTerms {
        doc /* Proposed design obligation: display artifact-specific reuse terms or an explicit unknown assessment. */
    }
    requirement <R_STATE> HonestRefreshState {
        doc /* Proposed design obligation: separate publication, discovery, observation and verification dates.
        A collection failure does not erase accepted evidence or imply current freshness. Current projection claims are checked against evidence and policy heads at read time. */
    }
    requirement <R_AUTHORITY> PublicationAuthority {
        doc /* Retained project obligation: model output cannot authorize publication. Unsupported claims remain in review. */
    }
    requirement <R_COMPAT> CompatibleTransition {
        doc /* Proposed design obligation: preserve existing URLs and feed consumers until a separately reviewed migration replaces them. */
    }


    action def <F_FIND_PEOPLE> discoverRegionalCreators {
        doc /* Search institutional and association sources, public identity registries and reverse artifact affiliations.
        Create candidates, verify professional regional relationships, and retain source-specific accounts separately. */
    }
    action def <F_RELEVANCE> assessHealthTechRelevance {
        doc /* Assess healthcare application and technology, informatics or health-AI contribution with cited evidence.
        Routine clinical content, generic AI and local affiliation alone do not establish relevance. */
    }
    action def <F_GROUP> connectProjects {
        doc /* Connect accepted artifacts to continuing projects only through supported relations. Standalone work remains discoverable. */
    }
    action def <F_SEARCH> findWork {
        doc /* Filter admitted people, projects and artifacts against a normalized query and immutable snapshot. */
    }
    action def <F_SORT> sortResults {
        doc /* Apply the declared strict lexicographic key and query-bound continuation. Rank is not proof of clinical or scientific quality. */
    }
    action def <F_DISPLAY> presentWork {
        doc /* Display supported purpose, creator roles, regional basis, source dates, evidence, stage/status, reuse terms and unknown fields.
        Readers can enter through a person, organization, project, paper, preprint, code artifact or discussion. */
    }
    action def <F_COVERAGE> measureSourceCoverage {
        doc /* Track enrolled source scopes, source failures, candidate cohorts and known gaps. Use fair bounded dispatch under explicit assumptions. */
    }
    action def holdCandidate {
        doc /* Retain an unresolved candidate without creating a new public claim. This is a selected internal branch of review. */
    }
    action def <S_INDEPENDENT> independentPublicationDiscovery {
        doc /* An independent paper or arXiv preprint creates a work candidate. Check creator identity, dated regional attribution and health-tech relevance.
        Review and display the work even when code and project grouping are absent. */
    }
    action def <S_FORUM> regionalDiscussionDiscovery {
        doc /* A qualified public forum yields a relevant work discussion. Retain its account identity and exact topic/post references.
        Verify local work attribution independently. Unknown identity or regional evidence remains in review. */
    }
    requirement <R_MULTI_SOURCE> IndependentDiscoverySources {
        doc /* Publications, preprints, discussions and institutional projects do not require a GitHub artifact for admission. */
    }
    requirement <R_QUERY> DeterministicQueryDelivery {
        doc /* Selected filters, sort directions, tie identity and snapshot-bound cursors determine repeatable public results. */
    }
    requirement <R_COVERAGE> ScopedCoverageClaims {
        doc /* Report actual enrolled scope and typed failures. Do not equate incomplete discovery with absence of local work. */
    }
    requirement <R_PROJECTS> SupportedProjectGrouping {
        doc /* Keep projects and artifacts distinct. Admit cross-source grouping and creator relationships only with supporting evidence. */
    }
    package VerificationSlice {
        part def AbstractState {
            in attribute eligible : Boolean;
            in attribute authority : Boolean;
            in attribute evidenceCurrent : Boolean;
            attribute retained : Boolean;
            out attribute accepted : Boolean;
            out attribute projected : Boolean;
            attribute captureData : Boolean;
            attribute qualificationData : Boolean;
            attribute decisionData : Boolean;
            attribute projectionData : Boolean;
            attribute heldData : Boolean;
            attribute displayData : Boolean;
        }
        part abstractState : AbstractState;
        doc /* Explicit Boolean abstraction for the finite workflow correspondence. This is not a deployed component or implicit native execution. */
    }

    // DERIVED_METADATA
    concern modelContext {
        doc cseWorkflow /*CSE-WORKFLOW/1.0
{
  "version": "workflow-1.0",
  "question": {
    "text": "Can regional people and health-tech work be discovered, qualified, connected, found, sorted and understood across independent sources?",
    "basis": "DIRECTION"
  },
  "sources": {
    "DIRECTION": {
      "sha256": "d37b58f7d2bc70baeed077b86923613ee78eeb54b51f41155fc40c60ed1f7039",
      "excerpt": "GitHub, publications, arXiv, forums and other qualified sources are independent discovery routes.",
      "kind": "provided"
    },
    "DESIGN": {
      "sha256": "7ad2c26d59d0bf458480e16b425e35ca14cac53a0fa89639c3c8d52f111d7de0",
      "excerpt": "Health relevance requires a documented healthcare application and a technological, informatics or health-AI contribution.",
      "kind": "proposal"
    },
    "POLICY_V1": {
      "sha256": "25319e1e02733267dd5102b7c795f533088cede5be09eb7e9f79a036ae90df23",
      "excerpt": "An independent creator can qualify through reviewed public professional evidence without an employer, repository or indexed work.",
      "kind": "provided"
    }
  },
  "elements": {
    "N_DISCOVER": {
      "kind": "need",
      "native_name": "TVD_Concept::discoverLocalWork",
      "label": "Discover regional health-tech work",
      "description": "Identify regional creators and their useful health-technology work across sources.",
      "basis": "DIRECTION",
      "status": "accepted"
    },
    "N_TRACE": {
      "kind": "need",
      "native_name": "TVD_Concept::traceCreatorsAndEvidence",
      "label": "Trace creators and evidence",
      "description": "Connect continuing creator identities with their work and supporting evidence.",
      "basis": "DIRECTION",
      "status": "accepted"
    },
    "N_FOCUS": {
      "kind": "need",
      "native_name": "TVD_Concept::sustainFocusedCoverage",
      "label": "Sustain focused coverage",
      "description": "Keep the selected regional health-tech domain across multiple source classes.",
      "basis": "DIRECTION",
      "status": "accepted"
    },
    "CONCEPT_FOCUS": {
      "kind": "concept",
      "native_name": "TVD_Concept::repositoryFirstConcept",
      "label": "Multi-source health-tech discovery",
      "description": "People, organizations, projects and artifacts in the selected DVRPC region.",
      "basis": "DIRECTION",
      "status": "accepted"
    },
    "SYS_TVD": {
      "kind": "system",
      "native_name": "TVD_Concept::tvd",
      "label": "The Valley Desk",
      "description": "Logical boundary for collection, review, connected work discovery and compatible public delivery.",
      "basis": "DESIGN",
      "status": "proposed"
    },
    "A_READER": {
      "kind": "actor",
      "native_name": "TVD_Concept::reader",
      "label": "Reader",
      "description": "Proposed primary audience: healthcare builders, researchers and potential collaborators.",
      "basis": "DESIGN",
      "status": "proposed"
    },
    "A_OPERATOR": {
      "kind": "actor",
      "native_name": "TVD_Concept::operator",
      "label": "Operator",
      "description": "Existing trusted operator role; no new external-party assignment or authorization is asserted.",
      "basis": "DESIGN",
      "status": "proposed"
    },
    "R_REVIEWER": {
      "kind": "element",
      "native_name": "TVD_Concept::operator::reviewRole",
      "label": "Operator review role",
      "description": "Proposed review responsibility performed by the same operator; no separate staffing quantity is asserted.",
      "basis": "DESIGN",
      "status": "proposed"
    },
    "X_GITHUB": {
      "kind": "system",
      "native_name": "TVD_Concept::github",
      "label": "GitHub",
      "description": "External public repository metadata, source files and release provider.",
      "basis": "DESIGN",
      "status": "proposed"
    },
    "X_PUBLICATIONS": {
      "kind": "system",
      "native_name": "TVD_Concept::publicationProviders",
      "label": "Publication providers",
      "description": "Publication and preprint metadata sources, including PubMed, Crossref and arXiv when enrolled.",
      "basis": "DESIGN",
      "status": "proposed"
    },
    "SRC_IRREGULAR": {
      "kind": "element",
      "native_name": "TVD_Concept::arrivalOnChange",
      "label": "Irregular arrival",
      "description": "Preserved prior concept ID; an arrival pattern, not a mutually exclusive provider class.",
      "basis": "DESIGN",
      "status": "proposed"
    },
    "SRC_RECURRING": {
      "kind": "element",
      "native_name": "TVD_Concept::arrivalOnSchedule",
      "label": "Scheduled arrival",
      "description": "Preserved prior concept ID; the same source may also support scheduled rechecks.",
      "basis": "DESIGN",
      "status": "proposed"
    },
    "C_REGISTRY": {
      "kind": "element",
      "native_name": "TVD_Concept::tvd::sourceRegistry",
      "label": "Source registry",
      "description": "Registered projects, creators, geographic policy and provider permissions.",
      "basis": "DESIGN",
      "status": "proposed"
    },
    "C_COLLECTOR": {
      "kind": "element",
      "native_name": "TVD_Concept::tvd::collector",
      "label": "Collector",
      "description": "Bounded external reads, typed outcomes and retry state.",
      "basis": "DESIGN",
      "status": "proposed"
    },
    "C_EVIDENCE": {
      "kind": "element",
      "native_name": "TVD_Concept::tvd::evidenceStore",
      "label": "Evidence store",
      "description": "Versioned observations, source checks and representation references.",
      "basis": "DESIGN",
      "status": "proposed"
    },
    "IDX_ENTITY": {
      "kind": "element",
      "native_name": "TVD_Concept::tvd::creatorIndex",
      "label": "Creator index",
      "description": "Continuing identities for people, institutions, associations and other organizations.",
      "basis": "DESIGN",
      "status": "proposed"
    },
    "C_CATALOG": {
      "kind": "element",
      "native_name": "TVD_Concept::tvd::workCatalog",
      "label": "Work catalog",
      "description": "Continuing projects, independent artifacts, creator roles and evidence-backed cross-source relationships.",
      "basis": "DESIGN",
      "status": "proposed"
    },
    "REC_OCCURRENCE": {
      "kind": "element",
      "native_name": "TVD_Concept::tvd::occurrenceStore",
      "label": "Update occurrences",
      "description": "Meaningful releases and publication changes reference durable work records.",
      "basis": "DESIGN",
      "status": "proposed"
    },
    "C_REVIEW": {
      "kind": "element",
      "native_name": "TVD_Concept::tvd::reviewQueue",
      "label": "Review queue",
      "description": "Candidate evidence, identity ambiguities, publication decisions and holds.",
      "basis": "DESIGN",
      "status": "proposed"
    },
    "C_DELIVERY": {
      "kind": "element",
      "native_name": "TVD_Concept::tvd::publicDelivery",
      "label": "Public delivery",
      "description": "Accepted read models, compatible APIs and crawler-visible pages.",
      "basis": "DESIGN",
      "status": "proposed"
    },
    "VIEW_PORTAL": {
      "kind": "element",
      "native_name": "TVD_Concept::tvd::portal",
      "label": "Regional work portal",
      "description": "Find people and work across code, papers, preprints and relevant discussions.",
      "basis": "DESIGN",
      "status": "proposed"
    },
    "C_LEGACY": {
      "kind": "element",
      "native_name": "TVD_Concept::tvd::legacyAccess",
      "label": "Legacy access",
      "description": "Existing article and technology URLs and machine-feed compatibility.",
      "basis": "DESIGN",
      "status": "proposed"
    },
    "F_INTERPRET": {
      "kind": "function",
      "native_name": "TVD_Concept::collectAndInterpret",
      "label": "Collect and interpret",
      "description": "Aggregate of capture, qualification, identity resolution and linking.",
      "basis": "DESIGN",
      "status": "proposed"
    },
    "F_DISCOVER": {
      "kind": "function",
      "native_name": "TVD_Concept::discoverRegionalWork",
      "label": "Discover regional work",
      "description": "Discover code, papers, preprints, discussions and institutional projects independently.",
      "basis": "DESIGN",
      "status": "proposed"
    },
    "F_CAPTURE": {
      "kind": "function",
      "native_name": "TVD_Concept::captureEvidence",
      "label": "Capture evidence",
      "description": "Retain exact source identities, versions and observation time.",
      "basis": "DESIGN",
      "status": "proposed"
    },
    "F_QUALIFY": {
      "kind": "function",
      "native_name": "TVD_Concept::qualifyWork",
      "label": "Qualify healthcare and region",
      "description": "Check healthcare purpose and regional creator eligibility.",
      "basis": "DESIGN",
      "status": "proposed"
    },
    "F_RESOLVE": {
      "kind": "function",
      "native_name": "TVD_Concept::resolveCreators",
      "label": "Resolve creators",
      "description": "Join only supported creator identities, roles and dated affiliations.",
      "basis": "DESIGN",
      "status": "proposed"
    },
    "F_LINK": {
      "kind": "function",
      "native_name": "TVD_Concept::linkPublications",
      "label": "Link publications",
      "description": "Retain exact publication identities and evidence-backed repository relationships.",
      "basis": "DESIGN",
      "status": "proposed"
    },
    "F_REVIEW": {
      "kind": "function",
      "native_name": "TVD_Concept::reviewCandidates",
      "label": "Review candidates",
      "description": "Apply qualified rules or operator review; model text has no publication authority.",
      "basis": "DESIGN",
      "status": "proposed"
    },
    "F_PUBLISH": {
      "kind": "function",
      "native_name": "TVD_Concept::publishCatalog",
      "label": "Publish catalog",
      "description": "Project only admitted facts and relationships into public records.",
      "basis": "DESIGN",
      "status": "proposed"
    },
    "F_BROWSE": {
      "kind": "function",
      "native_name": "TVD_Concept::browseConnectedWork",
      "label": "Browse connected work",
      "description": "Navigate repository, paper, creator and other verified work.",
      "basis": "DESIGN",
      "status": "proposed"
    },
    "F_REFRESH": {
      "kind": "function",
      "native_name": "TVD_Concept::refreshRecords",
      "label": "Refresh records",
      "description": "Observe meaningful updates, stable identities and source failures.",
      "basis": "DESIGN",
      "status": "proposed"
    },
    "F_ARCHIVE": {
      "kind": "function",
      "native_name": "TVD_Concept::preserveLegacyAccess",
      "label": "Preserve legacy access",
      "description": "Keep existing URLs and feed consumers working through migration.",
      "basis": "DESIGN",
      "status": "proposed"
    },
    "S_FIRST": {
      "kind": "scenario",
      "native_name": "TVD_Concept::firstWorkDiscovery",
      "label": "First work discovery",
      "description": "Authored operational walk; not an executed behavior trace.",
      "basis": "DESIGN",
      "status": "proposed"
    },
    "S_PAPER": {
      "kind": "scenario",
      "native_name": "TVD_Concept::linkedPaperDiscovery",
      "label": "Linked paper discovery",
      "description": "Authored operational walk; not an executed behavior trace.",
      "basis": "DESIGN",
      "status": "proposed"
    },
    "S_AMBIGUOUS": {
      "kind": "scenario",
      "native_name": "TVD_Concept::ambiguousCreatorOrRegion",
      "label": "Ambiguous creator or region",
      "description": "Authored operational walk; not an executed behavior trace.",
      "basis": "DESIGN",
      "status": "proposed"
    },
    "S_REFRESH": {
      "kind": "scenario",
      "native_name": "TVD_Concept::upstreamRefreshFailure",
      "label": "Upstream refresh failure",
      "description": "Authored operational walk; not an executed behavior trace.",
      "basis": "DESIGN",
      "status": "proposed"
    },
    "S_LEGACY": {
      "kind": "scenario",
      "native_name": "TVD_Concept::legacyReaderAccess",
      "label": "Legacy reader access",
      "description": "Authored operational walk; not an executed behavior trace.",
      "basis": "DESIGN",
      "status": "proposed"
    },
    "R_SCOPE": {
      "kind": "requirement",
      "native_name": "TVD_Concept::RegionalHealthcareScope",
      "label": "Regional healthcare scope",
      "description": "Qualitative design obligation. No executable predicate or operational acceptance is asserted.",
      "basis": "DESIGN",
      "status": "proposed"
    },
    "R_IDENTITY": {
      "kind": "requirement",
      "native_name": "TVD_Concept::StableWorkIdentity",
      "label": "Stable work identity",
      "description": "Qualitative design obligation. No executable predicate or operational acceptance is asserted.",
      "basis": "DESIGN",
      "status": "proposed"
    },
    "R_EVIDENCE": {
      "kind": "requirement",
      "native_name": "TVD_Concept::TraceableFacts",
      "label": "Traceable facts",
      "description": "Qualitative design obligation. No executable predicate or operational acceptance is asserted.",
      "basis": "DESIGN",
      "status": "proposed"
    },
    "R_LINK": {
      "kind": "requirement",
      "native_name": "TVD_Concept::SupportedPublicationLinks",
      "label": "Supported publication links",
      "description": "Qualitative design obligation. No executable predicate or operational acceptance is asserted.",
      "basis": "DESIGN",
      "status": "proposed"
    },
    "R_RIGHTS": {
      "kind": "requirement",
      "native_name": "TVD_Concept::ExplicitReuseTerms",
      "label": "Explicit reuse terms",
      "description": "Qualitative design obligation. No executable predicate or operational acceptance is asserted.",
      "basis": "DESIGN",
      "status": "proposed"
    },
    "R_STATE": {
      "kind": "requirement",
      "native_name": "TVD_Concept::HonestRefreshState",
      "label": "Honest refresh state",
      "description": "Qualitative design obligation. No executable predicate or operational acceptance is asserted.",
      "basis": "DESIGN",
      "status": "proposed"
    },
    "R_AUTHORITY": {
      "kind": "requirement",
      "native_name": "TVD_Concept::PublicationAuthority",
      "label": "Publication authority",
      "description": "Qualitative design obligation. No executable predicate or operational acceptance is asserted.",
      "basis": "DESIGN",
      "status": "proposed"
    },
    "R_COMPAT": {
      "kind": "requirement",
      "native_name": "TVD_Concept::CompatibleTransition",
      "label": "Compatible transition",
      "description": "Qualitative design obligation. No executable predicate or operational acceptance is asserted.",
      "basis": "DESIGN",
      "status": "proposed"
    },
    "X_COMMUNITIES": {
      "kind": "system",
      "native_name": "TVD_Concept::communities",
      "label": "Community sources",
      "description": "Qualified public forums and technical discussions.",
      "basis": "DESIGN",
      "status": "proposed"
    },
    "X_INSTITUTIONAL": {
      "kind": "system",
      "native_name": "TVD_Concept::institutionalSources",
      "label": "Institutional sources",
      "description": "Public institutional, lab and association project and identity sources.",
      "basis": "DESIGN",
      "status": "proposed"
    },
    "C_SEARCH": {
      "kind": "element",
      "native_name": "TVD_Concept::tvd::searchIndex",
      "label": "Search index",
      "description": "Admitted query snapshots, deterministic sorting and cursor binding.",
      "basis": "DESIGN",
      "status": "proposed"
    },
    "C_COVERAGE": {
      "kind": "element",
      "native_name": "TVD_Concept::tvd::coverageRegister",
      "label": "Coverage register",
      "description": "Enrolled source scopes, outcomes, cohorts and known gaps.",
      "basis": "DESIGN",
      "status": "proposed"
    },
    "F_FIND_PEOPLE": {
      "kind": "function",
      "native_name": "TVD_Concept::discoverRegionalCreators",
      "label": "Discover regional creators",
      "description": "Seed from institutional sources and expand from artifact affiliations and public identity anchors.",
      "basis": "DESIGN",
      "status": "proposed"
    },
    "F_RELEVANCE": {
      "kind": "function",
      "native_name": "TVD_Concept::assessHealthTechRelevance",
      "label": "Assess health-tech relevance",
      "description": "Require a documented healthcare application and a selected technical contribution.",
      "basis": "DESIGN",
      "status": "proposed"
    },
    "F_GROUP": {
      "kind": "function",
      "native_name": "TVD_Concept::connectProjects",
      "label": "Connect projects",
      "description": "Retain continuing projects and evidence-backed artifact relationships.",
      "basis": "DESIGN",
      "status": "proposed"
    },
    "F_SEARCH": {
      "kind": "function",
      "native_name": "TVD_Concept::findWork",
      "label": "Find work",
      "description": "Filter admitted work and identities against an explicit query.",
      "basis": "DESIGN",
      "status": "proposed"
    },
    "F_SORT": {
      "kind": "function",
      "native_name": "TVD_Concept::sortResults",
      "label": "Sort results",
      "description": "Apply declared query/date/identity ordering and stable continuation.",
      "basis": "DESIGN",
      "status": "proposed"
    },
    "F_DISPLAY": {
      "kind": "function",
      "native_name": "TVD_Concept::presentWork",
      "label": "Present work",
      "description": "Explain purpose, creators, evidence, status, dates and reuse terms.",
      "basis": "DESIGN",
      "status": "proposed"
    },
    "F_COVERAGE": {
      "kind": "function",
      "native_name": "TVD_Concept::measureSourceCoverage",
      "label": "Measure source coverage",
      "description": "Expose source scope and gaps without a global completeness claim.",
      "basis": "DESIGN",
      "status": "proposed"
    },
    "S_INDEPENDENT": {
      "kind": "scenario",
      "native_name": "TVD_Concept::independentPublicationDiscovery",
      "label": "Independent publication discovery",
      "description": "A paper or preprint can qualify without code or a project group.",
      "basis": "DESIGN",
      "status": "proposed"
    },
    "S_FORUM": {
      "kind": "scenario",
      "native_name": "TVD_Concept::regionalDiscussionDiscovery",
      "label": "Regional discussion discovery",
      "description": "A forum account is retained separately from verified creator identity.",
      "basis": "DESIGN",
      "status": "proposed"
    },
    "R_MULTI_SOURCE": {
      "kind": "requirement",
      "native_name": "TVD_Concept::IndependentDiscoverySources",
      "label": "Independent discovery sources",
      "description": "No repository prerequisite for other selected source classes.",
      "basis": "DESIGN",
      "status": "proposed"
    },
    "R_QUERY": {
      "kind": "requirement",
      "native_name": "TVD_Concept::DeterministicQueryDelivery",
      "label": "Deterministic query delivery",
      "description": "Explicit filtering, ranking and snapshot continuation.",
      "basis": "DESIGN",
      "status": "proposed"
    },
    "R_COVERAGE": {
      "kind": "requirement",
      "native_name": "TVD_Concept::ScopedCoverageClaims",
      "label": "Scoped coverage claims",
      "description": "Bound coverage claims to enrolled sources and retained cohorts.",
      "basis": "DESIGN",
      "status": "proposed"
    },
    "R_PROJECTS": {
      "kind": "requirement",
      "native_name": "TVD_Concept::SupportedProjectGrouping",
      "label": "Supported project grouping",
      "description": "Keep continuing efforts, artifacts and supported relations distinct.",
      "basis": "DESIGN",
      "status": "proposed"
    }
  },
  "relations": {
    "T_SCOPE": {
      "kind": "addresses",
      "from": "F_QUALIFY",
      "to": "N_DISCOVER",
      "label": "regional healthcare eligibility",
      "basis": "DESIGN"
    },
    "T_TRACE": {
      "kind": "addresses",
      "from": "F_LINK",
      "to": "N_TRACE",
      "label": "supported work relationships",
      "basis": "DESIGN"
    },
    "T_FOCUS": {
      "kind": "addresses",
      "from": "F_DISCOVER",
      "to": "N_FOCUS",
      "label": "repository priority",
      "basis": "DESIGN"
    },
    "T_CAPTURE": {
      "kind": "allocated_to",
      "from": "F_CAPTURE",
      "to": "C_EVIDENCE",
      "label": "retention support",
      "basis": "DESIGN"
    },
    "T_REVIEW": {
      "kind": "allocated_to",
      "from": "F_REVIEW",
      "to": "C_REVIEW",
      "label": "candidate and decision persistence",
      "basis": "DESIGN"
    },
    "T_SUPPORT": {
      "kind": "participates_in",
      "from": "A_OPERATOR",
      "to": "S_AMBIGUOUS",
      "label": "operator handles ambiguous attribution review",
      "basis": "DESIGN"
    },
    "T_REVIEW_ROLE": {
      "kind": "allocated_to",
      "from": "F_REVIEW",
      "to": "R_REVIEWER",
      "label": "proposed operator review responsibility",
      "basis": "DESIGN"
    },
    "T_DISCOVER": {
      "kind": "allocated_to",
      "from": "F_DISCOVER",
      "to": "C_REGISTRY",
      "label": "enrolled source scope",
      "basis": "DESIGN"
    },
    "T_COLLECT": {
      "kind": "allocated_to",
      "from": "F_CAPTURE",
      "to": "C_COLLECTOR",
      "label": "bounded source reads",
      "basis": "DESIGN"
    },
    "T_IDENT": {
      "kind": "allocated_to",
      "from": "F_RESOLVE",
      "to": "IDX_ENTITY",
      "label": "continuing identity records",
      "basis": "DESIGN"
    },
    "T_LINK": {
      "kind": "allocated_to",
      "from": "F_LINK",
      "to": "C_CATALOG",
      "label": "relationship records",
      "basis": "DESIGN"
    },
    "T_PUBLISH": {
      "kind": "allocated_to",
      "from": "F_PUBLISH",
      "to": "C_DELIVERY",
      "label": "accepted projections",
      "basis": "DESIGN"
    },
    "T_BROWSE": {
      "kind": "allocated_to",
      "from": "F_BROWSE",
      "to": "VIEW_PORTAL",
      "label": "reader experience",
      "basis": "DESIGN"
    },
    "T_REFRESH": {
      "kind": "allocated_to",
      "from": "F_REFRESH",
      "to": "REC_OCCURRENCE",
      "label": "update history",
      "basis": "DESIGN"
    },
    "T_LEGACY": {
      "kind": "allocated_to",
      "from": "F_ARCHIVE",
      "to": "C_LEGACY",
      "label": "compatible delivery",
      "basis": "DESIGN"
    },
    "D_F_CAPTURE": {
      "kind": "decomposes",
      "from": "F_INTERPRET",
      "to": "F_CAPTURE",
      "label": "selected function decomposition",
      "basis": "DESIGN"
    },
    "D_F_QUALIFY": {
      "kind": "decomposes",
      "from": "F_INTERPRET",
      "to": "F_QUALIFY",
      "label": "selected function decomposition",
      "basis": "DESIGN"
    },
    "D_F_RESOLVE": {
      "kind": "decomposes",
      "from": "F_INTERPRET",
      "to": "F_RESOLVE",
      "label": "selected function decomposition",
      "basis": "DESIGN"
    },
    "D_F_LINK": {
      "kind": "decomposes",
      "from": "F_INTERPRET",
      "to": "F_LINK",
      "label": "selected function decomposition",
      "basis": "DESIGN"
    },
    "O_S_FIRST": {
      "kind": "scenario_of",
      "from": "S_FIRST",
      "to": "CONCEPT_FOCUS",
      "label": "selected concept situation",
      "basis": "DESIGN"
    },
    "O_S_PAPER": {
      "kind": "scenario_of",
      "from": "S_PAPER",
      "to": "CONCEPT_FOCUS",
      "label": "selected concept situation",
      "basis": "DESIGN"
    },
    "O_S_AMBIGUOUS": {
      "kind": "scenario_of",
      "from": "S_AMBIGUOUS",
      "to": "CONCEPT_FOCUS",
      "label": "selected concept situation",
      "basis": "DESIGN"
    },
    "O_S_REFRESH": {
      "kind": "scenario_of",
      "from": "S_REFRESH",
      "to": "CONCEPT_FOCUS",
      "label": "selected concept situation",
      "basis": "DESIGN"
    },
    "O_S_LEGACY": {
      "kind": "scenario_of",
      "from": "S_LEGACY",
      "to": "CONCEPT_FOCUS",
      "label": "selected concept situation",
      "basis": "DESIGN"
    },
    "N_R_SCOPE": {
      "kind": "derives_from",
      "from": "R_SCOPE",
      "to": "N_DISCOVER",
      "label": "proposed obligation rationale",
      "basis": "DESIGN"
    },
    "N_R_IDENTITY": {
      "kind": "derives_from",
      "from": "R_IDENTITY",
      "to": "N_TRACE",
      "label": "proposed obligation rationale",
      "basis": "DESIGN"
    },
    "N_R_EVIDENCE": {
      "kind": "derives_from",
      "from": "R_EVIDENCE",
      "to": "N_TRACE",
      "label": "proposed obligation rationale",
      "basis": "DESIGN"
    },
    "N_R_LINK": {
      "kind": "derives_from",
      "from": "R_LINK",
      "to": "N_TRACE",
      "label": "proposed obligation rationale",
      "basis": "DESIGN"
    },
    "N_R_RIGHTS": {
      "kind": "derives_from",
      "from": "R_RIGHTS",
      "to": "N_TRACE",
      "label": "proposed obligation rationale",
      "basis": "DESIGN"
    },
    "N_R_STATE": {
      "kind": "derives_from",
      "from": "R_STATE",
      "to": "N_TRACE",
      "label": "proposed obligation rationale",
      "basis": "DESIGN"
    },
    "N_R_AUTHORITY": {
      "kind": "derives_from",
      "from": "R_AUTHORITY",
      "to": "N_TRACE",
      "label": "proposed obligation rationale",
      "basis": "DESIGN"
    },
    "N_R_COMPAT": {
      "kind": "derives_from",
      "from": "R_COMPAT",
      "to": "N_FOCUS",
      "label": "proposed obligation rationale",
      "basis": "DESIGN"
    },
    "T_PEOPLE": {
      "kind": "allocated_to",
      "from": "F_FIND_PEOPLE",
      "to": "IDX_ENTITY",
      "label": "regional creator discovery",
      "basis": "DESIGN"
    },
    "T_RELEVANCE": {
      "kind": "allocated_to",
      "from": "F_RELEVANCE",
      "to": "C_REVIEW",
      "label": "evidence-backed relevance review",
      "basis": "DESIGN"
    },
    "T_GROUP": {
      "kind": "allocated_to",
      "from": "F_GROUP",
      "to": "C_CATALOG",
      "label": "project and artifact relationships",
      "basis": "DESIGN"
    },
    "T_SEARCH": {
      "kind": "allocated_to",
      "from": "F_SEARCH",
      "to": "C_SEARCH",
      "label": "normalized snapshot queries",
      "basis": "DESIGN"
    },
    "T_SORT": {
      "kind": "allocated_to",
      "from": "F_SORT",
      "to": "C_SEARCH",
      "label": "strict ordering and continuation",
      "basis": "DESIGN"
    },
    "T_DISPLAY": {
      "kind": "allocated_to",
      "from": "F_DISPLAY",
      "to": "VIEW_PORTAL",
      "label": "supported user-facing claims",
      "basis": "DESIGN"
    },
    "T_COVERAGE": {
      "kind": "allocated_to",
      "from": "F_COVERAGE",
      "to": "C_COVERAGE",
      "label": "scoped source coverage",
      "basis": "DESIGN"
    },
    "T_WHO": {
      "kind": "addresses",
      "from": "F_FIND_PEOPLE",
      "to": "N_DISCOVER",
      "label": "who is in the region",
      "basis": "DESIGN"
    },
    "T_WHAT": {
      "kind": "addresses",
      "from": "F_GROUP",
      "to": "N_DISCOVER",
      "label": "what creators work on",
      "basis": "DESIGN"
    },
    "T_WHY": {
      "kind": "addresses",
      "from": "F_RELEVANCE",
      "to": "N_TRACE",
      "label": "why work is relevant",
      "basis": "DESIGN"
    },
    "T_FIND": {
      "kind": "addresses",
      "from": "F_SEARCH",
      "to": "N_DISCOVER",
      "label": "find useful work",
      "basis": "DESIGN"
    },
    "T_PRESENT": {
      "kind": "addresses",
      "from": "F_DISPLAY",
      "to": "N_TRACE",
      "label": "understand the supported claims",
      "basis": "DESIGN"
    },
    "D_RELEVANCE": {
      "kind": "decomposes",
      "from": "F_INTERPRET",
      "to": "F_RELEVANCE",
      "label": "relevance assessment",
      "basis": "DESIGN"
    },
    "D_GROUP": {
      "kind": "decomposes",
      "from": "F_INTERPRET",
      "to": "F_GROUP",
      "label": "supported project relationships",
      "basis": "DESIGN"
    },
    "O_S_INDEPENDENT": {
      "kind": "scenario_of",
      "from": "S_INDEPENDENT",
      "to": "CONCEPT_FOCUS",
      "label": "independent publication entry",
      "basis": "DESIGN"
    },
    "O_S_FORUM": {
      "kind": "scenario_of",
      "from": "S_FORUM",
      "to": "CONCEPT_FOCUS",
      "label": "discussion entry",
      "basis": "DESIGN"
    },
    "N_R_MULTI_SOURCE": {
      "kind": "derives_from",
      "from": "R_MULTI_SOURCE",
      "to": "N_DISCOVER",
      "label": "expanded user direction",
      "basis": "DESIGN"
    },
    "N_R_QUERY": {
      "kind": "derives_from",
      "from": "R_QUERY",
      "to": "N_DISCOVER",
      "label": "expanded user direction",
      "basis": "DESIGN"
    },
    "N_R_COVERAGE": {
      "kind": "derives_from",
      "from": "R_COVERAGE",
      "to": "N_FOCUS",
      "label": "expanded user direction",
      "basis": "DESIGN"
    },
    "N_R_PROJECTS": {
      "kind": "derives_from",
      "from": "R_PROJECTS",
      "to": "N_TRACE",
      "label": "expanded user direction",
      "basis": "DESIGN"
    }
  },
  "workflows": {
    "concept": {
      "focus": [
        "N_DISCOVER",
        "N_TRACE",
        "N_FOCUS",
        "SYS_TVD",
        "F_FIND_PEOPLE",
        "F_RELEVANCE",
        "F_SEARCH",
        "F_DISPLAY"
      ],
      "summary": "Nine-county health-tech discovery across creators, projects, code, publications, preprints and discussions.",
      "conditions": "Target design with explicit formal contracts. Source truth, provider access, recall, relevance and usefulness require empirical evidence.",
      "outcome": "Revised model, checked mathematical contracts, complete goal trace and an evidence-gated implementation plan.",
      "next_decision": "Implement a vertical slice across multiple source classes and evaluate the independent evidence gates before public release."
    }
  },
  "decisions": {
    "D_SCOPE": {
      "text": "Focus on health technology, health informatics and health AI in the user-selected nine-county DVRPC region.",
      "status": "accepted",
      "by": "User",
      "basis": "DIRECTION",
      "affects": [
        "SYS_TVD",
        "N_DISCOVER"
      ]
    },
    "D_ORDER": {
      "text": "GitHub remains important; papers, preprints, projects and relevant discussions qualify independently. Patents remain deferred.",
      "status": "accepted",
      "by": "User",
      "basis": "DIRECTION",
      "affects": [
        "F_DISCOVER",
        "F_LINK",
        "VIEW_PORTAL"
      ]
    },
    "D_IDENTITIES": {
      "text": "Retain continuing people and organization identities separately from work and occurrences.",
      "status": "accepted",
      "by": "User",
      "basis": "DIRECTION",
      "affects": [
        "IDX_ENTITY",
        "C_CATALOG",
        "REC_OCCURRENCE"
      ]
    },
    "D_RELEASE": {
      "text": "Use a small cross-source collection with independent publication and discussion entry paths and creator profiles.",
      "status": "proposed",
      "by": "Engineering recommendation",
      "basis": "DESIGN",
      "affects": [
        "VIEW_PORTAL",
        "C_CATALOG",
        "IDX_ENTITY"
      ]
    },
    "D_REUSE": {
      "text": "Reuse the existing Worker, D1, GitHub adapters, evidence and review mechanisms where their contracts fit.",
      "status": "proposed",
      "by": "Engineering recommendation",
      "basis": "DESIGN",
      "affects": [
        "C_COLLECTOR",
        "C_EVIDENCE",
        "C_REVIEW",
        "C_DELIVERY"
      ]
    },
    "D_COMPAT": {
      "text": "Keep legacy URLs and feed consumers compatible; assess job retirement separately.",
      "status": "proposed",
      "by": "Engineering recommendation",
      "basis": "DESIGN",
      "affects": [
        "C_LEGACY",
        "F_ARCHIVE"
      ]
    },
    "D_GEO": {
      "text": "Use the nine-county DVRPC region in Pennsylvania and New Jersey.",
      "status": "accepted",
      "by": "User",
      "basis": "DIRECTION",
      "affects": [
        "F_QUALIFY",
        "C_REGISTRY"
      ]
    },
    "D_V05_REVIEW": {
      "text": "Proposed refinement: creator/work/claim/relationship targets replace the Work-only review field, while preserving authenticated authority and independent optional identity joins. Reconsider only with a reviewed alternative preserving these paths.",
      "status": "proposed",
      "by": "WP02 owner; independent review pending",
      "basis": "POLICY_V1",
      "affects": [
        "F_REVIEW",
        "F_PUBLISH",
        "IDX_ENTITY"
      ]
    },
    "D_V05_SNAPSHOT": {
      "text": "Proposed refinement: immutable row revisions, full expected dependency vectors, monotonic heads, explicit 410 restart and external recovery incarnation preserve current visibility. Partition applies only while valid; no silent member deletion.",
      "status": "proposed",
      "by": "WP02 owner; independent review pending",
      "basis": "DESIGN",
      "affects": [
        "F_PUBLISH",
        "F_SEARCH",
        "C_DELIVERY",
        "C_SEARCH"
      ]
    }
  },
  "questions": {
    "Q_CONTRIBUTOR": {
      "text": "Which contributor-only regional claims can qualify after evidence review, without confusing adoption with creation?",
      "affects": [
        "F_QUALIFY",
        "F_RESOLVE"
      ],
      "blocking": false
    },
    "Q_FRESHNESS": {
      "text": "Which source-specific refresh and verification windows can the operating budget support?",
      "affects": [
        "F_REFRESH",
        "C_COLLECTOR"
      ],
      "blocking": false
    },
    "Q_RANKING": {
      "text": "Which reader evidence supports the proposed deterministic relevance and meaningful-date sort modes?",
      "affects": [
        "F_BROWSE",
        "VIEW_PORTAL"
      ],
      "blocking": false
    },
    "Q_PERSON": {
      "text": "Which public evidence can qualify an independent local creator without institutional affiliation?",
      "affects": [
        "F_RESOLVE",
        "F_QUALIFY"
      ],
      "blocking": false
    }
  },
  "trade_studies": {},
  "evidence": {
    "E_DISCOVERY": {
      "target": "F_DISCOVER",
      "purpose": "verification",
      "mode": "plan",
      "method": "Evaluate institutional seed discovery and reverse artifact discovery across GitHub, publications, arXiv and qualified forums, including independent papers without code.",
      "environment": "Future isolated implementation qualification and independently labeled cross-source reader evaluation.",
      "basis": "DESIGN",
      "result": "not_run",
      "limitations": "No target implementation, supplied observations or reader acceptance results exist in this increment."
    },
    "E_ATTRIBUTION": {
      "target": "F_RESOLVE",
      "purpose": "verification",
      "mode": "plan",
      "method": "Check sourced roles and dated affiliations. Use ambiguous names, personal accounts, labs and association examples as counterexamples.",
      "environment": "Future isolated implementation qualification and independently labeled cross-source reader evaluation.",
      "basis": "DESIGN",
      "result": "not_run",
      "limitations": "No target implementation, supplied observations or reader acceptance results exist in this increment."
    },
    "E_LINKS": {
      "target": "F_LINK",
      "purpose": "verification",
      "mode": "plan",
      "method": "Check repository citation and publication code links, optional paper absence, shared papers and contradictory or retracted publication metadata.",
      "environment": "Future isolated implementation qualification and independently labeled cross-source reader evaluation.",
      "basis": "DESIGN",
      "result": "not_run",
      "limitations": "No target implementation, supplied observations or reader acceptance results exist in this increment."
    },
    "E_REFRESH": {
      "target": "F_REFRESH",
      "purpose": "verification",
      "mode": "plan",
      "method": "Replay rate limits, missing records, archives, renames and changed licenses. Confirm typed state, retained evidence and meaningful dates.",
      "environment": "Future isolated implementation qualification and independently labeled cross-source reader evaluation.",
      "basis": "DESIGN",
      "result": "not_run",
      "limitations": "No target implementation, supplied observations or reader acceptance results exist in this increment."
    },
    "E_COMPAT": {
      "target": "F_ARCHIVE",
      "purpose": "verification",
      "mode": "plan",
      "method": "Compare legacy permalinks, technology mappings, feed envelopes and crawler metadata before and after the proposed transition.",
      "environment": "Future isolated implementation qualification and independently labeled cross-source reader evaluation.",
      "basis": "DESIGN",
      "result": "not_run",
      "limitations": "No target implementation, supplied observations or reader acceptance results exist in this increment."
    },
    "E_UX": {
      "target": "F_BROWSE",
      "purpose": "validation",
      "mode": "plan",
      "method": "Ask intended readers to find a person, understand a project, establish its regional and health-tech basis, and follow supported cross-source work.",
      "environment": "Future isolated implementation qualification and independently labeled cross-source reader evaluation.",
      "basis": "DESIGN",
      "result": "not_run",
      "limitations": "No target implementation, supplied observations or reader acceptance results exist in this increment."
    },
    "E_V05_TYPES": {
      "target": "F_REVIEW",
      "purpose": "verification",
      "mode": "plan",
      "method": "Compare typed native review/rights/row records with the strict TypeScript contracts and retained role mappings.",
      "environment": "Isolated local contract tests now; concrete D1/API/restore evidence in WP16/WP17/WP23/WP26.",
      "basis": "DESIGN",
      "result": "not_run",
      "limitations": "Schema/model acceptance cannot authenticate authority, establish source truth or qualify runtime atomicity."
    },
    "E_V05_ATOMIC": {
      "target": "F_PUBLISH",
      "purpose": "verification",
      "mode": "plan",
      "method": "Exercise every material dependency change, ABA, expired lease, permission/rule replacement and final-statement abort against real D1 transactions.",
      "environment": "Isolated local contract tests now; concrete D1/API/restore evidence in WP16/WP17/WP23/WP26.",
      "basis": "DESIGN",
      "result": "not_run",
      "limitations": "Schema/model acceptance cannot authenticate authority, establish source truth or qualify runtime atomicity."
    },
    "E_V05_RESTART": {
      "target": "F_SEARCH",
      "purpose": "verification",
      "mode": "plan",
      "method": "Exercise primary coherent reads, invalidation and expiry between pages; reject all pre-restore cursors with an externally rotated incarnation.",
      "environment": "Isolated local contract tests now; concrete D1/API/restore evidence in WP16/WP17/WP23/WP26.",
      "basis": "DESIGN",
      "result": "not_run",
      "limitations": "Schema/model acceptance cannot authenticate authority, establish source truth or qualify runtime atomicity."
    }
  }
}
        */
        doc tvdProduct /*TVD-PRODUCT/1.0
{
  "version": "TVD-PRODUCT/1.0",
  "revision": "TVD-CONCEPT-0.4",
  "authoritative_model": "tvd-discovery.sysml",
  "baseline_sha256": "03a445a88c17fccf446b86ccd0f480062850b82f99a8de62185404fe4c36942a",
  "direction_sha256": "d37b58f7d2bc70baeed077b86923613ee78eeb54b51f41155fc40c60ed1f7039",
  "geography_sha256": "c1308298ff89b0e8f511704fcd8e3a73287e6bb6ac8fffedd9d743cdc275aa0f",
  "proof_scope_sha256": "679e824c2f26273caac2474648a2b2aee3d234d3af2ce4d715033bdeb54ebb2b",
  "preserved_ids": [
    "SRC_IRREGULAR",
    "SRC_RECURRING",
    "F_INTERPRET",
    "REC_OCCURRENCE",
    "IDX_ENTITY",
    "VIEW_PORTAL"
  ],
  "goal_axes": {
    "WHO": {
      "functions": [
        "F_FIND_PEOPLE",
        "F_RESOLVE",
        "F_QUALIFY"
      ],
      "records": [
        "Person",
        "Organization",
        "Account",
        "Affiliation",
        "Attribution",
        "RegionalEligibility"
      ],
      "proofs": [
        "P02",
        "P03",
        "P07",
        "P08",
        "P31"
      ],
      "empirical": [
        "E01",
        "E03"
      ]
    },
    "WHAT": {
      "functions": [
        "F_DISCOVER",
        "F_CAPTURE",
        "F_GROUP",
        "F_LINK",
        "F_REFRESH"
      ],
      "records": [
        "Project",
        "Artifact",
        "Repository",
        "Publication",
        "Discussion",
        "WorkRelationship",
        "Occurrence"
      ],
      "proofs": [
        "P05",
        "P06",
        "P09",
        "P10",
        "P12",
        "P27",
        "P32"
      ],
      "empirical": [
        "E03",
        "E04"
      ]
    },
    "RELEVANCE": {
      "functions": [
        "F_RELEVANCE",
        "F_REVIEW",
        "F_PUBLISH"
      ],
      "records": [
        "RelevanceDecision",
        "ReviewDecision",
        "SourceObservation"
      ],
      "proofs": [
        "P01",
        "P04",
        "P11",
        "P28"
      ],
      "empirical": [
        "E02"
      ]
    },
    "FIND": {
      "functions": [
        "F_SEARCH",
        "F_COVERAGE"
      ],
      "records": [
        "WorkQuery",
        "SearchSnapshot",
        "CoverageReceipt"
      ],
      "proofs": [
        "P15",
        "P16",
        "P20",
        "P21",
        "P22",
        "P23",
        "P24",
        "P25",
        "P26"
      ],
      "empirical": [
        "E03",
        "E05"
      ]
    },
    "SORT": {
      "functions": [
        "F_SORT"
      ],
      "records": [
        "SortKey",
        "SearchSnapshot"
      ],
      "proofs": [
        "P17",
        "P18",
        "P19",
        "P21"
      ],
      "empirical": [
        "E05"
      ]
    },
    "DISPLAY": {
      "functions": [
        "F_DISPLAY",
        "F_BROWSE",
        "F_ARCHIVE"
      ],
      "records": [
        "CatalogProjection",
        "LicenseAssessment",
        "Publication",
        "SourceObservation"
      ],
      "proofs": [
        "P13",
        "P14",
        "P29",
        "P30"
      ],
      "empirical": [
        "E05",
        "E06"
      ]
    }
  },
  "navigation": [
    "Explore work",
    "People",
    "Organizations"
  ],
  "explore_facets": [
    "Topics",
    "Artifact kind",
    "Creator",
    "Organization",
    "County",
    "Source-event date",
    "Reuse terms"
  ],
  "domain": {
    "include": [
      "Health technology",
      "Health informatics",
      "Health AI",
      "Healthcare interoperability and clinical workflow tools",
      "Medical devices and sensing",
      "Health-linked computational biomedical methods"
    ],
    "exclude_without_technical_contribution": [
      "Routine clinical reports",
      "General health news",
      "Generic AI with no healthcare application",
      "Institutional marketing",
      "Local software unrelated to healthcare"
    ]
  },
  "views": {
    "discovery": {
      "nodes": [
        "X_GITHUB",
        "X_PUBLICATIONS",
        "X_COMMUNITIES",
        "X_INSTITUTIONAL",
        "F_FIND_PEOPLE",
        "F_INTERPRET",
        "C_REVIEW",
        "C_CATALOG",
        "IDX_ENTITY",
        "C_SEARCH",
        "VIEW_PORTAL",
        "C_COVERAGE"
      ],
      "edges": [
        [
          "X_GITHUB",
          "F_INTERPRET",
          "code"
        ],
        [
          "X_PUBLICATIONS",
          "F_INTERPRET",
          "papers + preprints"
        ],
        [
          "X_COMMUNITIES",
          "F_INTERPRET",
          "discussions"
        ],
        [
          "X_INSTITUTIONAL",
          "F_FIND_PEOPLE",
          "public identity + work"
        ],
        [
          "F_FIND_PEOPLE",
          "IDX_ENTITY",
          "qualified identities"
        ],
        [
          "F_FIND_PEOPLE",
          "F_INTERPRET",
          "discovery leads"
        ],
        [
          "F_INTERPRET",
          "F_FIND_PEOPLE",
          "author + account leads"
        ],
        [
          "F_INTERPRET",
          "C_REVIEW",
          "candidate + evidence"
        ],
        [
          "C_REVIEW",
          "C_CATALOG",
          "admitted work"
        ],
        [
          "C_REVIEW",
          "IDX_ENTITY",
          "admitted relations"
        ],
        [
          "C_CATALOG",
          "C_SEARCH",
          "admitted snapshot"
        ],
        [
          "IDX_ENTITY",
          "C_SEARCH",
          "creator context"
        ],
        [
          "C_SEARCH",
          "VIEW_PORTAL",
          "find + sort + display"
        ],
        [
          "C_COVERAGE",
          "VIEW_PORTAL",
          "scope + gaps"
        ]
      ]
    },
    "goal": {
      "kind": "Goal-to-function, proof and evidence matrix derived from goal_axes."
    },
    "assurance": {
      "kind": "Formal guarantees and empirical evidence gates; no whole-system proof claim."
    }
  }
}
        */
        doc tvdFormal /*TVD-FORMAL/1.0
{
  "version": "TVD-FORMAL/1.0",
  "revision": "TVD-CONCEPT-0.4",
  "proof_scope_sha256": "679e824c2f26273caac2474648a2b2aee3d234d3af2ce4d715033bdeb54ebb2b",
  "meaning": "Explicit authored mathematical contracts and abstract protocols; not implicit execution of arbitrary native SysML.",
  "decision_values": {
    "unknown": -1,
    "no": 0,
    "yes": 1
  },
  "authority_values": {
    "model_or_unqualified": 0,
    "qualified_rule": 1,
    "human_review": 2
  },
  "source_classes": {
    "github": 0,
    "publication": 1,
    "preprint": 2,
    "forum": 3,
    "institutional": 4,
    "other_enrolled": 5
  },
  "eligible_creator_roles": [
    "author",
    "creator",
    "maintainer",
    "publisher"
  ],
  "reviewed_contributor_role": "contributor",
  "temporal": {
    "interval": "[start,end)",
    "current_requires": [
      "supported current basis",
      "query time before verification expiry",
      "supported interval containing query time"
    ],
    "historical_does_not_imply_current": true,
    "project_activity": "A recent publication is a public signal; ongoing activity requires a supported current claim."
  },
  "county_keys": [
    "PA:Bucks",
    "PA:Chester",
    "PA:Delaware",
    "PA:Montgomery",
    "PA:Philadelphia",
    "NJ:Burlington",
    "NJ:Camden",
    "NJ:Gloucester",
    "NJ:Mercer"
  ],
  "rules": {
    "healthTech": {
      "and": [
        {
          "eq": [
            {
              "ref": "health"
            },
            {
              "const": 1
            }
          ]
        },
        {
          "or": [
            {
              "eq": [
                {
                  "ref": "technology"
                },
                {
                  "const": 1
                }
              ]
            },
            {
              "eq": [
                {
                  "ref": "informatics"
                },
                {
                  "const": 1
                }
              ]
            },
            {
              "eq": [
                {
                  "ref": "healthAi"
                },
                {
                  "const": 1
                }
              ]
            }
          ]
        }
      ]
    },
    "admit": {
      "and": [
        {
          "call": "healthTech"
        },
        {
          "eq": [
            {
              "ref": "regional"
            },
            {
              "const": 1
            }
          ]
        },
        {
          "eq": [
            {
              "ref": "creatorRole"
            },
            {
              "const": 1
            }
          ]
        },
        {
          "ref": "roleEligible"
        },
        {
          "ref": "countyInPolicy"
        },
        {
          "ref": "sourcePermitted"
        },
        {
          "ref": "evidenceValid"
        },
        {
          "ref": "evidenceHeadMatch"
        },
        {
          "ref": "policyHeadMatch"
        },
        {
          "or": [
            {
              "eq": [
                {
                  "ref": "authority"
                },
                {
                  "const": 1
                }
              ]
            },
            {
              "eq": [
                {
                  "ref": "authority"
                },
                {
                  "const": 2
                }
              ]
            }
          ]
        },
        {
          "ref": "sourceClassAllowed"
        }
      ]
    },
    "admitCreator": {
      "and": [
        {
          "ref": "identityAdmitted"
        },
        {
          "eq": [
            {
              "ref": "professionalHealthTech"
            },
            {
              "const": 1
            }
          ]
        },
        {
          "eq": [
            {
              "ref": "regional"
            },
            {
              "const": 1
            }
          ]
        },
        {
          "ref": "professionalRoleVerified"
        },
        {
          "ref": "currentProfileCompatible"
        },
        {
          "ref": "countyInPolicy"
        },
        {
          "ref": "sourcePermitted"
        },
        {
          "ref": "evidenceValid"
        },
        {
          "ref": "evidenceHeadMatch"
        },
        {
          "ref": "policyHeadMatch"
        },
        {
          "or": [
            {
              "eq": [
                {
                  "ref": "authority"
                },
                {
                  "const": 1
                }
              ]
            },
            {
              "eq": [
                {
                  "ref": "authority"
                },
                {
                  "const": 2
                }
              ]
            }
          ]
        },
        {
          "ref": "sourceClassAllowed"
        }
      ]
    },
    "merge": {
      "and": [
        {
          "ref": "sameEntityKind"
        },
        {
          "ref": "equivalenceAdmitted"
        },
        {
          "ref": "conflictFree"
        }
      ]
    },
    "link": {
      "and": [
        {
          "ref": "leftAdmitted"
        },
        {
          "ref": "rightAdmitted"
        },
        {
          "ref": "relationAdmitted"
        },
        {
          "ref": "relationEvidenceCurrent"
        }
      ]
    },
    "projectMember": {
      "and": [
        {
          "ref": "workAdmitted"
        },
        {
          "ref": "projectAdmitted"
        },
        {
          "ref": "groupingEvidenceAdmitted"
        }
      ]
    },
    "reuseClaim": {
      "and": [
        {
          "ref": "licenseReviewed"
        },
        {
          "ref": "unrestrictedPermission"
        },
        {
          "ref": "licenseVersionMatches"
        }
      ]
    },
    "cursorValid": {
      "and": [
        {
          "ref": "sameSnapshot"
        },
        {
          "ref": "sameNormalizedQuery"
        },
        {
          "ref": "sameSortMode"
        },
        {
          "ref": "snapshotUnexpired"
        }
      ]
    },
    "coverageComplete": {
      "and": [
        {
          "ref": "expectedNonempty"
        },
        {
          "ref": "allExpectedChecked"
        },
        {
          "ref": "noFailedChecks"
        },
        {
          "ref": "notTruncated"
        }
      ]
    }
  },
  "ordering": {
    "relevance": [
      "descending query-match count",
      "known date before unknown",
      "descending source-event time",
      "ascending binary stable work ID"
    ],
    "recent": [
      "known date before unknown",
      "descending source-event time",
      "ascending binary stable work ID"
    ],
    "excluded_date": "indexedAt"
  },
  "protocols": {
    "counter": "Accept an increment only when nonnegative and used+increment<=budget. Guard and mutation are atomic.",
    "identity": "Use typed provider/native-identifier tuples and guarded admitted aliases. Do not concatenate ambiguous identifiers.",
    "round_robin": "Maintain 0<=cursor<n for a fixed cohort n>0. Advance to cursor+1 when cursor+1<n, otherwise zero. Every attempt advances, including failure.",
    "pagination": "For an immutable finite unique-key snapshot, return the first L>0 keys strictly beyond the cursor. Bind actual normalized query and sort mode.",
    "projection": "Compare expected evidence and policy heads at commit. Derive current visibility using the retained heads and freshness policy at read time.",
    "lifecycle": "Retain evidence; qualify and review candidates; project only admitted decisions. Invalidation removes current status while retaining historical evidence."
  },
  "lifecycle": {
    "controlled": [
      "retained",
      "accepted",
      "projected",
      "commitWitness"
    ],
    "inputs": [
      "eligible",
      "authority",
      "evidenceHead",
      "policyHead",
      "dateValid",
      "providerAvailable"
    ],
    "initial_controlled": {
      "retained": false,
      "accepted": false,
      "projected": false,
      "commitWitness": false
    },
    "current_predicate": {
      "and": [
        {
          "ref": "retained"
        },
        {
          "ref": "accepted"
        },
        {
          "ref": "projected"
        },
        {
          "ref": "commitWitness"
        },
        {
          "ref": "eligible"
        },
        {
          "ref": "authority"
        },
        {
          "ref": "evidenceHead"
        },
        {
          "ref": "policyHead"
        },
        {
          "ref": "dateValid"
        }
      ]
    },
    "actions": [
      {
        "name": "capture",
        "guard": {
          "ref": "providerAvailable"
        },
        "effects": {
          "retained": true
        }
      },
      {
        "name": "review",
        "guard": {
          "and": [
            {
              "ref": "retained"
            },
            {
              "ref": "eligible"
            },
            {
              "ref": "authority"
            },
            {
              "ref": "evidenceHead"
            },
            {
              "ref": "policyHead"
            },
            {
              "ref": "dateValid"
            }
          ]
        },
        "effects": {
          "accepted": true
        }
      },
      {
        "name": "publish",
        "guard": {
          "and": [
            {
              "ref": "retained"
            },
            {
              "ref": "accepted"
            },
            {
              "ref": "eligible"
            },
            {
              "ref": "authority"
            },
            {
              "ref": "evidenceHead"
            },
            {
              "ref": "policyHead"
            },
            {
              "ref": "dateValid"
            }
          ]
        },
        "effects": {
          "projected": true,
          "commitWitness": true
        }
      },
      {
        "name": "hold",
        "guard": {
          "ref": "retained"
        },
        "effects": {
          "accepted": false
        }
      }
    ],
    "external_changes": "Each declared input may change independently. Current display is derived after the change; historical evidence is retained."
  },
  "bindings": {
    "P01": {
      "model_id": "F_RELEVANCE",
      "native_name": "TVD_Concept::assessHealthTechRelevance"
    },
    "P02": {
      "model_id": "F_QUALIFY",
      "native_name": "TVD_Concept::qualifyWork"
    },
    "P03": {
      "model_id": "F_RESOLVE",
      "native_name": "TVD_Concept::resolveCreators"
    },
    "P04": {
      "model_id": "F_REVIEW",
      "native_name": "TVD_Concept::reviewCandidates"
    },
    "P05": {
      "model_id": "F_DISCOVER",
      "native_name": "TVD_Concept::discoverRegionalWork"
    },
    "P06": {
      "model_id": "F_PUBLISH",
      "native_name": "TVD_Concept::publishCatalog"
    },
    "P07": {
      "model_id": "F_RESOLVE",
      "native_name": "TVD_Concept::resolveCreators"
    },
    "P08": {
      "model_id": "F_RESOLVE",
      "native_name": "TVD_Concept::resolveCreators"
    },
    "P09": {
      "model_id": "F_CAPTURE",
      "native_name": "TVD_Concept::captureEvidence"
    },
    "P10": {
      "model_id": "F_REFRESH",
      "native_name": "TVD_Concept::refreshRecords"
    },
    "P11": {
      "model_id": "F_PUBLISH",
      "native_name": "TVD_Concept::publishCatalog"
    },
    "P12": {
      "model_id": "F_LINK",
      "native_name": "TVD_Concept::linkPublications"
    },
    "P13": {
      "model_id": "F_DISPLAY",
      "native_name": "TVD_Concept::presentWork"
    },
    "P14": {
      "model_id": "F_DISPLAY",
      "native_name": "TVD_Concept::presentWork"
    },
    "P15": {
      "model_id": "F_SEARCH",
      "native_name": "TVD_Concept::findWork"
    },
    "P16": {
      "model_id": "F_SEARCH",
      "native_name": "TVD_Concept::findWork"
    },
    "P17": {
      "model_id": "F_SORT",
      "native_name": "TVD_Concept::sortResults"
    },
    "P18": {
      "model_id": "F_SORT",
      "native_name": "TVD_Concept::sortResults"
    },
    "P19": {
      "model_id": "F_SORT",
      "native_name": "TVD_Concept::sortResults"
    },
    "P20": {
      "model_id": "F_SEARCH",
      "native_name": "TVD_Concept::findWork"
    },
    "P21": {
      "model_id": "F_SEARCH",
      "native_name": "TVD_Concept::findWork"
    },
    "P22": {
      "model_id": "F_DISCOVER",
      "native_name": "TVD_Concept::discoverRegionalWork"
    },
    "P23": {
      "model_id": "F_CAPTURE",
      "native_name": "TVD_Concept::captureEvidence"
    },
    "P24": {
      "model_id": "F_COVERAGE",
      "native_name": "TVD_Concept::measureSourceCoverage"
    },
    "P25": {
      "model_id": "F_COVERAGE",
      "native_name": "TVD_Concept::measureSourceCoverage"
    },
    "P26": {
      "model_id": "F_COVERAGE",
      "native_name": "TVD_Concept::measureSourceCoverage"
    },
    "P27": {
      "model_id": "F_GROUP",
      "native_name": "TVD_Concept::connectProjects"
    },
    "P28": {
      "model_id": "F_PUBLISH",
      "native_name": "TVD_Concept::publishCatalog"
    },
    "P29": {
      "model_id": "F_REFRESH",
      "native_name": "TVD_Concept::refreshRecords"
    },
    "P30": {
      "model_id": "F_INTERPRET",
      "native_name": "TVD_Concept::collectAndInterpret"
    },
    "P31": {
      "model_id": "F_QUALIFY",
      "native_name": "TVD_Concept::qualifyWork"
    },
    "P32": {
      "model_id": "F_CAPTURE",
      "native_name": "TVD_Concept::captureEvidence"
    }
  },
  "nonproof_claims": [
    "E01",
    "E02",
    "E03",
    "E04",
    "E05",
    "E06"
  ]
}
        */
    }
    doc tvdRefinements /*TVD-REFINEMENT/1.0
{
  "version": "TVD-REFINEMENT/1.0",
  "revision": "TVD-CONCEPT-0.5",
  "retained_formal_scope_sha256": "679e824c2f26273caac2474648a2b2aee3d234d3af2ce4d715033bdeb54ebb2b",
  "refinement_scope_sha256": "871bdb916d71f759711b7071a16eed6b81538ffb021f886f4ee786cdb4143dc5",
  "commit_conditions": [
    "authority",
    "requiredComplete",
    "headsMatch",
    "unexpired",
    "fenceValid",
    "budgetValid",
    "targetMatches",
    "operationCompatible"
  ],
  "request_match_conditions": [
    "wellFormed",
    "snapshotMatches",
    "queryMatches",
    "positionMatches",
    "notBeforeAsOf"
  ],
  "validity_conditions": [
    "epochMatches",
    "incarnationMatches",
    "unexpired"
  ],
  "dependency_kinds": [
    "evidence-observation",
    "claim",
    "decision",
    "relationship",
    "endpoint",
    "identity-resolution",
    "rights-assessment",
    "source-enrollment",
    "source-configuration",
    "source-qualification",
    "source-permission",
    "verification-rule",
    "geographic-policy",
    "relevance-policy",
    "review-policy",
    "public-field-policy",
    "projection-generation",
    "currentness"
  ],
  "commit_only_kinds": [
    "projection-generation"
  ],
  "review_targets": [
    "creator",
    "work",
    "claim",
    "relationship"
  ],
  "creator_requires_artifact": false,
  "rights_key": [
    "artifactId",
    "artifactVersion",
    "material"
  ],
  "permission_dimensions": [
    "fetch",
    "retain",
    "transform",
    "display",
    "reuse"
  ],
  "source_purposes": {
    "qualification-sample": "reviewed bounded sampling authorization plus permission/configuration; no routine activation",
    "collection": "current qualified installation and permission/configuration"
  },
  "provider_routes": [
    "github",
    "pubmed",
    "crossref",
    "arxiv",
    "forum",
    "institutional"
  ],
  "creator_profile_route": "institutional",
  "snapshot_outcomes": {
    "mismatched": 400,
    "invalidated": 410,
    "expired": 410,
    "valid": 200
  },
  "snapshot_partition_condition": "valid continuation only",
  "generation_is_validity_condition": false,
  "current_person_rule": [
    "professionalEvidence",
    "currentVerified",
    "currentCountyInScope",
    "healthTechBasis"
  ],
  "regional_work_rule": [
    "creatorRoleEvidence",
    "creationCountyInScope",
    "contributionTimeSupported",
    "healthTechBasis"
  ],
  "date_domains": {
    "unknown": "no positive date-filter match",
    "year": "calendar interval; no timezone asserted",
    "month": "calendar interval; no timezone asserted",
    "day": "calendar interval; no timezone asserted",
    "instant": "explicit offset required; actual epoch milliseconds"
  },
  "require_offset_for_instant": true,
  "assumptions": [
    "Input flags represent independently established facts and authenticated authority; this modeled check does not supply either.",
    "Expected dependency keys are derived by the trusted builder from all material fields; schema presence does not establish completeness.",
    "SQL batch atomicity, primary coherent read, durable operations and external incarnation persistence require later implementation qualification."
  ],
  "provider_identity_tuple": [
    "provider",
    "installation",
    "kind",
    "nativeId"
  ],
  "heads_match_definition": "all-required-revision-slots-equal",
  "head_vector_bound": 512,
  "head_slot_alignment": "One slot per required key in the complete trusted manifest; expected and actual arrays use the same key-to-slot map.",
  "reuse_definition": "exact-artifact-version-material-key-and-explicit-reuse-permission"
}
    */
}
