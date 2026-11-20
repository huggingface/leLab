import { createRoot } from "react-dom/client";
import { DatasetCaptureCard } from "@/nori/remote/DatasetCaptureCard";
import { groupRecordings, recordingOutcome, recordingName } from "@/nori/remote/recordingPresentation";
import { resetFixtures, useFixtureRecordings } from "./recordingCheckHooks";
import "@/index.css";

function RecordingCheck() {
  const recordings = useFixtureRecordings();
  const groups = groupRecordings(recordings);
  return <main className="mx-auto max-w-6xl space-y-7 p-6 md:p-10">
    <header className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Nori Lab · local interface check</p>
      <h1 className="text-3xl font-bold">Distinct takes. Clear recording groups.</h1>
      <p className="max-w-3xl text-muted-foreground">This uses Lab’s actual recording card and grouping logic with simulated recording replies and API data. No robot, account, or cloud upload is connected.</p>
    </header>
    <div className="grid items-start gap-6 lg:grid-cols-2">
      <DatasetCaptureCard defaultOpen />
      <section aria-label="Recording results" className="space-y-4">
        <div className="flex items-center justify-between"><h2 className="text-xl font-semibold">Recording results</h2>
          <button className="text-sm underline" onClick={resetFixtures}>Clear test recordings</button></div>
        <p className="text-sm text-muted-foreground">{recordings.length} takes · {groups.length} groups. Results survive reload. Keep a success and a failure, finish the session, then start another with the same prompt.</p>
        {groups.map((group) => <article key={group.key} className="space-y-3 rounded-xl border border-border bg-card p-4">
          <h3 className="font-semibold">{group.label}</h3>
          {group.bundles.map((take) => <div key={take.session_id} className="space-y-1 border-t border-border pt-3">
            <p className="break-words text-sm font-medium">{recordingName(take)}</p>
            <p className="text-xs">{recordingOutcome(take)}{recordings.find((row) => row.session_id === take.session_id)?.name ? ` · Custom name: ${recordings.find((row) => row.session_id === take.session_id)?.name}` : ""}</p>
          </div>)}
        </article>)}
      </section>
    </div>
  </main>;
}
createRoot(document.getElementById("root")!).render(<RecordingCheck />);
