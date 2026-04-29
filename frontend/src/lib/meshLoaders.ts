import {
  LoadingManager,
  MeshPhongMaterial,
  Mesh,
  Color,
  Object3D,
  Group,
  BoxGeometry,
} from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { ColladaLoader } from "three/examples/jsm/loaders/ColladaLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";

/**
 * Loads mesh files of different formats
 * @param path The path to the mesh file
 * @param manager The THREE.js loading manager
 * @param done Callback function when loading is complete
 */
export const loadMeshFile = (
  path: string,
  manager: LoadingManager,
  done: (result: Object3D | Group | Mesh | null, err?: Error) => void
) => {
  // First try to get extension from the original path
  let ext = path.split(/\./g).pop()?.toLowerCase();

  // If the URL is a blob URL with a fragment containing the extension, use that
  if (path.startsWith("blob:") && path.includes("#.")) {
    const fragmentExt = path.split("#.").pop();
    if (fragmentExt) {
      ext = fragmentExt.toLowerCase();
    }
  }

  // If we can't determine extension, try to check Content-Type
  if (!ext) {
    console.error(`Could not determine file extension for: ${path}`);
    done(null, new Error(`Unsupported file format: ${path}`));
    return;
  }

  switch (ext) {
    case "gltf":
    case "glb":
      new GLTFLoader(manager).load(
        path,
        (result) => done(result.scene),
        null,
        (err) => done(null, err as Error)
      );
      break;
    case "obj":
      new OBJLoader(manager).load(
        path,
        (result) => done(result),
        null,
        (err) => done(null, err as Error)
      );
      break;
    case "dae":
      new ColladaLoader(manager).load(
        path,
        (result) => done(result.scene),
        null,
        (err) => done(null, err as Error)
      );
      break;
    case "stl":
      console.log(`🔧 Loading STL file: ${path}`);
      new STLLoader(manager).load(
        path,
        (result) => {
          console.log(`✅ STL loaded successfully: ${path}`);
          const material = new MeshPhongMaterial();
          const mesh = new Mesh(result, material);
          done(mesh);
        },
        (progress) => {
          console.log(`📊 STL loading progress: ${path}`, progress);
        },
        (err) => {
          console.error(`❌ STL loading failed: ${path}`, err);

          // Create a fallback basic geometry when STL fails to load
          console.log(`🔄 Creating fallback geometry for: ${path}`);
          const fallbackGeometry = new BoxGeometry(0.05, 0.05, 0.05); // Small 5cm cube
          const fallbackMaterial = new MeshPhongMaterial({
            color: 0xff6b35, // Orange color to indicate it's a fallback
            transparent: true,
            opacity: 0.7,
          });
          const fallbackMesh = new Mesh(fallbackGeometry, fallbackMaterial);
          done(fallbackMesh);
        }
      );
      break;
    default:
      done(null, new Error(`Unsupported file format: ${ext}`));
  }
};

/**
 * Creates a color in THREE.js format from a CSS color string
 * @param color The CSS color string
 * @returns A THREE.js Color
 */
export const createColor = (color: string): Color => {
  return new Color(color);
};
