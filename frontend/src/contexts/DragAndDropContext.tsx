import React, {
  createContext,
  useState,
  useEffect,
  ReactNode,
  useCallback,
} from "react";

import { processDroppedFiles } from "@/lib/UrdfDragAndDrop";
import { useUrdf } from "@/hooks/useUrdf";

export type DragAndDropContextType = {
  isDragging: boolean;
  setIsDragging: (isDragging: boolean) => void;
  handleDrop: (e: DragEvent) => Promise<void>;
};

export const DragAndDropContext = createContext<
  DragAndDropContextType | undefined
>(undefined);

interface DragAndDropProviderProps {
  children: ReactNode;
}

export const DragAndDropProvider: React.FC<DragAndDropProviderProps> = ({
  children,
}) => {
  const [isDragging, setIsDragging] = useState(false);

  // Get the Urdf context
  const { urdfProcessor, processUrdfFiles } = useUrdf();

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDragEnter = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // Only set isDragging to false if we're leaving the document
    // This prevents flickering when moving between elements
    if (!e.relatedTarget || !(e.relatedTarget as Element).closest("html")) {
      setIsDragging(false);
    }
  };

  const handleDrop = useCallback(
    async (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      console.log("🔄 DragAndDropContext: Drop event detected");

      if (!e.dataTransfer || !urdfProcessor) {
        console.error("❌ No dataTransfer or urdfProcessor available");
        return;
      }

      try {
        console.log("🔍 Processing dropped files with urdfProcessor");

        // Process files first
        const { availableModels, files } = await processDroppedFiles(
          e.dataTransfer,
          urdfProcessor
        );

        // Delegate further processing to UrdfContext
        await processUrdfFiles(files, availableModels);
      } catch (error) {
        console.error("❌ Error in handleDrop:", error);
      }
    },
    [urdfProcessor, processUrdfFiles]
  );

  // Set up global event listeners
  useEffect(() => {
    document.addEventListener("dragover", handleDragOver);
    document.addEventListener("dragenter", handleDragEnter);
    document.addEventListener("dragleave", handleDragLeave);
    document.addEventListener("drop", handleDrop);

    return () => {
      document.removeEventListener("dragover", handleDragOver);
      document.removeEventListener("dragenter", handleDragEnter);
      document.removeEventListener("dragleave", handleDragLeave);
      document.removeEventListener("drop", handleDrop);
    };
  }, [handleDrop]); // Re-register when handleDrop changes

  return (
    <DragAndDropContext.Provider
      value={{
        isDragging,
        setIsDragging,
        handleDrop,
      }}
    >
      {children}
      {isDragging && (
        <div className="fixed inset-0 bg-primary/10 pointer-events-none z-50 flex items-center justify-center">
          <div className="bg-background p-8 rounded-lg shadow-lg text-center">
            <div className="text-3xl font-bold mb-4">Drop Urdf Files Here</div>
            <p className="text-muted-foreground">
              Release to upload your robot model
            </p>
          </div>
        </div>
      )}
    </DragAndDropContext.Provider>
  );
};
