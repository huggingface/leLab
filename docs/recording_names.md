# Recording naming check without motion

Use Node 22 or newer and the usual frontend dependencies:

```bash
cd frontend
npm run check:recording
```

Open `http://127.0.0.1:5181/recording-check.html`. This separate development
entry uses the production DatasetCaptureCard, SDK request correlation, recording
grouping and pending-name code. Only its session/API hooks are replaced by local
fixtures. It never connects to a robot, account or backend, publishes telemetry,
or creates cloud recordings. The simulated preview comes from a browser canvas.
The result panel uses the same grouping/outcome helpers as My Stuff; it is not
a live My Stuff/backend integration test. Fixture labels emulate shipper labels;
the real shipper formatter is covered by the nori_ws Python integration test.

1. Enter a task, Start session, then Start episode.
2. Select Success, Stop episode, and Keep. Optionally enter a custom take name.
3. Start another episode, select Failure, Stop and Keep.
4. Finish session. Start another session using the identical task and Keep a take.
5. Confirm three distinct take labels in two separate groups. The first group
   contains both task outcomes. Reload to verify the result and custom name persist.

Production behavior: UUID collections group takes independently of their editable
names, capture timestamps order them independently of delayed uploads, and outcome
badges describe task success rather than upload success. Unknown outcomes are not
invented. Legacy rows keep their label/time grouping. Select the task outcome before
Stop; Keep/Reject remains the separate choice to retain/delete a held take.

The backend needs migration 055 and the recording_metadata API before the robot
shipper change rolls out. No robot services are started by this UI work. The collection UUID uses the existing `tags` field; no protocol schema change is needed.
Older backends retain capture, grouping and manual naming. Updated Lab renders
upload-ID suffixes when metadata is absent and shows a manual-naming notice when
the backend cannot supply the episode IDs needed for safe automatic naming.

Modern custom names use the separate `nori.pendingEpisodeNames.v2` storage key,
so rolling back to an older Lab build cannot reinterpret them using task/time
matching. Existing legacy v1 queues still work. Identity-based entries from the
initial issue-51 build are moved from v1 to v2 when the updated queue is read.
Names retain the existing 48-hour expiry.

Known modern episode IDs are reserved before legacy task/time matching. These
reservations survive successful naming and browser reloads for 48 hours, so a
delayed legacy upload cannot claim a newer modern take on a later retry. IDs are
checked in both registration metadata and episode listings, including names
queued during a lookup. An ambiguous same-task upload on an older backend without
identity stays queued for manual naming; unrelated legacy queues retain their
existing behavior. Reservations also protect kept modern takes left unnamed.

Automatic naming prioritizes exact metadata IDs. For older backends, discovery
is limited to plausible recent single-take uploads with the same task label;
the actual episode ID must still match before a name is written. Each pass
makes at most eight episode-listing requests, shares lookups between pending
names, and never overlaps another pass for the same API/fetcher. Unsuccessful
passes back off from 30 seconds to five minutes. Cached identity discovery
expires after five minutes, and each write uses a fresh listing's episode index.
Each API operation has a 20-second deadline, including authentication and response
parsing. A timeout aborts transport and releases the retry lock. Uncertain rename
writes remain queued; the next pass re-lists the episode and skips a write that
the server already saved. Requests delayed in authentication cannot send after
their deadline.

The active collection is cached with the teleop client across card navigation,
and in tab-local sessionStorage by backend/robot across reload/reconnect. The v2
journal tracks acknowledged episode IDs; recovery reuses its group only when the
recovered episode belongs to it. A live client can also resume between episodes.
Unverifiable v1 journals are discarded, and Finish session clears the journal.
Recovery without a verified collection omits the collection tag so the live
gateway retains its group. UUID generation supports older browsers
without `crypto.randomUUID`; these IDs are not authentication credentials.

Unit coverage:

```bash
cd frontend
npm test -- src/nori/remote/recordingPresentation.test.ts src/nori/remote/pendingEpisodeNames.test.ts src/nori/remote/recordingSession.test.ts src/nori/remote/legacyCompatibility.test.ts src/nori/remote/recordReview.test.ts src/nori/remote/mockRobot.test.ts
```
