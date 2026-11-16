import { createRoot } from 'react-dom/client'
import './index.css'
import { initLocalAuth } from './lib/localAuth'
import { isTargetPath } from './nori/calibration/screenTarget'

// Pick up ?token= (local API auth) and scrub it from the URL before anything
// renders or fetches — see lib/localAuth.ts.
const container = document.getElementById("root")!;
const root = createRoot(container);
container.textContent = "Loading Nori Lab…";

// The measured screen target must not load robot/auth providers or global overlays.
// Ordinary anchor links give it its own document, including on the hosted mobile frontend.
const entry = isTargetPath(window.location.pathname)
  ? import('./nori/pages/calibration-target')
  : (initLocalAuth(), import('./App.tsx'));
entry.then(({ default: Page }) => root.render(<Page />)).catch(() => {
  container.textContent = "Nori Lab could not load. Check your connection and reload this page.";
  container.setAttribute("role", "alert");
});
