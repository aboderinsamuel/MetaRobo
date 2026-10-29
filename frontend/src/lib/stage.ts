// Colours for the 3D stages (Control Lab and the AI studio), matched to each theme's palette so the
// canvas never stays dark in light mode.
export const STAGE = {
  // Matches the light UI's canvas: soft grey, not white, so the scene doesn't glare.
  light: { bg: "#dcdee2", cell: "#cbced4", section: "#b9bdc5", sky: "#f1f1f3", ground: "#b6b9c0", hemi: 0.8, shadow: 0.2 },
  dark: { bg: "#161616", cell: "#232323", section: "#303030", sky: "#d8dcff", ground: "#101010", hemi: 0.6, shadow: 0.42 },
} as const;
