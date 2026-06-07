import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { useApi } from "@/contexts/ApiContext";
import {
  DatasetInfo,
  SyncStatus,
  getDatasetInfo,
  getSyncStatus,
  uploadDataset,
  deleteDataset,
} from "@/lib/datasetApi";

export const useEditDataset = (repoId: string | undefined) => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { baseUrl, fetchWithHeaders } = useApi();

  const [datasetInfo, setDatasetInfo] = useState<DatasetInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [syncLoading, setSyncLoading] = useState(false);

  const [isUploading, setIsUploading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    if (!repoId) {
      toast({
        title: "No dataset selected",
        description: "Pick a dataset from the home page first.",
        variant: "destructive",
      });
      navigate("/");
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const data = await getDatasetInfo(baseUrl, fetchWithHeaders, repoId);
        if (cancelled) return;
        setDatasetInfo(data);
      } catch (error) {
        console.error("Error loading dataset info:", error);
        if (!cancelled) {
          setDatasetInfo({ dataset_repo_id: repoId });
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [repoId, baseUrl, fetchWithHeaders, navigate, toast]);

  const refreshSyncStatus = useCallback(async () => {
    if (!repoId) return;
    setSyncLoading(true);
    try {
      const data = await getSyncStatus(baseUrl, fetchWithHeaders, repoId);
      setSyncStatus(data);
    } catch (error) {
      console.error("Error loading sync status:", error);
    } finally {
      setSyncLoading(false);
    }
  }, [repoId, baseUrl, fetchWithHeaders]);

  useEffect(() => {
    refreshSyncStatus();
  }, [refreshSyncStatus]);

  const handleUploadToHub = useCallback(
    async (isPrivate: boolean) => {
      if (!datasetInfo) return;
      setIsUploading(true);
      try {
        const data = await uploadDataset(
          baseUrl,
          fetchWithHeaders,
          datasetInfo.dataset_repo_id,
          isPrivate
        );
        if (data.success) {
          toast({
            title: "Upload Successful!",
            description: `${datasetInfo.dataset_repo_id} is now on the Hugging Face Hub.`,
          });
          await refreshSyncStatus();
        } else {
          const fallback = "Failed to upload dataset to Hugging Face Hub.";
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
    },
    [datasetInfo, baseUrl, fetchWithHeaders, refreshSyncStatus, toast]
  );

  const handleDeleteDataset = useCallback(async () => {
    if (!datasetInfo) return;
    setIsDeleting(true);
    try {
      const data = await deleteDataset(
        baseUrl,
        fetchWithHeaders,
        datasetInfo.dataset_repo_id
      );
      if (data.success) {
        toast({
          title: "Dataset Deleted",
          description: `${datasetInfo.dataset_repo_id} has been removed from disk.`,
        });
        navigate("/");
      } else {
        toast({
          title: "Delete Failed",
          description: data.message || "Could not delete the dataset.",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Connection Error",
        description: "Could not connect to the backend server.",
        variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
    }
  }, [datasetInfo, baseUrl, fetchWithHeaders, navigate, toast]);

  return {
    datasetInfo,
    isLoading,
    syncStatus,
    syncLoading,
    refreshSyncStatus,
    isUploading,
    handleUploadToHub,
    isDeleting,
    handleDeleteDataset,
  };
}
