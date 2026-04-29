import { useQuery } from "@tanstack/react-query";
import { UrdfData } from "@/lib/types";

/**
 * Fetches default robot data from a JSON file
 * @param robotName The name of the robot folder (e.g., 'T12')
 */
async function fetchRobotData(robotName: string): Promise<UrdfData> {
  const response = await fetch(`/so-101-urdf/urdf/so101_new_calib.urdf`);

  if (!response.ok) {
    throw new Error(`Failed to fetch default robot data for ${robotName}`);
  }

  return await response.json();
}

/**
 * Hook to fetch default robot model data from a JSON file using React Query
 * @param robotName The name of the robot folder (e.g., 'T12')
 * @returns The robot data query result
 */
export function useDefaultRobotData(robotName: string = "so101") {
  return useQuery({
    queryKey: ["defaultRobotData", robotName],
    queryFn: () => fetchRobotData(robotName),
    staleTime: 1000 * 60 * 5, // Consider data fresh for 5 minutes
    retry: 2, // Retry failed requests twice
  });
}

/**
 * Function to load default robot data for use outside React components
 * @param robotName The name of the robot folder (e.g., 'T12')
 * @returns A promise that resolves to the robot data or null if loading fails
 */
export async function loadDefaultRobotData(
  robotName: string = "so101"
): Promise<UrdfData | null> {
  try {
    return await fetchRobotData(robotName);
  } catch (err) {
    console.error(`Error loading default robot data for ${robotName}:`, err);
    return null;
  }
}

export default useDefaultRobotData;
