import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Download, Ruler, Smartphone, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  blackCell, boardFits, calibrationToolValues, fitBoardGeometry, INITIAL_SCREEN_SCALE, PROFILE_STORAGE_KEY,
  readSavedProfile, REFERENCE_MM, sameEnvironment, targetManifest, TARGET_VALUES_HEIGHT_PX,
  type BoardGeometry, type CameraRole, type ScreenEnvironment, type VerifiedScreenProfile,
} from "@/nori/calibration/screenTarget";

type Step = "setup" | "width" | "height" | "ready";
type Manifest = ReturnType<typeof targetManifest>;
type Run = { geometry: BoardGeometry; environment: ScreenEnvironment; manifest: Manifest };

function environment(): ScreenEnvironment {
  return {
    screenWidth: window.screen.width, screenHeight: window.screen.height,
    dpr: window.devicePixelRatio || 1, zoom: window.visualViewport?.scale ?? 1,
    orientation: `${window.screen.orientation?.type ?? "unknown"}:${window.innerWidth > window.innerHeight ? "landscape" : "portrait"}`,
  };
}
function viewport() {
  return { width: window.visualViewport?.width ?? window.innerWidth, height: window.visualViewport?.height ?? window.innerHeight };
}

function ReferenceGauge({ scale, vertical, onFits }: { scale: number; vertical: boolean; onFits: (fits: boolean) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [fits, setFits] = useState(false);
  const length = REFERENCE_MM * scale;
  useLayoutEffect(() => {
    const check = () => {
      const available = vertical ? viewport().height - 32 : (ref.current?.clientWidth ?? 0);
      const next = length + 28 <= available;
      setFits(next); onFits(next);
    };
    check();
    const observer = new ResizeObserver(check);
    if (ref.current) observer.observe(ref.current);
    window.visualViewport?.addEventListener("resize", check);
    return () => { observer.disconnect(); window.visualViewport?.removeEventListener("resize", check); };
  }, [length, vertical, onFits]);
  return (
    <div ref={ref} className="my-5 flex min-h-24 w-full items-center justify-center rounded-xl bg-white py-4 text-black" data-testid="reference-gauge">
      {fits ? (
        <svg width={vertical ? 36 : length + 28} height={vertical ? length + 28 : 36}
          role="img" aria-label={`${REFERENCE_MM} millimetre ${vertical ? "vertical" : "horizontal"} reference; measure between the two end ticks`}>
          {vertical ? <path d={`M18 14v${length} M5 14h26 M5 ${14 + length}h26`} fill="none" stroke="black" strokeWidth="2" />
            : <path d={`M14 18h${length} M14 5v26 M${14 + length} 5v26`} fill="none" stroke="black" strokeWidth="2" />}
        </svg>
      ) : <p className="px-4 text-center text-sm">The reference line is too large for this view. {vertical ? "Go back and check the width adjustment, or use a larger screen." : "Use the slider to make the line shorter."}</p>}
    </div>
  );
}

function DisplayTarget({ run, onPause }: { run: Run; onPause: (reason: string, invalidate?: boolean) => void }) {
  const stage = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const values = calibrationToolValues(run.manifest);
  useLayoutEffect(() => {
    const element = canvas.current;
    const context = element?.getContext("2d");
    if (!element || !context) { onPause("Your browser could not display the board. Try another browser."); return; }
    const g = run.geometry;
    element.width = g.widthDevicePixels; element.height = g.heightDevicePixels;
    context.imageSmoothingEnabled = false;
    context.fillStyle = "#ffffff"; context.fillRect(0, 0, element.width, element.height);
    context.fillStyle = "#000000";
    for (let row = 0; row < g.outerRows; row++) for (let col = 0; col < g.outerColumns; col++) {
      if (blackCell(col, row, { columns: g.innerColumns, rows: g.innerRows })) context.fillRect(col * g.squareDevicePixels, row * g.squareDevicePixels, g.squareDevicePixels, g.squareDevicePixels);
    }
    const check = () => {
      if (!sameEnvironment(run.environment, environment())) {
        onPause("Screen scaling or orientation changed. Check the screen size again before continuing.", true); return;
      }
      const bounds = stage.current?.getBoundingClientRect();
      const available = viewport();
      const width = Math.min(bounds?.width ?? 0, available.width);
      const height = Math.min(bounds?.height ?? 0, available.height - TARGET_VALUES_HEIGHT_PX);
      if (!boardFits(g, width, height)) {
        onPause("The whole board no longer fits. Use a smaller square size or make more screen space available."); return;
      }
      // Snap the canvas origin too: fractional placement would soften otherwise whole-pixel edges.
      element.style.left = `${Math.round((width - g.widthCssPixels) * run.environment.dpr / 2) / run.environment.dpr}px`;
      element.style.top = `${Math.round((height - g.heightCssPixels) * run.environment.dpr / 2) / run.environment.dpr}px`;
    };
    check();
    const observer = new ResizeObserver(check);
    if (stage.current) observer.observe(stage.current);
    window.addEventListener("resize", check);
    window.addEventListener("orientationchange", check);
    window.visualViewport?.addEventListener("resize", check);
    const hidden = () => { if (document.hidden) onPause("Target paused while this page was in the background. Show it again when you are ready."); };
    const fullscreen = () => { if (!document.fullscreenElement) onPause("Full screen closed. Show the checkerboard again when you are ready."); };
    document.addEventListener("visibilitychange", hidden);
    document.addEventListener("fullscreenchange", fullscreen);
    let wakeLock: WakeLockSentinel | undefined;
    let disposed = false;
    if (navigator.wakeLock && window.isSecureContext) {
      navigator.wakeLock.request("screen").then(lock => { if (disposed) void lock.release(); else wakeLock = lock; }).catch(() => {});
    }
    return () => {
      disposed = true; void wakeLock?.release(); observer.disconnect();
      window.removeEventListener("resize", check); window.removeEventListener("orientationchange", check);
      window.visualViewport?.removeEventListener("resize", check);
      document.removeEventListener("visibilitychange", hidden); document.removeEventListener("fullscreenchange", fullscreen);
    };
  }, [run, onPause]);
  return (
    <div className="fixed inset-0 z-[200] cursor-pointer touch-manipulation overflow-hidden bg-white"
      style={{ colorScheme: "only light", forcedColorAdjust: "none" }}
      role="button" tabIndex={0} aria-label={`Checkerboard displayed. ${values.boardArguments}. Default camera name: ${values.defaultCameraName}. Image topic: ${values.imageTopic}. Tap anywhere or press Escape to return to setup.`}
      onClick={() => onPause("Target paused. You can download its details below.")}
      onKeyDown={event => { if (["Escape", "Enter", " "].includes(event.key)) { event.preventDefault(); onPause("Target paused."); } }}>
      <div ref={stage} data-testid="checkerboard-area" className="absolute inset-x-0 top-0 overflow-hidden" style={{ bottom: TARGET_VALUES_HEIGHT_PX }}>
        <canvas ref={canvas} aria-hidden="true" data-testid="checkerboard-canvas" className="absolute block"
          style={{ width: run.geometry.widthCssPixels, height: run.geometry.heightCssPixels, imageRendering: "pixelated" }} />
      </div>
      <div data-testid="checkerboard-tool-values" className="absolute inset-x-0 bottom-0 flex flex-col justify-center gap-1 overflow-hidden bg-slate-900 px-4 py-2 font-mono text-[clamp(10px,1.4vw,12px)] leading-4 text-white"
        style={{ height: TARGET_VALUES_HEIGHT_PX }}>
        <div className="flex flex-wrap gap-x-5 gap-y-1"><span className="whitespace-nowrap">--size {values.size}</span><span className="whitespace-nowrap">--square {values.square}</span></div>
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-[clamp(10px,1.3vw,11px)] leading-4"><span className="whitespace-nowrap">--camera_name {values.defaultCameraName} (default)</span><span className="whitespace-nowrap">image: {values.imageTopic}</span></div>
      </div>
    </div>
  );
}

/** Standalone target: intentionally mounts without API/auth, robot sessions, or app overlays. */
export default function CameraCalibrationTarget() {
  const [step, setStep] = useState<Step>("setup");
  const [scale, setScale] = useState(INITIAL_SCREEN_SCALE);
  const [profile, setProfile] = useState<VerifiedScreenProfile | null>(null);
  const [layout, setLayout] = useState(viewport);
  const [zoom, setZoom] = useState(() => environment().zoom);
  const [referenceFits, setReferenceFits] = useState(false);
  const [squareMm, setSquareMm] = useState(6);
  const [role, setRole] = useState<CameraRole>("overhead");
  const [run, setRun] = useState<Run | null>(null);
  const [lastManifest, setLastManifest] = useState<Manifest | null>(null);
  const [notice, setNotice] = useState("");
  const [toolCopyStatus, setToolCopyStatus] = useState("");
  const verificationEnvironment = useRef<ScreenEnvironment | null>(null);
  const ownsFullscreen = useRef(false);
  const landscape = layout.width > layout.height;
  const normalZoom = Math.abs(zoom - 1) < .005;

  useEffect(() => {
    const previousTitle = document.title;
    document.title = "Camera checkerboard · Nori Lab";
    return () => { document.title = previousTitle; };
  }, []);

  useEffect(() => {
    try {
      const saved = readSavedProfile(localStorage.getItem(PROFILE_STORAGE_KEY), environment());
      if (saved && Math.abs(environment().zoom - 1) < .005) {
        setProfile(saved); setScale(saved.cssPixelsPerMm); setStep("ready");
        setNotice("Your saved screen size is ready. Recheck it if the phone or browser settings have changed.");
      }
    } catch { /* A blocked storage API must not block fresh setup. */ }
  }, []);

  const invalidate = useCallback(() => {
    setRun(null); setProfile(null); setLastManifest(null); setToolCopyStatus(""); verificationEnvironment.current = null;
    try { localStorage.removeItem(PROFILE_STORAGE_KEY); } catch { /* Continue without persistence. */ }
    if (ownsFullscreen.current && document.fullscreenElement === document.documentElement) {
      ownsFullscreen.current = false;
      void document.exitFullscreen().catch(() => {});
    }
  }, []);

  const pause = useCallback((reason: string, invalid = false) => {
    setRun(null); setNotice(reason);
    if (invalid) { invalidate(); setStep("setup"); }
    if (ownsFullscreen.current && document.fullscreenElement === document.documentElement) {
      ownsFullscreen.current = false;
      void document.exitFullscreen().catch(() => {});
    }
  }, [invalidate]);

  useEffect(() => {
    const changed = () => {
      const e = environment(); setLayout(viewport()); setZoom(e.zoom);
      const expected = profile?.environment ?? verificationEnvironment.current;
      if (expected && !sameEnvironment(expected, e)) {
        invalidate(); setStep("setup");
        setNotice("Screen scaling or orientation changed. Please check the screen size again.");
      }
    };
    window.addEventListener("resize", changed); window.addEventListener("orientationchange", changed);
    window.addEventListener("pageshow", changed); window.addEventListener("focus", changed);
    window.visualViewport?.addEventListener("resize", changed);
    const query = window.matchMedia(`(resolution: ${environment().dpr}dppx)`);
    query.addEventListener("change", changed);
    return () => {
      window.removeEventListener("resize", changed); window.removeEventListener("orientationchange", changed);
      window.removeEventListener("pageshow", changed); window.removeEventListener("focus", changed);
      window.visualViewport?.removeEventListener("resize", changed); query.removeEventListener("change", changed);
    };
  }, [profile, invalidate]);

  const goToWidth = () => {
    invalidate(); verificationEnvironment.current = environment(); setNotice(""); setStep("width");
  };
  const verify = () => {
    const e = environment();
    if (!landscape || !normalZoom || !referenceFits || !verificationEnvironment.current
      || !sameEnvironment(verificationEnvironment.current, e)) {
      invalidate(); setStep("setup"); setNotice("Keep the phone sideways at normal zoom, then repeat the size check."); return;
    }
    const p: VerifiedScreenProfile = { version: 1, cssPixelsPerMm: scale, verifiedAt: new Date().toISOString(), environment: e };
    setProfile(p); setStep("ready"); setNotice("Screen size checked in both directions. Choose a board size below.");
    try { localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(p)); }
    catch { setNotice("Screen size is checked for this visit. Your browser could not save it for next time."); }
  };
  const start = async () => {
    if (!profile) return;
    setNotice("");
    try {
      if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen(); ownsFullscreen.current = true;
      }
    } catch { /* The target also works without fullscreen when its whole geometry fits. */ }
    const e = environment();
    if (!sameEnvironment(profile.environment, e) || Math.abs(e.zoom - 1) >= .005) {
      pause("Display settings changed. Check the screen size again.", true); return;
    }
    const available = viewport();
    const geometry = fitBoardGeometry(squareMm, profile.cssPixelsPerMm, e.dpr, available.width, available.height - TARGET_VALUES_HEIGHT_PX);
    if (!geometry) {
      pause("This board is too large for the available screen. Choose smaller squares; the board will keep its measured size."); return;
    }
    const id = crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Array.from(crypto.getRandomValues(new Uint32Array(2)), n => n.toString(36)).join("")}`;
    const manifest = targetManifest(profile, squareMm, role, e, `screen-${id}`, { columns: geometry.innerColumns, rows: geometry.innerRows });
    setToolCopyStatus(""); setLastManifest(manifest); setRun({ geometry, environment: e, manifest });
  };
  const download = () => {
    if (!lastManifest || !profile || !sameEnvironment(profile.environment, environment())) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(lastManifest, null, 2) + "\n"], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url;
    link.download = `${lastManifest.target_id}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const changeBoard = (value: number) => { setSquareMm(value); setLastManifest(null); setToolCopyStatus(""); };
  const copyToolValues = async () => {
    if (!lastManifest) return;
    try {
      await navigator.clipboard.writeText(calibrationToolValues(lastManifest).boardArguments);
      setToolCopyStatus("Board arguments copied.");
    } catch { setToolCopyStatus("Copy is unavailable in this browser. Select the board arguments below and copy them manually."); }
  };
  const geometry = profile ? fitBoardGeometry(squareMm, profile.cssPixelsPerMm, environment().dpr, layout.width, layout.height - TARGET_VALUES_HEIGHT_PX) : null;
  const toolValues = lastManifest ? calibrationToolValues(lastManifest) : null;
  const steps: Step[] = ["setup", "width", "height", "ready"];
  const stepIndex = steps.indexOf(step);

  if (run) return <DisplayTarget run={run} onPause={pause} />;

  return (
    <main className="min-h-screen bg-background px-4 py-6 text-foreground sm:px-6 sm:py-10">
      <div className="mx-auto max-w-2xl">
        <a href="/nori" className="inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft size={16} /> Nori Lab</a>
        <div className="mt-5 flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-muted-foreground"><Smartphone size={16} /> Camera calibration target</div>
        <h1 className="mt-3 font-display text-3xl leading-tight sm:text-4xl">A checkerboard on your phone.</h1>
        <p className="mt-3 max-w-xl text-base text-muted-foreground">Use a ruler to check its size, then hold the screen toward your robot’s camera. This page displays the board; it does not move or calibrate the robot.</p>

        <ol aria-label="Screen setup progress" className="my-7 grid grid-cols-4 gap-2">
          {["Setup", "Width", "Height", "Ready"].map((label, index) => (
            <li key={label} aria-current={index === stepIndex ? "step" : undefined}
              className={`border-t-2 pt-2 text-sm ${index <= stepIndex ? "border-primary text-foreground" : "border-border text-muted-foreground"}`}>
              <span className="font-mono text-xs">{index < stepIndex ? "✓" : `${index + 1}.`}</span> {label}
            </li>
          ))}
        </ol>

        {notice && <p role="status" className="mb-5 rounded-xl bg-muted p-4 text-sm leading-relaxed">{notice}</p>}
        {(!landscape || !normalZoom) && <p role="alert" className="mb-5 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
          {!landscape ? "Turn your phone sideways to landscape before checking the size." : "Return to normal browser zoom before checking the size. The checkerboard cannot be used while zoomed in."}
        </p>}

        {step === "setup" && <section aria-labelledby="setup-heading" className="space-y-5">
          <h2 id="setup-heading" className="text-xl font-semibold">First, get your screen ready.</h2>
          <ul className="space-y-3 text-sm">
            <li className="flex gap-3"><Ruler size={20} className="shrink-0" /><span>Have a ruler with millimetre markings. You will check a 40 mm line in two directions.</span></li>
            <li className="flex gap-3"><Sun size={20} className="shrink-0" /><span>Clean the screen, keep its brightness steady, and turn off automatic brightness. Avoid reflections.</span></li>
            <li className="flex gap-3"><Smartphone size={20} className="shrink-0" /><span>Turn the phone sideways and lock screen rotation in landscape, if your phone supports it. Keep it in landscape throughout calibration and leave browser zoom at its normal setting.</span></li>
          </ul>
          <Button size="lg" className="min-h-12 w-full sm:w-auto" disabled={!landscape || !normalZoom} onClick={goToWidth}>Check screen size <ArrowRight className="ml-2 h-4 w-4" /></Button>
        </section>}

        {(step === "width" || step === "height") && <section aria-labelledby="measure-heading">
          <h2 id="measure-heading" className="text-xl font-semibold">{step === "width" ? "Match the line to 40 mm on your ruler." : "Now check the height with the same ruler."}</h2>
          <p className="mt-2 text-sm text-muted-foreground">Measure between the two end ticks. {step === "width" ? "Use the slider until that distance is exactly 40 mm." : "This vertical line must also measure 40 mm. If it does not, go back and repeat the width check."}</p>
          <ReferenceGauge scale={scale} vertical={step === "height"} onFits={setReferenceFits} />
          {step === "width" && <div className="space-y-3">
            <label htmlFor="reference-scale" className="block text-sm font-medium">Adjust the line length</label>
            <input id="reference-scale" type="range" min="1" max="30" step="0.005" value={scale} onChange={event => setScale(Number(event.target.value))} className="h-11 w-full accent-primary" />
            <div className="flex gap-3"><Button variant="outline" className="min-h-11 flex-1" onClick={() => setScale(s => Math.max(1, s - .005))}>A little shorter</Button><Button variant="outline" className="min-h-11 flex-1" onClick={() => setScale(s => Math.min(30, s + .005))}>A little longer</Button></div>
          </div>}
          <div className="mt-6 flex flex-wrap gap-3">
            <Button variant="outline" size="lg" className="min-h-12" onClick={() => { setNotice(""); setStep(step === "height" ? "width" : "setup"); }}>Back</Button>
            <Button size="lg" className="min-h-12 flex-1" disabled={!referenceFits || !landscape || !normalZoom} onClick={() => { if (step === "width") setStep("height"); else verify(); }}>
              {step === "width" ? "The width measures 40 mm" : "The height measures 40 mm"} <Check className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </section>}

        {step === "ready" && profile && <section aria-labelledby="ready-heading" className="space-y-5">
          <h2 id="ready-heading" className="text-xl font-semibold">Your screen is ready.</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm font-medium">Camera you are checking<select value={role} onChange={event => { setRole(event.target.value as CameraRole); setLastManifest(null); setToolCopyStatus(""); }} className="mt-2 min-h-12 w-full rounded-lg border bg-background px-3 text-base"><option value="overhead">Overhead</option><option value="front">Front</option></select></label>
            <label className="block text-sm font-medium">Square size<select value={squareMm} onChange={event => changeBoard(Number(event.target.value))} className="mt-2 min-h-12 w-full rounded-lg border bg-background px-3 text-base">{[4, 5, 6, 8, 10].map(n => <option key={n} value={n}>{n} mm{n === 6 ? " · starting size" : ""}</option>)}</select></label>
          </div>
          <p className="text-sm text-muted-foreground">The grid automatically fills the available screen with whole squares and a full white border. Tool values stay visible in a separate strip below the board. Your measured square size stays the same.</p>
          {geometry ? <p className="text-sm text-muted-foreground">In this view: {geometry.squareColumns} × {geometry.squareRows} squares ({geometry.innerColumns} × {geometry.innerRows} inner corners), approximately {geometry.outerWidthMm.toFixed(1)} × {geometry.outerHeightMm.toFixed(1)} mm including the border. Full screen may fit more squares.</p>
            : <p role="status" className="text-sm text-muted-foreground">There is not enough room in this view. Try full screen with Show checkerboard, or choose smaller squares.</p>}
          <ol className="list-decimal space-y-2 pl-5 text-sm">
            <li>Show the checkerboard and turn the screen toward the selected robot camera.</li>
            <li>Keep landscape orientation locked while moving the board. If your phone cannot lock landscape, keep it sideways to prevent the screen rotating.</li>
            <li>Keep the whole board visible, hold still, and keep the screen awake. Follow the camera calibration instructions on your computer.</li>
            <li>Tap anywhere on the phone’s screen to return here. Download the target details for the calibration record.</li>
          </ol>
          <p className="rounded-xl bg-muted p-4 text-sm">A phone-sized board may be too small at longer distances. If the camera cannot see its corners clearly, use a larger measured board or tablet.</p>
          <Button size="lg" className="min-h-12 w-full" disabled={!landscape || !normalZoom} onClick={() => void start()}>Show checkerboard <ArrowRight className="ml-2 h-4 w-4" /></Button>
          <div className="flex flex-wrap gap-3"><Button variant="outline" className="min-h-11" onClick={goToWidth}>Check screen size again</Button><Button variant="outline" className="min-h-11" disabled={!lastManifest} onClick={download}><Download className="mr-2 h-4 w-4" /> Download target details</Button></div>
          <section aria-labelledby="tool-values-heading" className="space-y-4 rounded-xl border p-4">
            <h3 id="tool-values-heading" className="text-lg font-semibold">Calibration tool values</h3>
            {toolValues ? <>
              <p className="text-sm text-muted-foreground">These values match the last checkerboard shown. Keep this phone in the same orientation and use the same board while collecting images.</p>
              <dl className="grid gap-4 text-sm sm:grid-cols-2">
                <div><dt className="text-muted-foreground">Inner corners across × down · --size</dt><dd className="mt-1 break-all font-mono font-semibold">{toolValues.size}</dd></div>
                <div><dt className="text-muted-foreground">Square edge in metres · --square</dt><dd className="mt-1 break-all font-mono font-semibold">{toolValues.square}</dd></div>
                <div><dt className="text-muted-foreground">Default camera name · --camera_name</dt><dd className="mt-1 break-all font-mono">{toolValues.defaultCameraName}</dd></div>
                <div><dt className="text-muted-foreground">Decoded image topic</dt><dd className="mt-1 break-all font-mono">{toolValues.imageTopic}</dd></div>
              </dl>
              <p className="text-sm text-muted-foreground">Count the inside intersections, not the boxes. If the corner counts change, start a new calibration with the new values. Confirm the camera name on the robot; this page cannot read its settings.</p>
              <label className="block text-sm font-medium">Board arguments<textarea readOnly value={toolValues.boardArguments} onFocus={event => event.target.select()} rows={2} className="mt-2 w-full resize-none rounded-lg border bg-background p-3 font-mono text-sm" /></label>
              <Button variant="outline" className="min-h-11" onClick={() => void copyToolValues()}>Copy board arguments</Button>
              {toolCopyStatus && <p role="status" className="text-sm text-muted-foreground">{toolCopyStatus}</p>}
            </> : <p className="text-sm text-muted-foreground">Show the checkerboard once, then tap it to return here. The exact corner counts and square size will appear here for your calibration tool.</p>}
          </section>
          {lastManifest && <details className="rounded-lg border p-3 text-sm"><summary className="cursor-pointer font-medium">Target details for the calibration record</summary><p className="mt-3 break-all font-mono text-xs">Inner corners: {lastManifest.inner_corners.columns} × {lastManifest.inner_corners.rows} · square edge: {lastManifest.square_size_m.toFixed(9)} m · target {lastManifest.target_id}</p><p className="mt-2 text-muted-foreground">The file records the exact grid shown, verified size, and pixel rounding. Use its corner counts when calibrating. It contains target information, not a completed camera calibration.</p></details>}
        </section>}
        <footer className="mt-8 border-t pt-4 text-xs text-muted-foreground">Front and overhead monocular cameras · Nori calibration pilot</footer>
      </div>
    </main>
  );
}
