// NORI: Additive file. Landing page for /nori — a short get-started overview in the
// NoriWebsite visual language (paper/ink, // eyebrows, display headline, tinted
// feature cards) pointing at the app's three main surfaces.

import { useEffect, useState, type SVGProps, type ReactElement } from "react";
import { Link } from "react-router-dom";
import { Battery, BatteryLow } from "lucide-react";
import { useApi } from "@/contexts/ApiContext";
import { FadeIn } from "@/nori/components/FadeIn";
import { ConnectionControls, ConnectionSettings, ConnectionStatus } from "@/nori/components/ConnectionPanel";
import { useNori } from "@/nori/NoriContext";
import { useTeleopSession } from "@/nori/TeleopSessionContext";
import { listRobots } from "@/nori/api/client";

// Brand glyphs for the dev card's social links. lucide dropped most brand icons, so these are
// the official simple-icons paths, inline as currentColor SVGs (inherit the link's text color).
const GitHubIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden {...props}>
    <path d="M12 .5C5.37.5 0 5.87 0 12.5c0 5.3 3.44 9.8 8.21 11.39.6.11.82-.26.82-.58 0-.29-.01-1.05-.02-2.06-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.73.08-.73 1.21.09 1.84 1.24 1.84 1.24 1.07 1.84 2.81 1.31 3.5 1 .11-.78.42-1.31.76-1.61-2.67-.3-5.47-1.34-5.47-5.95 0-1.31.47-2.39 1.24-3.23-.13-.3-.54-1.53.12-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 016 0c2.29-1.55 3.3-1.23 3.3-1.23.66 1.65.25 2.88.12 3.18.77.84 1.24 1.92 1.24 3.23 0 4.62-2.81 5.64-5.49 5.94.43.37.81 1.1.81 2.22 0 1.6-.01 2.89-.01 3.29 0 .32.22.7.83.58A12.01 12.01 0 0024 12.5C24 5.87 18.63.5 12 .5z" />
  </svg>
);
const DiscordIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden {...props}>
    <path d="M20.317 4.369a19.79 19.79 0 00-4.885-1.515.074.074 0 00-.079.037c-.211.375-.444.865-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.25.077.077 0 00-.079-.037A19.736 19.736 0 003.677 4.37a.07.07 0 00-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 00.031.057 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 00-.041-.106 13.107 13.107 0 01-1.872-.892.077.077 0 01-.008-.128 10.2 10.2 0 00.372-.291.074.074 0 01.077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 01.078.009c.12.099.246.198.373.292a.077.077 0 01-.006.127 12.3 12.3 0 01-1.873.891.077.077 0 00-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 00.084.028 19.839 19.839 0 006.002-3.03.077.077 0 00.032-.056c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.028zM8.02 15.331c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
  </svg>
);
const XIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden {...props}>
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
);

// Dev-card socials.
const SOCIALS: { label: string; href: string; Icon: (p: SVGProps<SVGSVGElement>) => ReactElement }[] = [
  { label: "GitHub", href: "https://github.com/nori-robotics", Icon: GitHubIcon },
  { label: "Discord", href: "https://discord.gg/d7gv7E6PZ", Icon: DiscordIcon },
  { label: "X", href: "https://x.com/norirobotics", Icon: XIcon },
];

/** "NORI-L2-0042" -> "Nori L2", "NORI-A3-0000" -> "Nori A3". Matches any
 *  <letter><digits> model code; unknown serial formats fall back to the
 *  flagship model name. */
function modelFromSerial(serial: string): string {
  const m = /^NORI-([A-Z]\d+)/i.exec(serial.trim());
  return m ? `Nori ${m[1].toUpperCase()}` : "Nori L2";
}

/** localStorage key for the last model this browser rendered — see robotImage(). */
const LAST_MODEL_KEY = "nori:lastRobotModel";

function rememberedModel(): string | null {
  try {
    return localStorage.getItem(LAST_MODEL_KEY);
  } catch {
    return null;
  }
}

function rememberModel(model: string) {
  try {
    localStorage.setItem(LAST_MODEL_KEY, model);
  } catch {
    /* private mode / storage disabled — the card just falls back to the default */
  }
}

/**
 * Card artwork for the paired robot, keyed off the same serial parse as the model name.
 * L3 and A3 have their own render; every other model (and the unpaired card) shows the L2.
 *
 * The serial is null on the first paint of every reload (the profile round-trip hasn't
 * landed yet) exactly as it is for an unpaired account, so defaulting straight to the L2
 * made an L3 owner watch the L2 flash by on each load. Fall back to the last model this
 * browser saw instead; the serial overrides it the moment the profile arrives, so a wrong
 * guess (new account, swapped robot) self-corrects within the same load.
 */
function robotImage(serial: string | null): { src: string; alt: string } {
  const model = serial ? modelFromSerial(serial) : rememberedModel() ?? "Nori L2";
  if (model === "Nori A3")
    return { src: "/images/nori-a3.png", alt: "Nori A3 robot" };
  if (model === "Nori L3")
    return { src: "/images/nori-l3.png", alt: "Nori L3 robot" };
  return { src: "/images/nori-l2.png", alt: "Nori L2 robot" };
}

// Robot battery pill for the "your robot" card. battery_percent only rides the telemetry stream,
// which only flows once connected — so the card shows nothing here when idle (its serial line
// reads normally), and the pill appears next to the serial once a live session reports a reading.
function BatteryPill() {
  const { running, connState, tel } = useTeleopSession();
  const connected = running && connState === "connected";
  if (!connected || tel.batteryPercent == null) return null;
  const pct = tel.batteryPercent;
  const low = pct <= 15;
  const Icon = low ? BatteryLow : Battery;
  const cls =
    "ml-2 inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 font-mono text-[12px] font-semibold tracking-[0.08em] " +
    (low ? "bg-nori-hd24a3d/15 text-nori-h8f2318" : "bg-nori-h8ab135/20 text-nori-h4d6a1e");
  return (
    <span className={cls} title="Robot battery">
      <Icon className="h-3.5 w-3.5" />
      {pct}%
    </span>
  );
}

const FEATURES: {
  n: string;
  title: string;
  body: string;
  to: string;
  tint: string;
}[] = [
  {
    n: "01",
    title: "Teleoperate",
    body: "Drive your robot live with your keyboard, physical leader arm, or VR headset. Video, audio, and telemetry included.",
    to: "/nori/remote",
    tint: "bg-sticker",
  },
  {
    n: "02",
    title: "Run it with code",
    body: "Describe a task in plain words and let the built-in LLM write a routine (or write one yourself!) then run it against the live robot.",
    to: "/nori/coding",
    tint: "bg-tan",
  },
  {
    n: "03",
    title: "Train",
    body: "Turn your teleop recordings into policies: launch cloud training, watch it live, and install the result from the marketplace.",
    to: "/nori/training",
    tint: "bg-sticker-2",
  },
];

const Home = () => {
  const { customer, session, activeRobotSerial, provisioning } = useNori();
  const { baseUrl, fetchWithHeaders } = useApi();
  const serial = activeRobotSerial ?? customer?.robot_serial_number ?? null;
  const paired = !!customer?.is_paired && !!serial;
  const robotArt = robotImage(paired ? serial : null);
  const [showSettings, setShowSettings] = useState(false);

  // Remember the model so the next reload paints the right artwork before the profile
  // fetch resolves. Only written once we actually know the robot — never from the
  // unpaired/pre-fetch state, which would just re-cache the placeholder.
  useEffect(() => {
    if (paired && serial) rememberModel(modelFromSerial(serial));
  }, [paired, serial]);

  // The customer profile only carries the active robot's SERIAL, not its nickname (that
  // lives on the robots list). Fetch it the same way account.tsx does — a per-page read of
  // GET /customers/me/robots — so the card can greet the customer with the name they chose
  // when pairing. Best-effort: on any failure the card just falls back to the model name.
  const [nickname, setNickname] = useState<string | null>(null);
  useEffect(() => {
    if (!session || !serial) {
      setNickname(null);
      return;
    }
    let cancelled = false;
    listRobots(baseUrl, fetchWithHeaders)
      .then((list) => {
        if (cancelled) return;
        const active = list.find((r) => r.robot_serial_number === serial);
        setNickname(active?.nickname?.trim() || null);
      })
      .catch(() => {
        if (!cancelled) setNickname(null);
      });
    return () => {
      cancelled = true;
    };
  }, [session, serial, baseUrl, fetchWithHeaders]);

  return (
  <section>
    {/* HERO — the marketplace-style wash: dot grid + pastel blobs behind a display headline. */}
    <div className="relative overflow-hidden rounded-[24px] border border-nori-h14131a/10 bg-background px-5 py-6 md:px-8 md:py-7">
      <div className="dot-grid pointer-events-none absolute inset-0 opacity-60" aria-hidden />
      <div
        className="pointer-events-none absolute -left-16 -top-16 h-48 w-48 rounded-full bg-leaf opacity-70 blur-3xl"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -right-12 top-10 h-40 w-40 rounded-full bg-sticker opacity-60 blur-3xl"
        aria-hidden
      />

      <div className="relative">
        <FadeIn>
          <span className="eyebrow">{"// welcome"}</span>
        </FadeIn>
        <FadeIn delay={60}>
          <h1 className="mt-4 font-display text-balance text-[clamp(2rem,4.5vw,3rem)] leading-[0.95] tracking-tight">
            Your robot, ready.
          </h1>
        </FadeIn>
        <FadeIn delay={140}>
          <p className="mt-3 max-w-2xl text-pretty text-[15px] leading-relaxed text-muted-foreground">
            This is the official Nori Lab app: everything you need to drive, program, and teach your robot lives here. 
            Get started below.
          </p>
        </FadeIn>
      </div>
    </div>

    {/* ROBOT + CONNECT — one card: pairing status (or a nudge to pair) plus the single connect
        surface. Connection state is global and outlives navigation, so every page drives this one
        session. Merged into a single row so the feature cards below stay above the fold. The image
        spans the full card height on the right; session settings drop full-width below the row. */}
    <FadeIn delay={200}>
    <div className="mt-4 rounded-[24px] border border-nori-h14131a/10 bg-background">
      <div className="flex items-stretch gap-6">
        <div className="min-w-0 flex-1 p-6 md:pl-8">
          <span className="eyebrow">{paired ? "// your robot" : "// get set up"}</span>
          {/* Lead with the customer's chosen nickname when they set one; the model name
              (from the serial) drops to a subtitle so it isn't lost. Falls back to the
              model as the heading for robots paired without a nickname. */}
          <h2 className="mt-3 font-display text-[1.7rem] font-normal leading-[1] tracking-tight text-ink">
            {paired ? nickname ?? modelFromSerial(serial!) : "Pair your robot"}
          </h2>
          {paired && nickname && (
            <div className="mt-1 text-[13px] leading-snug text-ink-2">
              {modelFromSerial(serial!)}
            </div>
          )}
          {paired ? (
            <p className="mt-3 text-[14px] leading-relaxed text-ink-2">
              <span className="rounded-full border border-ink/20 bg-background px-2.5 py-0.5 font-mono text-[12px] font-semibold tracking-[0.08em] text-ink">
                {serial}
              </span>
              <BatteryPill />{" "}
              is linked to this account and ready to connect.{" "}
              <Link to="/nori/pairing" className="font-semibold text-ink underline-offset-2 hover:underline">
                manage pairing →
              </Link>
            </p>
          ) : (
            <p className="mt-3 max-w-lg text-[14px] leading-relaxed text-ink-2">
              {provisioning
                ? "Checking your account…"
                : "No robot is linked to this account yet. Pair yours with the serial number on the sticker under the base — it takes a minute."}{" "}
              <Link to="/nori/pairing" className="font-semibold text-ink underline-offset-2 hover:underline">
                pair now →
              </Link>
            </p>
          )}
          <ConnectionControls
            showSettings={showSettings}
            onToggleSettings={() => setShowSettings((v) => !v)}
          />
        </div>
        <img
          src={robotArt.src}
          alt={robotArt.alt}
          className="relative z-10 mr-6 -mt-8 h-52 w-auto shrink-0 self-end object-contain object-bottom md:mr-12 md:-mt-14 md:h-60"
        />
      </div>
      {/* Connect progress / failure, full-width below the row. Sits directly above the settings
          form because that's what a failure usually sends you to fix. Self-hiding when idle. */}
      <div className="px-6 pb-6 empty:hidden md:px-8">
        <ConnectionStatus />
      </div>
      {showSettings && (
        <div className="px-6 pb-6 md:px-8">
          <ConnectionSettings />
        </div>
      )}
    </div>
    </FadeIn>

    <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4">
      <div><h2 className="text-sm font-semibold">Camera checkerboard</h2><p className="mt-1 text-sm text-muted-foreground">Open the measured screen target on a phone to prepare front or overhead camera calibration.</p></div>
      <a href="/nori/calibration-target" className="inline-flex min-h-11 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground">Open target →</a>
    </div>

    {/* FEATURES — the website's three-step tinted card rhythm, linking into the app. */}
    <div className="mt-6 grid gap-4 md:grid-cols-3">
      {FEATURES.map((f, i) => (
        <FadeIn key={f.n} delay={260 + i * 80} className="h-full">
        <Link
          to={f.to}
          className={`group flex h-full flex-col rounded-[24px] border border-nori-h14131a/10 p-6 transition-[transform,box-shadow] duration-200 ease-bounce hover:-translate-y-1 hover:shadow-pop ${f.tint}`}
        >
          <span className="w-fit rounded-full border border-ink/20 bg-background px-2.5 py-0.5 font-mono text-[11px] font-semibold tracking-[0.14em] text-ink">
            {f.n}
          </span>
          <h3 className="mt-5 font-display text-[1.7rem] font-normal leading-[1] tracking-tight text-ink">
            {f.title}
          </h3>
          <p className="mt-3 flex-1 text-[14px] leading-relaxed text-ink-2">{f.body}</p>
          <span className="eyebrow mt-5 text-ink">open →</span>
        </Link>
        </FadeIn>
      ))}
    </div>

    {/* DEVELOPERS — the closing note for builders: everything (app + SDK) is open source, with
        social links out to GitHub / Discord / X. Light border to match the rest of the page; it
        stands apart from the feature trio by being a full-width leaf band with social pills. */}
    <FadeIn delay={200}>
    <div className="mt-6 rounded-[24px] border border-nori-h14131a/10 bg-moss p-6 md:px-8 md:py-8">
      <span className="eyebrow text-ink">{"// devs first"}</span>
      <h2 className="mt-3 font-display text-[1.7rem] font-normal leading-[1.05] tracking-tight text-ink">
        Built to be built on.
      </h2>
      <p className="mt-3 max-w-2xl text-[14px] leading-relaxed text-ink-2">
        Everything in this app is open source, and so is the Nori SDK. Find us on GitHub and start
        building today. Get community support and updates from our Discord and X.
      </p>
      <div className="mt-5 flex flex-wrap gap-3">
        {SOCIALS.map(({ label, href, Icon }) => (
          <a
            key={label}
            href={href}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-full border border-ink/20 bg-background px-4 py-2 text-[13px] font-semibold text-ink transition-[transform,box-shadow] duration-200 ease-bounce hover:-translate-y-0.5 hover:shadow-soft"
          >
            <Icon className="h-4 w-4" />
            {label}
          </a>
        ))}
      </div>
    </div>
    </FadeIn>

    <FadeIn delay={260}>
      <p className="eyebrow mt-8">{"// manage your account under Account"}</p>
    </FadeIn>
  </section>
  );
};

export default Home;
