# Clean competition course and deterministic reset plan

This is a plan, not an authorization to delete the current dataset. Implementation
starts after the source recording and its rights are confirmed.

## 1. Lock the source and teaching story

Choose one instructor-owned recording or a recording with a licence that clearly
allows this use. Record the following in a versioned manifest:

- title, instructor/owner, licence, attribution, and source checksum;
- four to six plain-language concepts;
- one genuine `requires` relationship;
- one common misconception;
- one primary explanation and one meaningfully different alternate explanation;
- one assessment that can reveal the misconception;
- one remediation clip and route;
- the intended dashboard signal and private revision.

The source decision is the only blocker that should not be guessed. A five- to
fifteen-minute focused recording is preferable to a long keynote because judges
must understand the pedagogy immediately.

## 2. Create a versioned fixture contract

Add `competition/fixtures/course.json` with a fixture version and stable logical
identities. The fixture should describe outcomes, not copy database rows:

```text
source
  → 4–6 concepts
  → reviewed clips
  → reviewed assessments
  → misconception remediation rule
  → published revision
  → labelled demonstration learners/events
  → one dashboard signal
  → one signal-linked private proposal
```

Use deterministic UUIDv5 identifiers derived from a fixed namespace and semantic
keys such as `concept:deliberate-practice`. Stable identities make screenshots,
automated assertions, and repeat runs comparable.

## 3. Build a narrow reset command

Add:

```bash
npm run demo:check
npm run demo:reset
```

The implementation should be `scripts/reset_competition_demo.py` with these
properties:

- `--check` is read-only and the default;
- `--apply` is required for mutation;
- an advisory lock prevents concurrent resets;
- it targets only records carrying an exact
  `brief.competition_fixture_id`, never a title match, wildcard, home directory,
  database-wide truncate, or unresolved environment variable;
- one transaction deletes the prior fixture course and recreates it;
- failure rolls back the complete reset;
- the source checksum and fixture schema are validated before mutation;
- the command prints the exact course, revision, instructor, and learner IDs;
- a post-reset verifier runs before the transaction is considered successful;
- the reset is idempotent: two runs produce the same logical graph and evidence;
- external model calls are not required during reset.

The reset should load a reviewed snapshot generated from the real product
workflow, not fake a second code path for how artifacts are shaped. AI generation
can be demonstrated separately with the measured disposable evaluator.

## 4. Curate the reviewed course

Run the chosen source once through normal generation. Review the result as an
instructor and edit it into a compact story:

- 4–6 concepts, with no duplicate or decorative nodes;
- exactly enough topic structure to orient the viewer;
- at least one visible prerequisite edge;
- one normal teaching clip;
- one alternate-explanation or misconception-correction clip;
- one primary assessment per showcased concept;
- one wrong-answer pattern mapped to the corrective clip;
- zero uncovered concepts;
- no pending review items in the published revision.

Export this accepted/edited revision into the fixture manifest with source
citations and instructor decisions intact.

## 5. Seed one labelled learner-evidence story

Create three clearly labelled demonstration learners because current signal
thresholds require a small repeated pattern rather than one anecdote.

Seed events through the same domain services used by the learner app:

1. all three answer the misconception assessment incorrectly with high confidence;
2. each attempt updates mastery and emits a persisted remediation route;
3. the route targets the alternate explanation;
4. at least one learner later answers correctly so the demo can show recovery;
5. dashboard aggregation creates one underperforming-content or stuck-cohort
   signal for that exact concept/question;
6. a specialist task receives the signal ID in its evidence snapshot;
7. it prepares one private, independently reviewable proposal touching the same
   chain.

Every seeded identity and event must include `is_simulated` or equivalent
demonstration labelling. The UI and narration must never call this a real cohort.

## 6. Make the eight-stage trace complete

The verifier must assert one exact chain has all stages:

```text
source citation or timestamp
→ reviewed concept
→ reviewed teaching clip
→ reviewed assessment
→ saved learner attempt
→ immutable route event
→ persisted dashboard signal
→ signal-linked private proposal
```

It should fail if the trace selects a merely recent but unlinked proposal.

## 7. Clean portfolio hygiene separately

Before deleting stale local records:

1. create a timestamped PostgreSQL backup;
2. inventory the seven `Untitled course` records and the learner-visible untitled
   course by exact ID, owner, status, and dependencies;
3. present that allowlist for user confirmation;
4. delete only the confirmed IDs through the owned-course deletion path;
5. verify the instructor portfolio and learner portfolio expose only the intended
   competition course.

This cleanup should not be hidden inside `demo:reset`; fixture reset and legacy
data deletion have different risk profiles.

## 8. Automated acceptance checks

`npm run demo:check` should fail unless all of these are true:

- exactly one fixture course exists and is published;
- 4–6 reviewed concepts exist;
- at least one accepted prerequisite exists and the graph is acyclic;
- the showcased misconception, alternate clip, assessment, and remediation rule
  resolve to exact current-revision IDs;
- every showcased concept has reviewed clip and assessment coverage;
- one complete eight-stage decision trace exists;
- one private proposal is still awaiting `Accept / Edit / Dismiss`;
- no fixture learner lacks the simulated label;
- no learner-visible course is untitled;
- rerunning reset preserves the same logical IDs and counts;
- web, pipeline, and media health checks pass.

## 9. Human rehearsal

After reset, rehearse the three-minute path from a new browser session:

1. instructor login;
2. open the only course;
3. read the graph without rearranging it;
4. show Live/Design and one review gate;
5. show the learner's misconception and remediation route;
6. open the dashboard signal;
7. open the complete trace;
8. end on the private proposed revision.

Time the instructor's real review of the curated generated draft separately. That
measurement is required before claiming the under-60-minute active-review target.

## Recommended implementation order

1. User confirms source and licence.
2. Build fixture schema, UUID namespace, and read-only verifier.
3. Curate one normal generated revision through the UI.
4. Export reviewed artifacts to the fixture.
5. Implement transactional reset and idempotency tests.
6. Seed labelled learner history through domain services.
7. Generate the exact signal and signal-linked proposal.
8. Run full verification twice and compare logical manifests.
9. Back up and clean stale allowlisted records after explicit confirmation.
10. Record the demo only from a successful `demo:check`.
