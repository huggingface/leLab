import React, {
  createContext,
  useState,
  useCallback,
  useMemo,
  ReactNode,
  useRef,
  useEffect,
} from "react";
import { toast } from "sonner";
import { UrdfProcessor, readUrdfFileContent } from "@/lib/UrdfDragAndDrop";
import { UrdfFileModel } from "@/lib/types";
import { RobotAnimationConfig } from "@/lib/types";
import { DEFAULT_URDF_PATHS, DefaultRobotType } from "@/lib/defaultUrdfModels";

// Define the result interface for Urdf detection
interface UrdfDetectionResult {
  hasUrdf: boolean;
  modelName?: string;
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

  isDefaultModel: boolean;
  setIsDefaultModel: (isDefault: boolean) => void;
  resetToDefaultModel: () => void;
  urdfContent: string | null;

  // Which built-in model to show when isDefaultModel is true. "so101" (the
  // historical default) or "omx" — set by the Teleoperation page based on the
  // connected robot's robot_type.
  defaultRobotType: "so101" | "omx";
  setDefaultRobotType: (robotType: "so101" | "omx") => void;

  currentAnimationConfig: RobotAnimationConfig | null;
  setCurrentAnimationConfig: (config: RobotAnimationConfig | null) => void;
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

  const [isDefaultModel, setIsDefaultModel] = useState(true);
  const [urdfContent, setUrdfContent] = useState<string | null>(null);
  const [defaultRobotType, setDefaultRobotType] =
    useState<DefaultRobotType>("so101");

  const [currentAnimationConfig, setCurrentAnimationConfig] =
    useState<RobotAnimationConfig | null>(null);

  // Re-fetch whenever the default model is active and either the content
  // hasn't been loaded yet or the robot type changed (switching arms).
  useEffect(() => {
    if (!isDefaultModel) return;
    let cancelled = false;
    setUrdfContent(null);
    (async () => {
      try {
        const response = await fetch(DEFAULT_URDF_PATHS[defaultRobotType]);
        if (!response.ok) {
          throw new Error(`Failed to fetch default Urdf: ${response.statusText}`);
        }
        const content = await response.text();
        if (!cancelled) setUrdfContent(content);
      } catch (error) {
        if (!cancelled) {
          console.error("Error loading default Urdf content:", error);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isDefaultModel, defaultRobotType]);

  // Reference for callbacks
  const urdfCallbacksRef = useRef<((result: UrdfDetectionResult) => void)[]>(
    []
  );

  const resetToDefaultModel = useCallback(() => {
    setIsDefaultModel(true);
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

  const notifyUrdfCallbacks = useCallback(
    (result: UrdfDetectionResult) => {
      if (result.hasUrdf) {
        setIsDefaultModel(false);
      } else {
        resetToDefaultModel();
      }
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

        const urdfContent = await readUrdfFileContent(file);

        setUrdfContent(urdfContent);

        toast.dismiss(loadingToast);

        setIsDefaultModel(false);

        const modelDisplayName =
          model.name || model.path.split("/").pop() || "Unknown";

        toast.success("Urdf model loaded successfully", {
          description: `Model: ${modelDisplayName}`,
          duration: 3000,
        });

        notifyUrdfCallbacks({
          hasUrdf: true,
          modelName: modelDisplayName,
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

      setIsSelectionModalOpen(false);

      const modelName =
        model.name ||
        model.path
          .split("/")
          .pop()
          ?.replace(/\.urdf$/i, "") ||
        "Unknown";

      urdfProcessor.loadUrdf(model.blobUrl);

      setIsDefaultModel(false);

      toast.info(`Loading model: ${modelName}`, {
        description: "Preparing 3D visualization",
        duration: 2000,
      });

      notifyUrdfCallbacks({
        hasUrdf: true,
        modelName,
      });

      processSelectedUrdf(model);
    },
    [urdfProcessor, notifyUrdfCallbacks, processSelectedUrdf]
  );

  const processUrdfFiles = useCallback(
    async (files: Record<string, File>, availableModels: string[]) => {
      Object.values(urdfBlobUrls).forEach(URL.revokeObjectURL);
      setUrdfBlobUrls({});
      setAlternativeUrdfModels([]);
      setUrdfModelOptions([]);

      try {
        if (availableModels.length > 0 && urdfProcessor) {
          const newUrdfBlobUrls: Record<string, string> = {};
          availableModels.forEach((path) => {
            if (files[path]) {
              newUrdfBlobUrls[path] = URL.createObjectURL(files[path]);
            }
          });
          setUrdfBlobUrls(newUrdfBlobUrls);

          setAlternativeUrdfModels(availableModels);

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

          if (availableModels.length === 1) {
            const fileName = availableModels[0].split("/").pop() || "";
            const modelName = fileName.replace(/\.urdf$/i, "");

            const blobUrl = newUrdfBlobUrls[availableModels[0]];
            if (blobUrl) {
              urdfProcessor.loadUrdf(blobUrl);

              setIsDefaultModel(false);

              if (files[availableModels[0]]) {
                const loadingToast = toast.loading("Loading Urdf model...", {
                  description: "Preparing 3D visualization",
                  duration: 5000,
                });

                try {
                  const urdfContent = await readUrdfFileContent(
                    files[availableModels[0]]
                  );

                  setUrdfContent(urdfContent);

                  toast.dismiss(loadingToast);

                  toast.success("Urdf model loaded successfully", {
                    description: `Model: ${modelName}`,
                    duration: 3000,
                  });

                  notifyUrdfCallbacks({
                    hasUrdf: true,
                    modelName,
                  });
                } catch (loadError) {
                  console.error("Error loading Urdf:", loadError);
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
                  "Could not find file for Urdf model:",
                  availableModels[0]
                );

                notifyUrdfCallbacks({
                  hasUrdf: true,
                  modelName,
                });
              }
            } else {
              console.warn(
                `No blob URL found for ${availableModels[0]}, using path directly`
              );
              urdfProcessor.loadUrdf(availableModels[0]);

              setIsDefaultModel(false);

              notifyUrdfCallbacks({
                hasUrdf: true,
                modelName,
              });
            }
          } else {
            setIsSelectionModalOpen(true);

            notifyUrdfCallbacks({
              hasUrdf: true,
              modelName: "Multiple models available",
            });
          }
        } else {
          notifyUrdfCallbacks({ hasUrdf: false });

          resetToDefaultModel();

          toast.error("No Urdf file found", {
            description: "Please upload a folder containing a .urdf file.",
            duration: 3000,
          });
        }
      } catch (error) {
        console.error("Error processing Urdf files:", error);
        toast.error("Error processing files", {
          description: `Error: ${
            error instanceof Error ? error.message : String(error)
          }`,
          duration: 3000,
        });

        resetToDefaultModel();
      }
    },
    [notifyUrdfCallbacks, urdfBlobUrls, urdfProcessor, resetToDefaultModel]
  );

  // Revoke blob URLs only on unmount; ref tracks the latest set so we
  // don't re-revoke on every state change.
  const blobUrlsRef = useRef(urdfBlobUrls);
  blobUrlsRef.current = urdfBlobUrls;
  useEffect(() => {
    return () => {
      Object.values(blobUrlsRef.current).forEach(URL.revokeObjectURL);
    };
  }, []);

  const contextValue = useMemo<UrdfContextType>(
    () => ({
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

      isDefaultModel,
      setIsDefaultModel,
      resetToDefaultModel,
      urdfContent,
      defaultRobotType,
      setDefaultRobotType,

      currentAnimationConfig,
      setCurrentAnimationConfig,
    }),
    [
      urdfProcessor,
      registerUrdfProcessor,
      onUrdfDetected,
      processUrdfFiles,
      urdfBlobUrls,
      alternativeUrdfModels,
      isSelectionModalOpen,
      urdfModelOptions,
      selectUrdfModel,
      isDefaultModel,
      resetToDefaultModel,
      urdfContent,
      defaultRobotType,
      currentAnimationConfig,
    ]
  );

  return (
    <UrdfContext.Provider value={contextValue}>{children}</UrdfContext.Provider>
  );
};
