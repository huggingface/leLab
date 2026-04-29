import React, { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ArrowLeft,
  Upload as UploadIcon,
  Database,
  Tag,
  Eye,
  EyeOff,
  ExternalLink,
  CheckCircle,
  AlertCircle,
  Loader2,
} from "lucide-react";
import { useApi } from "@/contexts/ApiContext";

interface DatasetInfo {
  dataset_repo_id: string;
  single_task: string;
  num_episodes: number;
  saved_episodes?: number;
  session_elapsed_seconds?: number;
  fps?: number;
  total_frames?: number;
  robot_type?: string;
}

interface UploadConfig {
  tags: string[];
  private: boolean;
}

const Upload = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { baseUrl, fetchWithHeaders } = useApi();

  // Get initial dataset info from navigation state
  const initialDatasetInfo = location.state?.datasetInfo as DatasetInfo;

  // State for actual dataset info (will be loaded from backend)
  const [datasetInfo, setDatasetInfo] = useState<DatasetInfo | null>(null);
  const [isLoadingDatasetInfo, setIsLoadingDatasetInfo] = useState(true);

  // Upload configuration state
  const [uploadConfig, setUploadConfig] = useState<UploadConfig>({
    tags: ["robotics", "lerobot"],
    private: false,
  });

  const [tagsInput, setTagsInput] = useState(uploadConfig.tags.join(", "));
  const [isUploading, setIsUploading] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(false);

  // Load actual dataset information from backend
  React.useEffect(() => {
    const loadDatasetInfo = async () => {
      if (!initialDatasetInfo?.dataset_repo_id) {
        toast({
          title: "No Dataset Information",
          description: "Please complete a recording session first.",
          variant: "destructive",
        });
        navigate("/");
        return;
      }

      try {
        const response = await fetchWithHeaders(`${baseUrl}/dataset-info`, {
          method: "POST",
          body: JSON.stringify({
            dataset_repo_id: initialDatasetInfo.dataset_repo_id,
          }),
        });

        const data = await response.json();

        if (response.ok && data.success) {
          // Merge the loaded dataset info with any session info we have
          setDatasetInfo({
            ...data,
            saved_episodes: data.num_episodes, // Use actual episodes from dataset
            session_elapsed_seconds:
              initialDatasetInfo.session_elapsed_seconds || 0,
          });
        } else {
          // Fallback to initial dataset info if backend fails
          toast({
            title: "Warning",
            description:
              "Could not load complete dataset information. Using session data.",
            variant: "destructive",
          });
          setDatasetInfo(initialDatasetInfo);
        }
      } catch (error) {
        console.error("Error loading dataset info:", error);
        // Fallback to initial dataset info
        toast({
          title: "Warning",
          description: "Could not connect to backend. Using session data.",
          variant: "destructive",
        });
        setDatasetInfo(initialDatasetInfo);
      } finally {
        setIsLoadingDatasetInfo(false);
      }
    };

    loadDatasetInfo();
  }, [initialDatasetInfo, navigate, toast]);

  const formatDuration = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
      return `${hours}h ${minutes}m ${secs}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${secs}s`;
    } else {
      return `${secs}s`;
    }
  };

  const handleUploadToHub = async () => {
    if (!datasetInfo) return;

    setIsUploading(true);
    try {
      // Parse tags from input
      const tags = tagsInput
        .split(",")
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0);

      const response = await fetchWithHeaders(`${baseUrl}/upload-dataset`, {
        method: "POST",
        body: JSON.stringify({
          dataset_repo_id: datasetInfo.dataset_repo_id,
          tags,
          private: uploadConfig.private,
        }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        setUploadSuccess(true);
        toast({
          title: "Upload Successful!",
          description: `Dataset ${datasetInfo.dataset_repo_id} has been uploaded to HuggingFace Hub.`,
        });
      } else {
        const fallback = "Failed to upload dataset to HuggingFace Hub.";
        toast({
          title: "Upload Failed",
          description: data.docs_url ? (
            <span>
              {data.message || fallback}{" "}
              <a
                href={data.docs_url}
                target="_blank"
                rel="noopener noreferrer"
                className="underline font-medium"
              >
                Open setup guide
              </a>
            </span>
          ) : (
            data.message || fallback
          ),
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Error uploading dataset:", error);
      toast({
        title: "Connection Error",
        description: "Could not connect to the backend server.",
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
    }
  };

  const handleSkipUpload = () => {
    toast({
      title: "Upload Skipped",
      description: "Dataset saved locally. You can upload it manually later.",
    });
    navigate("/");
  };

  // Show loading state while fetching dataset info
  if (isLoadingDatasetInfo || !datasetInfo) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-lg">Loading dataset information...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white p-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <Button
            onClick={() => navigate("/")}
            variant="outline"
            className="border-gray-500 hover:border-gray-200 text-gray-300 hover:text-white"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Home
          </Button>

          <div className="flex items-center gap-3">
            {uploadSuccess ? (
              <CheckCircle className="w-8 h-8 text-green-500" />
            ) : (
              <Database className="w-8 h-8 text-blue-500" />
            )}
            <h1 className="text-3xl font-bold">
              {uploadSuccess ? "Upload Complete" : "Dataset Upload"}
            </h1>
          </div>
        </div>

        {/* Success State */}
        {uploadSuccess && (
          <div className="bg-green-900/20 border border-green-600 rounded-lg p-6 mb-8">
            <div className="flex items-center gap-3 mb-4">
              <CheckCircle className="w-6 h-6 text-green-500" />
              <h2 className="text-xl font-semibold text-green-400">
                Successfully Uploaded!
              </h2>
            </div>
            <p className="text-gray-300 mb-4">
              Your dataset has been uploaded to HuggingFace Hub and is now
              available for training and sharing.
            </p>
            <div className="flex flex-col sm:flex-row gap-4">
              <Button
                onClick={() =>
                  window.open(
                    `https://huggingface.co/datasets/${datasetInfo.dataset_repo_id}`,
                    "_blank"
                  )
                }
                className="bg-blue-500 hover:bg-blue-600 text-white"
              >
                <ExternalLink className="w-4 h-4 mr-2" />
                View on HuggingFace Hub
              </Button>
              <Button
                onClick={() =>
                  navigate("/training", {
                    state: { datasetRepoId: datasetInfo.dataset_repo_id },
                  })
                }
                className="bg-purple-500 hover:bg-purple-600 text-white"
              >
                Start Training
              </Button>
              <Button
                onClick={() => navigate("/")}
                variant="outline"
                className="border-gray-600 text-gray-300 hover:bg-gray-800 hover:text-white"
              >
                Return to Home
              </Button>
            </div>
          </div>
        )}

        {/* Upload Form */}
        {!uploadSuccess && (
          <>
            {/* Dataset Summary */}
            <div className="bg-gray-900 rounded-lg p-6 border border-gray-700 mb-8">
              <h2 className="text-xl font-semibold text-white mb-4">
                Dataset Summary
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-3">
                  <div>
                    <span className="text-gray-400">Repository ID:</span>
                    <p className="text-white font-mono text-lg">
                      {datasetInfo.dataset_repo_id}
                    </p>
                  </div>
                  <div>
                    <span className="text-gray-400">Task:</span>
                    <p className="text-white">{datasetInfo.single_task}</p>
                  </div>
                </div>
                <div className="space-y-3">
                  <div>
                    <span className="text-gray-400">Episodes Recorded:</span>
                    <p className="text-white text-2xl font-bold text-green-400">
                      {datasetInfo.saved_episodes || datasetInfo.num_episodes}
                    </p>
                    {datasetInfo.total_frames && (
                      <p className="text-gray-400 text-sm">
                        {datasetInfo.total_frames} total frames
                      </p>
                    )}
                  </div>
                  <div>
                    <span className="text-gray-400">Session Duration:</span>
                    <p className="text-white">
                      {formatDuration(datasetInfo.session_elapsed_seconds || 0)}
                    </p>
                    {datasetInfo.fps && (
                      <p className="text-gray-400 text-sm">
                        {datasetInfo.fps} FPS
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Upload Configuration */}
            <div className="bg-gray-900 rounded-lg p-6 border border-gray-700 mb-8">
              <h2 className="text-xl font-semibold text-white mb-6">
                Upload Configuration
              </h2>

              <div className="space-y-6">
                {/* Tags */}
                <div>
                  <Label htmlFor="tags" className="text-gray-300 mb-2 block">
                    Tags (comma-separated)
                  </Label>
                  <Input
                    id="tags"
                    value={tagsInput}
                    onChange={(e) => setTagsInput(e.target.value)}
                    placeholder="robotics, lerobot, manipulation"
                    className="bg-gray-800 border-gray-600 text-white"
                  />
                  <p className="text-sm text-gray-500 mt-1">
                    Tags help others discover your dataset on HuggingFace Hub
                  </p>
                </div>

                {/* Privacy Setting */}
                <div className="flex items-center space-x-3">
                  <Checkbox
                    id="private"
                    checked={uploadConfig.private}
                    onCheckedChange={(checked) =>
                      setUploadConfig({
                        ...uploadConfig,
                        private: checked as boolean,
                      })
                    }
                  />
                  <div className="flex items-center gap-2">
                    {uploadConfig.private ? (
                      <EyeOff className="w-4 h-4 text-gray-400" />
                    ) : (
                      <Eye className="w-4 h-4 text-gray-400" />
                    )}
                    <Label htmlFor="private" className="text-gray-300">
                      Make dataset private
                    </Label>
                  </div>
                </div>
                <p className="text-sm text-gray-500 ml-6">
                  {uploadConfig.private
                    ? "Only you will be able to access this dataset"
                    : "Dataset will be publicly accessible on HuggingFace Hub"}
                </p>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Button
                onClick={handleUploadToHub}
                disabled={isUploading}
                className="bg-blue-500 hover:bg-blue-600 text-white font-semibold py-4 px-8 text-lg"
              >
                {isUploading ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    Uploading to Hub...
                  </>
                ) : (
                  <>
                    <UploadIcon className="w-5 h-5 mr-2" />
                    Upload to HuggingFace Hub
                  </>
                )}
              </Button>

              <Button
                onClick={handleSkipUpload}
                disabled={isUploading}
                variant="outline"
                className="border-gray-600 text-gray-300 hover:bg-gray-800 hover:text-white py-4 px-8 text-lg"
              >
                Skip Upload
              </Button>
            </div>

            {/* Info Box */}
            <div className="mt-8 p-4 bg-blue-900/20 border border-blue-600 rounded-lg">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-blue-400 mt-0.5" />
                <div>
                  <h3 className="font-semibold text-blue-400 mb-2">
                    About HuggingFace Hub Upload
                  </h3>
                  <ul className="text-sm text-gray-300 space-y-1">
                    <li>
                      • Your dataset will be uploaded to HuggingFace Hub for
                      sharing and collaboration
                    </li>
                    <li>
                      • You need to be logged in to HuggingFace CLI on the
                      server
                    </li>
                    <li>
                      • Uploaded datasets can be used for training models and
                      sharing with the community
                    </li>
                    <li>
                      • You can always upload manually later using the
                      HuggingFace CLI
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default Upload;
