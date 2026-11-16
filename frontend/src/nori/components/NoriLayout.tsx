// NORI: Additive file. Shared shell for the Nori pages — nav + bootstrap status banner.
// Reuses Tailwind tokens only (no parallel UI kit); shadcn primitives live in
// @/components/ui and can be pulled in per-page as the pages get built out.

import { useEffect, useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { Battery, BatteryLow, Menu } from "lucide-react";
import { useNori } from "@/nori/NoriContext";
import { useTeleopSession } from "@/nori/TeleopSessionContext";
import { openDocs } from "@/lib/docs";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";

// Always-visible connection status. Connecting happens once on Home (ConnectionPanel); every
// page just reads this shared chip. When disconnected it doubles as a shortcut back to Home.
const ConnectionChip = () => {
  const { running, connState, connecting } = useTeleopSession();
  const connected = running && connState === "connected";
  const status = connected
    ? "connected"
    : connecting ? "connecting…" : running ? connState : "not connected";
  const cls =
    "rounded-full px-3 py-1 font-mono text-xs " +
    (connected ? "bg-nori-h8ab135/25 text-nori-h4d6a1e" : "bg-nori-h14131a/8 text-nori-h857b6b");
  return connected ? (
    <span className={cls} title="Connected. Manage the session on Home.">● {status}</span>
  ) : (
    <Link to="/nori" className={cls + " hover:opacity-80"} title="Connect on Home">● {status}</Link>
  );
};

// Robot battery, shown beside the connection chip. battery_percent only rides the telemetry
// stream, which only flows while connected — so this renders nothing until a session is up and
// a reading has arrived (null = no monitor / reader down / voltage unknown).
const BatteryChip = () => {
  const { running, connState, tel } = useTeleopSession();
  const connected = running && connState === "connected";
  if (!connected || tel.batteryPercent == null) return null;
  const pct = tel.batteryPercent;
  const low = pct <= 15;
  const cls =
    "inline-flex items-center gap-1 rounded-full px-3 py-1 font-mono text-xs " +
    (low ? "bg-nori-hd24a3d/20 text-nori-h8f2318" : "bg-nori-h8ab135/25 text-nori-h4d6a1e");
  const Icon = low ? BatteryLow : Battery;
  return (
    <span className={cls} title="Robot battery">
      <Icon className="h-3.5 w-3.5" /> {pct}%
    </span>
  );
};

// Shared across Nori pages; unknown or disconnected readings must not raise an alert.
const LowBatteryBanner = () => {
  const { running, connState, tel } = useTeleopSession();
  const pct = tel.batteryPercent;
  if (!running || connState !== "connected" || pct == null || !Number.isFinite(pct) || pct < 0 || pct > 10) return null;
  return (
    <div role="alert" className="mb-4 rounded-md border border-nori-hd24a3d/35 bg-nori-hfde7e4 px-4 py-3 text-nori-ha3271c">
      <p className="font-mono text-[11px] uppercase tracking-[0.14em]">
        Battery low. Charge the robot now.
      </p>
      <p className="mt-1 text-sm">Robot battery is at {pct}%.</p>
    </div>
  );
};

// `mobileOnly` items are hidden from the inline (lg and up) row and only appear in the
// drawer — which is itself only reachable below lg. Drive is the phone-sized control pad;
// on a laptop the Remote console is strictly better, so the tab would just be a worse door
// to the same session.
const NAV: { to: string; label: string; mobileOnly?: boolean }[] = [
  { to: "/nori/mobile", label: "Drive", mobileOnly: true },
  { to: "/nori/remote", label: "Remote" },
  { to: "/nori/coding", label: "Coding" },
  { to: "/nori/agent", label: "Agent" },
  { to: "/nori/training", label: "Training" },
  { to: "/nori/my-stuff", label: "My Stuff" },
  { to: "/nori/marketplace", label: "Marketplace" },
  { to: "/nori/pairing", label: "Pairing" },
  { to: "/nori/account", label: "Account" },
];

const NoriLayout = () => {
  const { loading, error, ready, session } = useNori();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  // Mobile/tablet drawer. Below `lg` the row of links can't fit, so it collapses behind a
  // hamburger into a slide-in side menu.
  const [menuOpen, setMenuOpen] = useState(false);

  // Landing (/nori) and marketplace bring themselves up with their own staggered FadeIn, so the
  // blanket page fade would double up there — everywhere else gets the quick full-page fade.
  const pageFade = pathname !== "/nori" && pathname !== "/nori/marketplace";

  // Once bootstrap is done and Supabase is ready, an unauthenticated visitor to any
  // Nori page is sent to sign-in. We wait for `!loading` so we don't bounce during the
  // initial session restore.
  useEffect(() => {
    if (!loading && ready && !session) {
      navigate("/nori/sign-in", { replace: true });
    }
  }, [loading, ready, session, navigate]);

  // Close the drawer whenever navigation completes — a tapped link changes `pathname`, so this
  // dismisses the menu without every link needing its own onClick. Also covers programmatic
  // navigation (e.g. the sign-in redirect above).
  useEffect(() => { setMenuOpen(false); }, [pathname]);

  const navLinkCls = (to: string, active: string, inactive: string) =>
    pathname === to ? active : inactive;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b">
        <nav className="mx-auto flex max-w-5xl items-center gap-4 px-4 py-3">
          {/* Hamburger — only below lg, where the inline links are hidden. */}
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            className="-ml-1 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground lg:hidden"
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>

          <Link to="/nori" className="flex items-center gap-2 font-semibold">
            <img src="/nori-logo.png" alt="Nori" className="h-7 w-7" />
            Nori
          </Link>

          {/* Inline links — lg and up. Below that they live in the drawer instead. */}
          <div className="hidden gap-5 text-sm lg:flex">
            {NAV.filter((item) => !item.mobileOnly).map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className={navLinkCls(item.to, "text-foreground", "text-muted-foreground hover:text-foreground")}
              >
                {item.label}
              </Link>
            ))}
            {/* Docs live on a separately-hosted site, never bundled into the desktop build —
                so this is a link OUT, not a route. openDocs() sends it to the system browser
                on desktop (a plain <a> would navigate the app's own webview away from itself). */}
            <button
              type="button"
              onClick={() => void openDocs()}
              className="text-muted-foreground hover:text-foreground"
              title="Open the Nori docs in your browser"
            >
              Docs ↗
            </button>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <BatteryChip />
            <ConnectionChip />
          </div>
        </nav>
      </header>

      {/* The collapsed nav: a left-side drawer for tablet/mobile. The same NAV list, stacked and
          full-width for touch. Closes on navigation via the pathname effect above. */}
      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="left" className="w-72 p-0">
          <SheetHeader className="border-b px-4 py-3 text-left">
            <SheetTitle className="flex items-center gap-2">
              <img src="/nori-logo.png" alt="" className="h-6 w-6" />
              Nori
            </SheetTitle>
          </SheetHeader>
          <nav className="flex flex-col gap-0.5 p-3">
            {NAV.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className={
                  "rounded-md px-3 py-2.5 text-sm " +
                  navLinkCls(
                    item.to,
                    "bg-muted font-medium text-foreground",
                    "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )
                }
              >
                {item.label}
              </Link>
            ))}
            <a href="/nori/calibration-target" className="rounded-md px-3 py-2.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">Calibration Tools</a>
            <button
              type="button"
              onClick={() => { setMenuOpen(false); void openDocs(); }}
              className="rounded-md px-3 py-2.5 text-left text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
              title="Open the Nori docs in your browser"
            >
              Docs ↗
            </button>
          </nav>
        </SheetContent>
      </Sheet>

      {loading && (
        <div className="bg-muted px-4 py-2 text-center text-sm text-muted-foreground">
          Connecting to Nori…
        </div>
      )}
      {error && (
        <div className="bg-destructive/10 px-4 py-2 text-center text-sm text-destructive">
          {error}
        </div>
      )}

      <main className="mx-auto max-w-5xl px-4 py-6">
        <LowBatteryBanner />
        {/* Quick 0.7s page fade on every navigation, keyed by path so it re-plays. Skipped on
            landing + marketplace, which already run their own staggered FadeIn bring-up. The
            motion-reduce guard drops the animation for users who ask for reduced motion. */}
        {pageFade ? (
          <div key={pathname} className="animate-in fade-in duration-700 motion-reduce:animate-none">
            <Outlet />
          </div>
        ) : (
          <Outlet />
        )}
      </main>
    </div>
  );
};

export default NoriLayout;
