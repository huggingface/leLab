import {
  LoadingManager,
  Object3D,
  PerspectiveCamera,
  Vector3,
  Color,
  AmbientLight,
  DirectionalLight,
  GridHelper,
  Scene,
} from "three";
import { toast } from "@/components/ui/sonner";
import { loadMeshFile } from "./meshLoaders";

// Define the interface for the URDF viewer element
export interface URDFViewerElement extends HTMLElement {
  setJointValue: (joint: string, value: number) => void;
  loadMeshFunc?: (
    path: string,
    manager: LoadingManager,
    done: (result: Object3D | null, err?: Error) => void
  ) => void;

  // Extended properties for camera fitting
  camera: PerspectiveCamera;
  controls: {
    target: Vector3;
    update: () => void;
  };
  robot: Object3D;
  redraw: () => void;
  up: string;
  scene: Scene;
}

/** Object3D.name of the ground grid added in createUrdfViewer, for lookup by fitGridToRobot. */
export const FLOOR_GRID_NAME = "leLab-floor-grid";

/**
 * Creates and configures a URDF viewer element
 */
export function createUrdfViewer(
  container: HTMLDivElement,
  isDarkMode: boolean
): URDFViewerElement {
  // Clear any existing content
  container.innerHTML = "";

  // Create the urdf-viewer element
  const viewer = document.createElement("urdf-viewer") as URDFViewerElement;
  viewer.classList.add("w-full", "h-full");

  // Add the element to the container
  container.appendChild(viewer);

  // Set initial viewer properties
  viewer.setAttribute("up", "Z");
  setViewerColor(viewer, isDarkMode ? "#2c2b3a" : "#eff4ff");
  viewer.setAttribute("highlight-color", isDarkMode ? "#df6dd4" : "#b05ffe");
  viewer.setAttribute("auto-redraw", "true");
  // viewer.setAttribute("display-shadow", ""); // Enable shadows

  // Add ambient light to the scene
  const ambientLight = new AmbientLight(0xd6d6d6, 1); // Increased intensity to 0.4
  viewer.scene.add(ambientLight);

  // Add directional light for better shadows and depth
  const directionalLight = new DirectionalLight(0xffffff, 0.8);
  directionalLight.position.set(5, 30, 5);
  directionalLight.castShadow = true;
  viewer.scene.add(directionalLight);

  // Ground grid, for a sense of scale and distance while teleoperating.
  // Added directly to `scene` (not `world`), which stays in three.js's
  // native Y-up frame regardless of the URDF's own up axis — `_setUp` on the
  // viewer element compensates for that by rotating `world` instead, so a
  // GridHelper here (built flat in the XZ plane) needs no rotation of its
  // own to lie under the robot. Sized to a 1x1 unit placeholder at creation;
  // `fitGridToRobot` rescales and repositions it once a model's bounding box
  // is known, since that can be any real-world unit depending on the URDF.
  const grid = new GridHelper(1, 10, 0x6b6b7a, 0x44424f);
  grid.name = FLOOR_GRID_NAME;
  viewer.scene.add(grid);

  // Camera position is no longer adjusted automatically to prevent auto-zooming.
  // The user can control the view with the mouse.

  return viewer;
}

/**
 * Rescale and reposition the ground grid to sit under a newly-loaded robot.
 *
 * The grid is built at a fixed 1x1 size since createUrdfViewer runs before
 * any model exists, so it has no sense of the URDF's unit scale — this call
 * (made once the robot's bounding box is known, alongside the existing
 * camera auto-fit) is what actually sizes it. `center`/`minY`/`maxDim` are
 * passed in rather than recomputed so callers that already have a bounding
 * box (fitRobotToView) don't compute it twice.
 */
export function fitGridToRobot(
  viewer: URDFViewerElement,
  center: Vector3,
  minY: number,
  maxDim: number
): void {
  const grid = viewer.scene.getObjectByName(FLOOR_GRID_NAME);
  if (!grid) return;

  // Framed a few grid-widths wider than the robot so it reads as a floor
  // rather than a tight box drawn around the model.
  const size = Math.max(maxDim * 4, 0.01);
  grid.scale.setScalar(size);
  // A hair below the robot's lowest point avoids z-fighting with anything
  // (a gripper, a mounting plate) that sits flush with its own base.
  grid.position.set(center.x, minY - size * 0.001, center.z);
}

/**
 * Setup mesh loading function for URDF viewer
 */
export function setupMeshLoader(
  viewer: URDFViewerElement,
  urlModifierFunc: ((url: string) => string) | null
): void {
  if ("loadMeshFunc" in viewer) {
    viewer.loadMeshFunc = (
      path: string,
      manager: LoadingManager,
      done: (result: Object3D | null, err?: Error) => void
    ) => {
      // Apply URL modifier if available (for custom uploads)
      const modifiedPath = urlModifierFunc ? urlModifierFunc(path) : path;

      // If loading fails, log the error but continue
      try {
        loadMeshFile(modifiedPath, manager, (result, err) => {
          if (err) {
            console.warn(`Error loading mesh ${modifiedPath}:`, err);
            // Try to continue with other meshes
            done(null);
          } else {
            done(result);
          }
        });
      } catch (err) {
        console.error(`Exception loading mesh ${modifiedPath}:`, err);
        done(null, err as Error);
      }
    };
  }
}

/**
 * Setup event handlers for joint highlighting
 */
export function setupJointHighlighting(
  viewer: URDFViewerElement,
  setHighlightedJoint: (joint: string | null) => void
): () => void {
  const onJointMouseover = (e: Event) => {
    const customEvent = e as CustomEvent;
    setHighlightedJoint(customEvent.detail);
  };

  const onJointMouseout = () => {
    setHighlightedJoint(null);
  };

  // Add event listeners
  viewer.addEventListener("joint-mouseover", onJointMouseover);
  viewer.addEventListener("joint-mouseout", onJointMouseout);

  // Return cleanup function
  return () => {
    viewer.removeEventListener("joint-mouseover", onJointMouseover);
    viewer.removeEventListener("joint-mouseout", onJointMouseout);
  };
}

/**
 * Setup model loading and error handling
 */
export function setupModelLoading(
  viewer: URDFViewerElement,
  urdfPath: string,
  packagePath: string,
  setCustomUrdfPath: (path: string) => void,
  alternativeRobotModels: string[] = [] // Add parameter for alternative models
): () => void {
  // Add XML content type hint for blob URLs
  const loadPath =
    urdfPath.startsWith("blob:") && !urdfPath.includes("#.")
      ? urdfPath + "#.urdf" // Add extension hint if it's a blob URL
      : urdfPath;

  // Set the URDF path
  viewer.setAttribute("urdf", loadPath);
  viewer.setAttribute("package", packagePath);

  // Handle error loading
  const onLoadError = () => {
    // toast.error("Failed to load model", {
    //   description: "There was an error loading the URDF model.",
    //   duration: 3000,
    // });

    // Use the provided alternativeRobotModels instead of the global window object
    if (alternativeRobotModels.length > 0) {
      const nextModel = alternativeRobotModels[0];
      if (nextModel) {
        setCustomUrdfPath(nextModel);
        toast.info("Trying alternative model...", {
          description: `First model failed to load. Trying ${
            nextModel.split("/").pop() || "alternative model"
          }`,
          duration: 2000,
        });
      }
    }
  };

  viewer.addEventListener("error", onLoadError);
  // The 'urdf-processed' event that handled auto-zooming has been removed.

  // Return cleanup function
  return () => {
    viewer.removeEventListener("error", onLoadError);
  };
}

/**
 * Sets the background color of the URDF viewer
 */
export function setViewerColor(viewer: URDFViewerElement, color: string): void {
  // Set the ambient color for the scene
  // viewer.setAttribute("ambient-color", color);

  // Set the background color on the viewer's parent container
  const container = viewer.parentElement;
  if (container) {
    container.style.backgroundColor = color;
  }
}

/**
 * Updates the viewer's colors based on the current theme
 */
export function updateViewerTheme(
  viewer: URDFViewerElement,
  isDarkMode: boolean
): void {
  // Update the ambient color
  setViewerColor(viewer, isDarkMode ? "#2c2b3a" : "#eff4ff");
  viewer.setAttribute("highlight-color", isDarkMode ? "#df6dd4" : "#b05ffe");

  // // Update the ambient light intensity based on theme
  // viewer.scene.traverse((object) => {
  //   if (object instanceof AmbientLight) {
  //     object.intensity = isDarkMode ? 0.4 : 0.6; // Brighter in light mode
  //   }
  // });
}
