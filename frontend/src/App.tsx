import {
  BrowserRouter as Router,
  Routes,
  Route,
  BrowserRouter,
} from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { UrdfProvider } from "@/contexts/UrdfContext";
import { DragAndDropProvider } from "@/contexts/DragAndDropContext";
import { Toaster } from "@/components/ui/toaster";
import Landing from "@/pages/Landing";
import Teleoperation from "@/pages/Teleoperation";
import DirectFollower from "@/pages/DirectFollower";
import Calibration from "@/pages/Calibration";
import Recording from "@/pages/Recording";
import Training from "@/pages/Training";
import ReplayDataset from "@/pages/ReplayDataset";
import EditDataset from "@/pages/EditDataset";
import Upload from "@/pages/Upload";

import NotFound from "@/pages/NotFound";
import "./App.css";
import { TooltipProvider } from "@radix-ui/react-tooltip";
import { ApiProvider } from "./contexts/ApiContext";

const queryClient = new QueryClient();

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ThemeProvider>
          <ApiProvider>
            <UrdfProvider>
              <DragAndDropProvider>
                <BrowserRouter>
                  <Routes>
                    <Route path="/" element={<Landing />} />
                    <Route path="/teleoperation" element={<Teleoperation />} />
                    <Route path="/recording" element={<Recording />} />
                    <Route path="/upload" element={<Upload />} />
                    <Route path="/training" element={<Training />} />
                    <Route path="/calibration" element={<Calibration />} />
                    <Route path="/edit-dataset" element={<EditDataset />} />
                    <Route path="/replay-dataset" element={<ReplayDataset />} />

                    <Route path="*" element={<NotFound />} />
                  </Routes>
                  <Toaster />
                </BrowserRouter>
              </DragAndDropProvider>
            </UrdfProvider>
          </ApiProvider>
        </ThemeProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
