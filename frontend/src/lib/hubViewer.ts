/** Open a Hub dataset in the visualize_dataset Space (private ones go through the login redirect). */
export const openHubViewer = (repoId: string, isPrivate: boolean) => {
  const spacePath = `/spaces/lerobot/visualize_dataset?path=${encodeURIComponent(`/${repoId}`)}`;
  const target = isPrivate
    ? `https://huggingface.co/login?next=${encodeURIComponent(spacePath)}`
    : `https://huggingface.co${spacePath}`;
  window.open(target, "_blank", "noopener,noreferrer");
};
