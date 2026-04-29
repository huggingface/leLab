import React, {
  createContext,
  useState,
  useCallback,
  ReactNode,
  useRef,
  useEffect,
} from "react";
import { toast } from "sonner";
import { UrdfProcessor, readUrdfFileContent } from "@/lib/UrdfDragAndDrop";
import { UrdfData, UrdfFileModel } from "@/lib/types";
import { useDefaultRobotData } from "@/hooks/useDefaultRobotData";
import { RobotAnimationConfig } from "@/lib/types";

// Define the result interface for Urdf detection
interface UrdfDetectionResult {
  hasUrdf: boolean;
  modelName?: string;
  parsedData?: UrdfData | null;
}

// Define the context type
export type UrdfContextType = {
  urdfProcessor: UrdfProcessor | null;
  registerUrdfProcessor: (processor: UrdfProcessor) => void;
  onUrdfDetected: (
    callback: (result: UrdfDetectionResult) => void
  ) => () => void;
  processUrdfFiles: (
    files: Record<string, File>,
    availableModels: string[]
  ) => Promise<void>;
  urdfBlobUrls: Record<string, string>;
  alternativeUrdfModels: string[];
  isSelectionModalOpen: boolean;
  setIsSelectionModalOpen: (isOpen: boolean) => void;
  urdfModelOptions: UrdfFileModel[];
  selectUrdfModel: (model: UrdfFileModel) => void;

  // Centralized robot data management
  currentRobotData: UrdfData | null;
  isDefaultModel: boolean;
  setIsDefaultModel: (isDefault: boolean) => void;
  resetToDefaultModel: () => void;
  urdfContent: string | null;

  // Animation configuration management
  currentAnimationConfig: RobotAnimationConfig | null;
  setCurrentAnimationConfig: (config: RobotAnimationConfig | null) => void;

  // These properties are kept for backward compatibility but are considered
  // implementation details and should not be used directly in components.
  // TODO: Remove these next three once the time is right
  parsedRobotData: UrdfData | null; // Data from parsed Urdf
  customModelName: string;
  customModelDescription: string;
};

// Create the context
export const UrdfContext = createContext<UrdfContextType | undefined>(
  undefined
);

// Props for the provider component
interface UrdfProviderProps {
  children: ReactNode;
}

export const UrdfProvider: React.FC<UrdfProviderProps> = ({ children }) => {
  // State for Urdf processor
  const [urdfProcessor, setUrdfProcessor] = useState<UrdfProcessor | null>(
    null
  );

  // State for blob URLs (replacing window.urdfBlobUrls)
  const [urdfBlobUrls, setUrdfBlobUrls] = useState<Record<string, string>>({});

  // State for alternative models (replacing window.alternativeUrdfModels)
  const [alternativeUrdfModels, setAlternativeUrdfModels] = useState<string[]>(
    []
  );

  // State for the Urdf selection modal
  const [isSelectionModalOpen, setIsSelectionModalOpen] = useState(false);
  const [urdfModelOptions, setUrdfModelOptions] = useState<UrdfFileModel[]>([]);

  // New state for centralized robot data management
  const [isDefaultModel, setIsDefaultModel] = useState(true);
  const [parsedRobotData, setParsedRobotData] = useState<UrdfData | null>(null);
  const [customModelName, setCustomModelName] = useState<string>("");
  const [customModelDescription, setCustomModelDescription] =
    useState<string>("");
  const [urdfContent, setUrdfContent] = useState<string | null>(null);

  // New state for animation configuration
  const [currentAnimationConfig, setCurrentAnimationConfig] =
    useState<RobotAnimationConfig | null>(null);

  // Get default robot data from our hook
  const { data: defaultRobotData } = useDefaultRobotData("so101");

  // Compute the current robot data based on model state
  const currentRobotData = isDefaultModel ? defaultRobotData : parsedRobotData;

  // Fetch the default Urdf content when the component mounts
  useEffect(() => {
    // Only fetch if we don't have content and we're using the default model
    if (isDefaultModel && !urdfContent) {
      const fetchDefaultUrdf = async () => {
        try {
          // Path to the default T12 Urdf file
          const defaultUrdfPath = "/so-101-urdf/urdf/so101_new_calib.urdf";

          // Fetch the Urdf content
          const response = await fetch(defaultUrdfPath);

          if (!response.ok) {
            throw new Error(
              `Failed to fetch default Urdf: ${response.statusText}`
            );
          }

          const defaultUrdfContent = await response.text();
          console.log(
            `📄 Default Urdf content loaded, length: ${defaultUrdfContent.length} characters`
          );

          // Set the Urdf content in state
          setUrdfContent(defaultUrdfContent);
        } catch (error) {
          console.error("❌ Error loading default Urdf content:", error);
        }
      };

      fetchDefaultUrdf();
    }
  }, [isDefaultModel, urdfContent]);

  // Log data state changes for debugging
  useEffect(() => {
    console.log("🤖 Robot data context updated:", {
      isDefaultModel,
      hasDefaultData: !!defaultRobotData,
      hasParsedData: !!parsedRobotData,
      currentData: currentRobotData ? "available" : "null",
    });
  }, [isDefaultModel, defaultRobotData, parsedRobotData, currentRobotData]);

  // Reference for callbacks
  const urdfCallbacksRef = useRef<((result: UrdfDetectionResult) => void)[]>(
    []
  );

  // Reset to default model
  const resetToDefaultModel = useCallback(() => {
    setIsDefaultModel(true);
    setCustomModelName("");
    setCustomModelDescription("");
    setParsedRobotData(null);
    setUrdfContent(null);
    setCurrentAnimationConfig(null);

    toast.info("Switched to default model", {
      description: "The default ARM100 robot model is now displayed.",
    });
  }, []);

  // Register a callback for Urdf detection
  const onUrdfDetected = useCallback(
    (callback: (result: UrdfDetectionResult) => void) => {
      urdfCallbacksRef.current.push(callback);

      return () => {
        urdfCallbacksRef.current = urdfCallbacksRef.current.filter(
          (cb) => cb !== callback
        );
      };
    },
    []
  );

  // Register a Urdf processor
  const registerUrdfProcessor = useCallback((processor: UrdfProcessor) => {
    setUrdfProcessor(processor);
  }, []);

  // Internal function to notify callbacks and update central state
  const notifyUrdfCallbacks = useCallback(
    (result: UrdfDetectionResult) => {
      console.log("📣 Notifying Urdf callbacks with result:", result);

      // Update our internal state based on the result
      if (result.hasUrdf) {
        // Always ensure we set isDefaultModel to false when we have a Urdf
        setIsDefaultModel(false);

        if (result.parsedData) {
          // Create a copy of the parsed data with any missing fields filled from our state
          const enhancedParsedData: UrdfData = {
            ...result.parsedData,
          };

          // Set the name if available, or use the provided modelName as fallback
          if (result.parsedData.name) {
            setCustomModelName(result.parsedData.name);
          } else if (result.modelName) {
            setCustomModelName(result.modelName);
            // Also update the parsed data with this name to be consistent
            enhancedParsedData.name = result.modelName;
          }

          // Set description if available
          if (result.parsedData.description) {
            setCustomModelDescription(result.parsedData.description);
          } else {
            // If no description in parsed data, set a default one
            const defaultDesc =
              "A detailed 3D model of a robotic system with articulated joints and components.";
            enhancedParsedData.description = defaultDesc;
            setCustomModelDescription(defaultDesc);
          }

          // Update parsed data with the enhanced version
          setParsedRobotData(enhancedParsedData);
        } else if (result.modelName) {
          // Only have model name, no parsed data
          setCustomModelName(result.modelName);

          // Create a minimal UrdfData object with at least the name
          const minimalData: UrdfData = {
            name: result.modelName,
            description:
              "A detailed 3D model of a robotic system with articulated joints and components.",
          };
          setParsedRobotData(minimalData);
        }
      } else {
        // If no Urdf, reset to default
        resetToDefaultModel();
      }

      // Call all registered callbacks
      urdfCallbacksRef.current.forEach((callback) => callback(result));
    },
    [resetToDefaultModel]
  );

  // Helper function to process the selected Urdf model
  const processSelectedUrdf = useCallback(
    async (model: UrdfFileModel) => {
      if (!urdfProcessor) return;

      // Find the file in our files record
      const files = Object.values(urdfBlobUrls)
        .filter((url) => url === model.blobUrl)
        .map((url) => {
          const path = Object.keys(urdfBlobUrls).find(
            (key) => urdfBlobUrls[key] === url
          );
          return path ? { path, url } : null;
        })
        .filter((item) => item !== null);

      if (files.length === 0) {
        console.error("❌ Could not find file for selected Urdf model");
        return;
      }

      // Show a toast notification that we're loading the Urdf
      const loadingToast = toast.loading("Loading Urdf model...", {
        description: "Preparing 3D visualization",
        duration: 5000,
      });

      try {
        // Get the file from our record
        const filePath = files[0]?.path;
        if (!filePath || !urdfBlobUrls[filePath]) {
          throw new Error("File not found in records");
        }

        // Get the actual File object
        const response = await fetch(model.blobUrl);
        const blob = await response.blob();
        const file = new File(
          [blob],
          filePath.split("/").pop() || "model.urdf",
          {
            type: "application/xml",
          }
        );

        // Read the Urdf content
        const urdfContent = await readUrdfFileContent(file);

        console.log(
          `📏 Urdf content read, length: ${urdfContent.length} characters`
        );

        // Store the Urdf content in state
        setUrdfContent(urdfContent);

        // Dismiss the toast
        toast.dismiss(loadingToast);

        // Always set isDefaultModel to false when processing a custom Urdf
        setIsDefaultModel(false);

        // Success case - create basic model data
        const modelDisplayName =
          model.name || model.path.split("/").pop() || "Unknown";

        // Create basic data structure with name and description
        const basicData: UrdfData = {
          name: modelDisplayName,
          description:
            "A detailed 3D model of a robotic system with articulated joints and components.",
        };

        // Update our state
        setCustomModelName(modelDisplayName);
        setCustomModelDescription(basicData.description);
        setParsedRobotData(basicData);

        toast.success("Urdf model loaded successfully", {
          description: `Model: ${modelDisplayName}`,
          duration: 3000,
        });

        // Notify callbacks with the basic data
        notifyUrdfCallbacks({
          hasUrdf: true,
          modelName: modelDisplayName,
          parsedData: basicData,
        });
      } catch (error) {
        // Error case
        console.error("❌ Error processing selected Urdf:", error);
        toast.dismiss(loadingToast);
        toast.error("Error loading Urdf", {
          description: `Error: ${
            error instanceof Error ? error.message : String(error)
          }`,
          duration: 3000,
        });

        // Keep showing the custom model even if loading failed
        // No need to reset to default unless user explicitly chooses to
      }
    },
    [urdfBlobUrls, urdfProcessor, notifyUrdfCallbacks]
  );

  // Function to handle selecting a Urdf model from the modal
  const selectUrdfModel = useCallback(
    (model: UrdfFileModel) => {
      if (!urdfProcessor) {
        console.error("❌ No Urdf processor available");
        return;
      }

      console.log(`🤖 Selected model: ${model.name || model.path}`);

      // Close the modal
      setIsSelectionModalOpen(false);

      // Extract model name
      const modelName =
        model.name ||
        model.path
          .split("/")
          .pop()
          ?.replace(/\.urdf$/i, "") ||
        "Unknown";

      // Load the selected Urdf model
      urdfProcessor.loadUrdf(model.blobUrl);

      // Update our state immediately even before parsing
      setIsDefaultModel(false);
      setCustomModelName(modelName);

      // Show a toast notification that we're loading the model
      toast.info(`Loading model: ${modelName}`, {
        description: "Preparing 3D visualization",
        duration: 2000,
      });

      // Notify callbacks about the selection before parsing
      notifyUrdfCallbacks({
        hasUrdf: true,
        modelName,
        parsedData: undefined, // Will use parseUrdf later to get the data
      });

      // Try to parse the model - this will update the UI when complete
      processSelectedUrdf(model);
    },
    [urdfProcessor, notifyUrdfCallbacks, processSelectedUrdf]
  );

  // Process Urdf files - moved from DragAndDropContext
  const processUrdfFiles = useCallback(
    async (files: Record<string, File>, availableModels: string[]) => {
      // Clear previous blob URLs to prevent memory leaks
      Object.values(urdfBlobUrls).forEach(URL.revokeObjectURL);
      setUrdfBlobUrls({});
      setAlternativeUrdfModels([]);
      setUrdfModelOptions([]);

      try {
        // Check if we have any Urdf files
        if (availableModels.length > 0 && urdfProcessor) {
          console.log(
            `🤖 Found ${availableModels.length} Urdf models:`,
            availableModels
          );

          // Create blob URLs for all models
          const newUrdfBlobUrls: Record<string, string> = {};
          availableModels.forEach((path) => {
            if (files[path]) {
              newUrdfBlobUrls[path] = URL.createObjectURL(files[path]);
            }
          });
          setUrdfBlobUrls(newUrdfBlobUrls);

          // Save alternative models for reference
          setAlternativeUrdfModels(availableModels);

          // Create model options for the selection modal
          const modelOptions: UrdfFileModel[] = availableModels.map((path) => {
            const fileName = path.split("/").pop() || "";
            const modelName = fileName.replace(/\.urdf$/i, "");
            return {
              path,
              blobUrl: newUrdfBlobUrls[path],
              name: modelName,
            };
          });

          setUrdfModelOptions(modelOptions);

          // If there's only one model, use it directly
          if (availableModels.length === 1) {
            // Extract model name from the Urdf file
            const fileName = availableModels[0].split("/").pop() || "";
            const modelName = fileName.replace(/\.urdf$/i, "");
            console.log(`📄 Using model: ${modelName} (${fileName})`);

            // Use the blob URL instead of the file path
            const blobUrl = newUrdfBlobUrls[availableModels[0]];
            if (blobUrl) {
              console.log(`🔗 Using blob URL for Urdf: ${blobUrl}`);
              urdfProcessor.loadUrdf(blobUrl);

              // Immediately update model state
              setIsDefaultModel(false);
              setCustomModelName(modelName);

              // Process the Urdf file for content storage
              if (files[availableModels[0]]) {
                console.log("📄 Reading Urdf content...");

                // Show a toast notification that we're loading the Urdf
                const loadingToast = toast.loading("Loading Urdf model...", {
                  description: "Preparing 3D visualization",
                  duration: 5000,
                });

                try {
                  const urdfContent = await readUrdfFileContent(
                    files[availableModels[0]]
                  );

                  console.log(
                    `📏 Urdf content read, length: ${urdfContent.length} characters`
                  );

                  // Store the Urdf content in state
                  setUrdfContent(urdfContent);

                  // Dismiss the loading toast
                  toast.dismiss(loadingToast);

                  toast.success("Urdf model loaded successfully", {
                    description: `Model: ${modelName}`,
                    duration: 3000,
                  });

                  // Create basic data structure with name and description
                  const basicData: UrdfData = {
                    name: modelName,
                    description:
                      "A detailed 3D model of a robotic system with articulated joints and components.",
                  };

                  // Update our state
                  setCustomModelDescription(basicData.description);
                  setParsedRobotData(basicData);

                  // Notify callbacks with all the information
                  notifyUrdfCallbacks({
                    hasUrdf: true,
                    modelName: modelName,
                    parsedData: basicData,
                  });
                } catch (loadError) {
                  console.error("❌ Error loading Urdf:", loadError);
                  toast.dismiss(loadingToast);
                  toast.error("Error loading Urdf", {
                    description: `Error: ${
                      loadError instanceof Error
                        ? loadError.message
                        : String(loadError)
                    }`,
                    duration: 3000,
                  });

                  // Still notify callbacks without detailed data
                  notifyUrdfCallbacks({
                    hasUrdf: true,
                    modelName,
                  });
                }
              } else {
                console.error(
                  "❌ Could not find file for Urdf model:",
                  availableModels[0]
                );
                console.log("📦 Available files:", Object.keys(files));

                // Still notify callbacks without detailed data
                notifyUrdfCallbacks({
                  hasUrdf: true,
                  modelName,
                });
              }
            } else {
              console.warn(
                `⚠️ No blob URL found for ${availableModels[0]}, using path directly`
              );
              urdfProcessor.loadUrdf(availableModels[0]);

              // Update the state even without a blob URL
              setIsDefaultModel(false);
              setCustomModelName(modelName);

              // Notify callbacks
              notifyUrdfCallbacks({
                hasUrdf: true,
                modelName,
              });
            }
          } else {
            // Multiple Urdf files found, show selection modal
            console.log(
              "📋 Multiple Urdf files found, showing selection modal"
            );
            setIsSelectionModalOpen(true);

            // Notify that Urdf files are available but selection is needed
            notifyUrdfCallbacks({
              hasUrdf: true,
              modelName: "Multiple models available",
            });
          }
        } else {
          console.warn(
            "❌ No Urdf models found in dropped files or no processor available"
          );
          notifyUrdfCallbacks({ hasUrdf: false, parsedData: null });

          // Reset to default model when no Urdf files are found
          resetToDefaultModel();

          toast.error("No Urdf file found", {
            description: "Please upload a folder containing a .urdf file.",
            duration: 3000,
          });
        }
      } catch (error) {
        console.error("❌ Error processing Urdf files:", error);
        toast.error("Error processing files", {
          description: `Error: ${
            error instanceof Error ? error.message : String(error)
          }`,
          duration: 3000,
        });

        // Reset to default model on error
        resetToDefaultModel();
      }
    },
    [notifyUrdfCallbacks, urdfBlobUrls, urdfProcessor, resetToDefaultModel]
  );

  // Clean up blob URLs when component unmounts
  React.useEffect(() => {
    return () => {
      Object.values(urdfBlobUrls).forEach(URL.revokeObjectURL);
    };
  }, [urdfBlobUrls]);

  // Create the context value
  const contextValue: UrdfContextType = {
    urdfProcessor,
    registerUrdfProcessor,
    onUrdfDetected,
    processUrdfFiles,
    urdfBlobUrls,
    alternativeUrdfModels,
    isSelectionModalOpen,
    setIsSelectionModalOpen,
    urdfModelOptions,
    selectUrdfModel,

    // New properties for centralized robot data management
    currentRobotData,
    isDefaultModel,
    setIsDefaultModel,
    parsedRobotData,
    customModelName,
    customModelDescription,
    resetToDefaultModel,
    urdfContent,

    // Animation configuration management
    currentAnimationConfig,
    setCurrentAnimationConfig,
  };

  return (
    <UrdfContext.Provider value={contextValue}>{children}</UrdfContext.Provider>
  );
};
