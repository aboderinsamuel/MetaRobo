// Physically based materials for generated designs: each preset is tuned like a real surface
// (anodised aluminium, soft-touch plastic, silicone skin, woven carbon, fabric with sheen), with
// small procedural textures where the real thing has visible structure. Cached per colour.
import * as THREE from "three";
import type { MaterialKind } from "./design";

const cache = new Map<string, THREE.Material>();
const textures = new Map<string, THREE.Texture>();

function canvasTexture(key: string, size: number, draw: (g: CanvasRenderingContext2D, s: number) => void, repeat: number): THREE.Texture | null {
  if (typeof document === "undefined") return null;
  const hit = textures.get(key);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  draw(c.getContext("2d")!, size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 4;
  textures.set(key, t);
  return t;
}

/** 2×2 twill weave as a bump map. */
const carbonBump = () =>
  canvasTexture(
    "carbon",
    64,
    (g, s) => {
      const q = s / 4;
      for (let i = 0; i < 4; i++)
        for (let j = 0; j < 4; j++) {
          const grad = (i + j) % 4 < 2 ? g.createLinearGradient(i * q, 0, i * q + q, 0) : g.createLinearGradient(0, j * q, 0, j * q + q);
          grad.addColorStop(0, "#333");
          grad.addColorStop(0.5, "#ddd");
          grad.addColorStop(1, "#333");
          g.fillStyle = grad;
          g.fillRect(i * q, j * q, q, q);
        }
    },
    24,
  );

/** Fine brushed lines for machined aluminium. */
const brushedBump = () =>
  canvasTexture(
    "brushed",
    256,
    (g, s) => {
      g.fillStyle = "#808080";
      g.fillRect(0, 0, s, s);
      for (let y = 0; y < s; y++) {
        g.fillStyle = `rgba(${Math.random() < 0.5 ? "255,255,255" : "0,0,0"},${Math.random() * 0.12})`;
        g.fillRect(0, y, s, 1);
      }
    },
    3,
  );

/** Woven fabric. */
const fabricBump = () =>
  canvasTexture(
    "fabric",
    64,
    (g, s) => {
      g.fillStyle = "#777";
      g.fillRect(0, 0, s, s);
      for (let i = 0; i < s; i += 4) {
        g.fillStyle = "rgba(255,255,255,0.35)";
        g.fillRect(i, 0, 2, s);
        g.fillStyle = "rgba(0,0,0,0.25)";
        g.fillRect(0, i, s, 2);
      }
    },
    40,
  );

/** Wood grain. */
const woodMap = (color: string) =>
  canvasTexture(
    `wood${color}`,
    256,
    (g, s) => {
      const base = new THREE.Color(color);
      for (let y = 0; y < s; y++) {
        const k = 0.82 + 0.18 * Math.sin(y * 0.18 + Math.sin(y * 0.031) * 6) + (Math.random() - 0.5) * 0.05;
        g.fillStyle = `#${base.clone().multiplyScalar(k).getHexString()}`;
        g.fillRect(0, y, s, 1);
      }
    },
    2,
  );

export function materialFor(kind: MaterialKind, color: string): THREE.Material {
  const key = `${kind}|${color}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const c = new THREE.Color(color);
  let m: THREE.Material;
  switch (kind) {
    case "brushed_aluminium":
      m = new THREE.MeshPhysicalMaterial({ color: c, metalness: 1, roughness: 0.32, bumpMap: brushedBump(), bumpScale: 0.15, anisotropy: 0.6 });
      break;
    case "anodized_aluminium":
      m = new THREE.MeshPhysicalMaterial({ color: c, metalness: 0.85, roughness: 0.38, clearcoat: 0.3, clearcoatRoughness: 0.4 });
      break;
    case "painted_metal":
      m = new THREE.MeshPhysicalMaterial({ color: c, metalness: 0.25, roughness: 0.42, clearcoat: 0.7, clearcoatRoughness: 0.2 });
      break;
    case "chrome":
      m = new THREE.MeshPhysicalMaterial({ color: c, metalness: 1, roughness: 0.06 });
      break;
    case "steel":
      m = new THREE.MeshPhysicalMaterial({ color: c, metalness: 1, roughness: 0.42 });
      break;
    case "matte_plastic":
      m = new THREE.MeshPhysicalMaterial({ color: c, metalness: 0, roughness: 0.62, clearcoat: 0.08 });
      break;
    case "gloss_plastic":
      m = new THREE.MeshPhysicalMaterial({ color: c, metalness: 0, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.08 });
      break;
    case "soft_touch":
      m = new THREE.MeshPhysicalMaterial({ color: c, metalness: 0, roughness: 0.88, sheen: 0.25, sheenColor: c.clone().lerp(new THREE.Color("#ffffff"), 0.4) });
      break;
    case "rubber":
      m = new THREE.MeshPhysicalMaterial({ color: c, metalness: 0, roughness: 0.95 });
      break;
    case "silicone_skin":
      m = new THREE.MeshPhysicalMaterial({ color: c, metalness: 0, roughness: 0.5, sheen: 0.6, sheenRoughness: 0.5, sheenColor: c.clone().lerp(new THREE.Color("#ffffff"), 0.5), clearcoat: 0.2, clearcoatRoughness: 0.6 });
      break;
    case "carbon_fiber":
      m = new THREE.MeshPhysicalMaterial({ color: c, metalness: 0.3, roughness: 0.38, bumpMap: carbonBump(), bumpScale: 0.6, clearcoat: 1, clearcoatRoughness: 0.05 });
      break;
    case "glass":
      m = new THREE.MeshPhysicalMaterial({ color: c, metalness: 0, roughness: 0.04, transmission: 0.92, thickness: 0.01, ior: 1.5, transparent: true });
      break;
    case "screen":
      m = new THREE.MeshPhysicalMaterial({ color: "#05070a", metalness: 0.1, roughness: 0.08, clearcoat: 1, emissive: c, emissiveIntensity: 0.9 });
      break;
    case "emissive":
      m = new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 2.2, toneMapped: false });
      break;
    case "fabric":
      m = new THREE.MeshPhysicalMaterial({ color: c, metalness: 0, roughness: 0.95, sheen: 1, sheenRoughness: 0.8, sheenColor: c.clone().lerp(new THREE.Color("#ffffff"), 0.3), bumpMap: fabricBump(), bumpScale: 0.4, side: THREE.DoubleSide });
      break;
    case "wood":
      m = new THREE.MeshPhysicalMaterial({ color: "#ffffff", map: woodMap(color), metalness: 0, roughness: 0.6, clearcoat: 0.3 });
      break;
    case "ceramic":
      m = new THREE.MeshPhysicalMaterial({ color: c, metalness: 0, roughness: 0.18, clearcoat: 0.9 });
      break;
    case "foam":
      m = new THREE.MeshPhysicalMaterial({ color: c, metalness: 0, roughness: 1 });
      break;
  }
  cache.set(key, m);
  return m;
}
