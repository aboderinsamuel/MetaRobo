// Colours for the 3D stages (Control Lab and the AI studio), matched to each theme's palette so the
// canvas never stays dark in light mode.
export const STAGE = {
  light: { bg: "#eceef2", cell: "#d5d8de", section: "#c2c6ce", sky: "#ffffff", ground: "#c9ccd2", hemi: 0.95, shadow: 0.16 },
  dark: { bg: "#161616", cell: "#232323", section: "#303030", sky: "#d8dcff", ground: "#101010", hemi: 0.6, shadow: 0.42 },
} as const;
