import {
  DragAndDropContextType,
  DragAndDropContext,
} from "@/contexts/DragAndDropContext";
import { useContext } from "react";

// Custom hook to use the DragAndDrop context
export const useDragAndDrop = (): DragAndDropContextType => {
  const context = useContext(DragAndDropContext);
  if (context === undefined) {
    throw new Error("useDragAndDrop must be used within a DragAndDropProvider");
  }
  return context;
};
