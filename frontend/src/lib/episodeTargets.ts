const STORAGE_KEY = "lelab-episode-targets";

type TargetMap = Record<string, number>;

function readMap(): TargetMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as TargetMap) : {};
  } catch {
    return {};
  }
}

function writeMap(map: TargetMap) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // localStorage unavailable (private mode, etc.) — targets are a comfort
    // feature, silently skip.
  }
}

export function getEpisodeTarget(repoId: string): number | null {
  const value = readMap()[repoId];
  return typeof value === "number" && value > 0 ? value : null;
}

export function setEpisodeTarget(repoId: string, target: number | null) {
  const map = readMap();
  if (target && target > 0) {
    map[repoId] = target;
  } else {
    delete map[repoId];
  }
  writeMap(map);
}
