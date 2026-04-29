import { UrdfContextType, UrdfContext } from "@/contexts/UrdfContext";
import { useContext } from "react";

// Custom hook to use the Urdf context
export const useUrdf = (): UrdfContextType => {
  const context = useContext(UrdfContext);
  if (context === undefined) {
    throw new Error("useUrdf must be used within a UrdfProvider");
  }
  return context;
};
