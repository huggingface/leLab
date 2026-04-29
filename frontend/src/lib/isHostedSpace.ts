export const isHostedSpace = (): boolean =>
  typeof window !== "undefined" &&
  window.location.hostname.endsWith(".hf.space");
