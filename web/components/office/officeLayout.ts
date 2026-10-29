// Office layout — desk positions, chill spots and avatar palettes.
// Ported from an earlier internal 3D office; positions come from the baked
// Office.glb chair markers. The map here is provider-agnostic: the page maps
// tmux/claude/opencode sessions to these seats (see use-office-roster.ts).

export interface DeskPosition {
  position: [number, number, number];
  rotation: number;
  zone: string;
  faceModelIndex: number;
  /** standing slots render the character on their feet, not on a chair */
  standing?: boolean;
}

export interface DynamicDeskSlot {
  position: [number, number, number];
  rotation: number;
  zone: string;
  faceModelIndexBase: number;
}

export interface ChillSpot {
  id: string;
  position: [number, number, number];
  rotation: number;
  type: 'sofa' | 'chair';
}

/** One outfit per face index (0–20 GLBs exist in this app's public dir). */
export interface AvatarPalette {
  shirt: string;
  pants: string;
  shoes: string;
  skin: string;
}

export const AVATAR_PALETTES: AvatarPalette[] = [
  { shirt: '#3a7dc9', pants: '#1e2d5a', shoes: '#1a1a1a', skin: '#f5c5a3' }, // 0
  { shirt: '#2e7d32', pants: '#37474f', shoes: '#3e2723', skin: '#f5c5a3' }, // 1
  { shirt: '#e53935', pants: '#424242', shoes: '#212121', skin: '#f5c5a3' }, // 2
  { shirt: '#f59f00', pants: '#4e342e', shoes: '#1a1a1a', skin: '#f0b87a' }, // 3
  { shirt: '#00897b', pants: '#546e7a', shoes: '#004d40', skin: '#f5c5a3' }, // 4
  { shirt: '#5c6bc0', pants: '#1a237e', shoes: '#263238', skin: '#ffe0c0' }, // 5
  { shirt: '#ef6c00', pants: '#37474f', shoes: '#1c1c1c', skin: '#f5c5a3' }, // 6
  { shirt: '#7b1fa2', pants: '#4a148c', shoes: '#212121', skin: '#f0c8a0' }, // 7
  { shirt: '#7cb342', pants: '#33691e', shoes: '#3e2723', skin: '#c68642' }, // 8
  { shirt: '#e91e8c', pants: '#616161', shoes: '#212121', skin: '#f5c5a3' }, // 9
  { shirt: '#29b6f6', pants: '#eceff1', shoes: '#90a4ae', skin: '#f5c5a3' }, // 10
  { shirt: '#f4511e', pants: '#455a64', shoes: '#1c1c1c', skin: '#d4956a' }, // 11
  { shirt: '#26c6da', pants: '#546e7a', shoes: '#263238', skin: '#f5c5a3' }, // 12
  { shirt: '#fdd835', pants: '#4e342e', shoes: '#1a1a1a', skin: '#f0b87a' }, // 13
  { shirt: '#ab47bc', pants: '#757575', shoes: '#212121', skin: '#f5c5a3' }, // 14
  { shirt: '#8d9440', pants: '#a1887f', shoes: '#5d4037', skin: '#c68642' }, // 15
  { shirt: '#c62828', pants: '#37474f', shoes: '#1c1c1c', skin: '#ffe0c0' }, // 16
  { shirt: '#1565c0', pants: '#0d1b3e', shoes: '#1a1a1a', skin: '#f5c5a3' }, // 17
  { shirt: '#66bb6a', pants: '#616161', shoes: '#3e2723', skin: '#f0c8a0' }, // 18
  { shirt: '#c2704f', pants: '#455a64', shoes: '#212121', skin: '#d4956a' }, // 19
  { shirt: '#00bcd4', pants: '#1a237e', shoes: '#1a1a1a', skin: '#f5c5a3' }, // 20
];

/** Body color by session kind — the label above each avatar uses it. */
export const KIND_3D_COLORS: Record<string, string> = {
  claude: '#d97757',
  opencode: '#7c3aed',
  service: '#0891b2',
  human: '#3b82f6',
  agent: '#7c3aed',
  // equipo de marketing de Back Office (colores de la marca)
  cmo: '#2D6BFF',
  researcher: '#14B8A6',
  creative: '#FF7A2F',
  analyst: '#8B5CF6',
  coo: '#0E7490',
};

// Desk positions — extracted from GLB chair markers (from the earlier internal office).
// Rotation: π = facing south (toward -Z), 0 = facing north (+Z).
export const DESK_POSITIONS: DeskPosition[] = [
  { position: [17.32, 0, 17.25], rotation: Math.PI, zone: 'office-ceo', faceModelIndex: 0 }, // chair-ceo
  { position: [8.29, 0, -14.44], rotation: 0, zone: 'office-cfo', faceModelIndex: 1 },
  { position: [16.6, 0, -14.44], rotation: 0, zone: 'office-cmo', faceModelIndex: 2 },
  { position: [28.92, 0, 2.09], rotation: Math.PI, zone: 'side-office', faceModelIndex: 3 },
  { position: [25.75, 0, 2.09], rotation: Math.PI, zone: 'side-office', faceModelIndex: 4 },
  { position: [28.94, 0, -2.32], rotation: 0, zone: 'side-office', faceModelIndex: 5 },
  { position: [25.74, 0, -2.32], rotation: 0, zone: 'side-office', faceModelIndex: 6 },
  { position: [28.81, 0, -3.88], rotation: Math.PI, zone: 'side-office', faceModelIndex: 7 },
  { position: [25.64, 0, -3.88], rotation: Math.PI, zone: 'side-office', faceModelIndex: 8 },
  { position: [28.94, 0, -8.26], rotation: 0, zone: 'side-office', faceModelIndex: 9 },
  { position: [25.77, 0, -8.26], rotation: 0, zone: 'side-office', faceModelIndex: 10 },
  { position: [19.71, 0, 1.96], rotation: Math.PI, zone: 'cowork', faceModelIndex: 11 },
  { position: [17.41, 0, 1.96], rotation: Math.PI, zone: 'cowork', faceModelIndex: 12 },
  { position: [15.07, 0, 1.96], rotation: Math.PI, zone: 'cowork', faceModelIndex: 13 },
  { position: [12.67, 0, 1.96], rotation: Math.PI, zone: 'cowork', faceModelIndex: 14 },
  { position: [10.25, 0, 1.96], rotation: Math.PI, zone: 'cowork', faceModelIndex: 15 },
  { position: [7.82, 0, 1.96], rotation: Math.PI, zone: 'cowork', faceModelIndex: 16 },
  { position: [19.86, 0, -2.58], rotation: 0, zone: 'cowork', faceModelIndex: 17 },
  { position: [17.41, 0, -2.58], rotation: 0, zone: 'cowork', faceModelIndex: 18 },
  { position: [15.21, 0, -2.58], rotation: 0, zone: 'cowork', faceModelIndex: 19 },
  { position: [12.76, 0, -2.58], rotation: 0, zone: 'cowork', faceModelIndex: 20 },
  { position: [10.25, 0, -2.58], rotation: 0, zone: 'cowork', faceModelIndex: 21 },
  { position: [7.88, 0, -2.58], rotation: 0, zone: 'cowork', faceModelIndex: 22 },
  { position: [27.97, 0, 6.99], rotation: Math.PI, zone: 'reception', faceModelIndex: 23 },
];

// Meeting-room overflow seats for extra sessions beyond the desk count.
export const DYNAMIC_DESK_SLOTS: DynamicDeskSlot[] = [
  { position: [27.11, 0, -11.3], rotation: Math.PI, zone: 'meeting-a', faceModelIndexBase: 24 },
  { position: [25.76, 0, -11.3], rotation: Math.PI, zone: 'meeting-a', faceModelIndexBase: 25 },
  { position: [24.36, 0, -11.3], rotation: Math.PI, zone: 'meeting-a', faceModelIndexBase: 26 },
  { position: [27.14, 0, -15.52], rotation: 0, zone: 'meeting-a', faceModelIndexBase: 27 },
  { position: [25.8, 0, -15.52], rotation: 0, zone: 'meeting-a', faceModelIndexBase: 28 },
  { position: [24.39, 0, -15.52], rotation: 0, zone: 'meeting-a', faceModelIndexBase: 29 },
];

// ─── Standing slots ──────────────────────────────────────────────────────────
// More sessions than seats: extras stand by the reception wall / lobby, on
// their feet (idle sway), like people waiting for a meeting room to free up.
// Positioned in the open lobby corridor (x 19–30, z 6–9), clear of furniture.

export const STANDING_SLOTS: DeskPosition[] = [
  { position: [22.2, 0, 7.6], rotation: Math.PI * 0.9, zone: 'lobby', faceModelIndex: 30, standing: true },
  { position: [21.2, 0, 9.4], rotation: Math.PI * 0.75, zone: 'lobby', faceModelIndex: 31, standing: true },
  { position: [23.3, 0, 9.9], rotation: Math.PI * 0.85, zone: 'lobby', faceModelIndex: 32, standing: true },
  { position: [20.4, 0, 7.7], rotation: Math.PI * 0.7, zone: 'lobby', faceModelIndex: 33, standing: true },
  { position: [24.5, 0, 7.8], rotation: Math.PI, zone: 'lobby', faceModelIndex: 34, standing: true },
  { position: [19.6, 0, 9.1], rotation: Math.PI * 0.6, zone: 'lobby', faceModelIndex: 35, standing: true },
  { position: [23.9, 0, 6.3], rotation: Math.PI * 1.1, zone: 'lobby', faceModelIndex: 36, standing: true },
  { position: [22.9, 0, 5.2], rotation: Math.PI * 1.15, zone: 'lobby', faceModelIndex: 37, standing: true },
  { position: [21.9, 0, 5.6], rotation: Math.PI * 0.95, zone: 'lobby', faceModelIndex: 38, standing: true },
  { position: [20.9, 0, 6.1], rotation: Math.PI * 0.65, zone: 'lobby', faceModelIndex: 39, standing: true },
  { position: [26.2, 0, 9.9], rotation: Math.PI * 1.2, zone: 'lobby', faceModelIndex: 40, standing: true },
  { position: [25.4, 0, 9.0], rotation: Math.PI * 1.05, zone: 'lobby', faceModelIndex: 41, standing: true },
  { position: [24.2, 0, 10.4], rotation: Math.PI * 0.8, zone: 'lobby', faceModelIndex: 42, standing: true },
  { position: [19.2, 0, 8.0], rotation: Math.PI * 0.5, zone: 'lobby', faceModelIndex: 43, standing: true },
  { position: [18.6, 0, 9.6], rotation: Math.PI * 0.55, zone: 'lobby', faceModelIndex: 44, standing: true },
  { position: [27.3, 0, 10.6], rotation: Math.PI * 1.25, zone: 'lobby', faceModelIndex: 45, standing: true },
];

// Chill spots — sofas and lounge chairs; idle/offline characters walk here.
export const CHILL_SPOTS: ChillSpot[] = [
  { id: 'chill-sofa-a', position: [8.94, 0, 11.72], rotation: 0, type: 'sofa' },
  { id: 'chill-sofa-b', position: [11.44, 0, 15.46], rotation: -Math.PI / 2, type: 'sofa' },
  { id: 'chill-chair-a', position: [6.2, 0, 14.16], rotation: Math.PI / 2, type: 'chair' },
  { id: 'chill-chair-b', position: [6.2, 0, 16.44], rotation: Math.PI / 2, type: 'chair' },
  { id: 'chill-sofa-c', position: [25.57, 0, 15.61], rotation: Math.PI / 2, type: 'sofa' },
  { id: 'chill-sofa-d', position: [25.57, 0, 12.04], rotation: Math.PI / 2, type: 'sofa' },
  { id: 'chill-sofa-e', position: [29.68, 0, 12.12], rotation: -Math.PI / 2, type: 'sofa' },
  { id: 'chill-sofa-f', position: [29.68, 0, 15.81], rotation: -Math.PI / 2, type: 'sofa' },
  { id: 'chill-sofa-g', position: [17.75, 0, 10.16], rotation: 0, type: 'sofa' },
  { id: 'chill-sofa-h', position: [20.06, 0, 11.92], rotation: -Math.PI / 2, type: 'sofa' },
];

/** How many face GLB models exist (face-00 … face-20). */
export const FACE_GLB_COUNT = 21;

export function faceModelUrl(index: number): string {
  const i = ((index % FACE_GLB_COUNT) + FACE_GLB_COUNT) % FACE_GLB_COUNT;
  return `/voxel-office/models/agents/face-${String(i).padStart(2, '0')}.glb`;
}