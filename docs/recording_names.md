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

Unit coverage:

```bash
cd frontend
npm test -- src/nori/remote/recordingPresentation.test.ts src/nori/remote/pendingEpisodeNames.test.ts src/nori/remote/recordReview.test.ts src/nori/remote/mockRobot.test.ts
```
