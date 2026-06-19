// Scene-graph color/material config per visual style.
// Chrome (panels, labels, buttons) is themed in CSS via [data-theme].

export const THEMES = {
  parchment: {
    name: "Parchemin",
    canvasBg: null, // CSS gradient shows through (transparent canvas)
    fog: { color: 0xe9e2d2, near: 38, far: 110 },
    branch: { color: 0x7a6a52, opacity: 0.34, width: 1 },
    glow: { opacity: 0.16, size: 1.0, blend: "normal" },
    file: {
      size: 0.46,
      opacity: 0.95,
      blend: "normal",
      minPx: 2,
      maxPx: 22,
      dim: 0x9c9486,
    },
    palette: [
      0x4a7fb5, 0x7d5bbf, 0x96892f, 0xc66e36, 0x3f9e6e, 0xc0433f, 0x3f8f9e,
      0x9e6b8f, 0x6f86c4, 0xb07d3a,
    ],
    misc: 0xa39a89,
  },
  openclaw: {
    name: "OpenClaw",
    canvasBg: null,
    fog: { color: 0x0a0b0e, near: 40, far: 130 },
    branch: { color: 0xff7a4d, opacity: 0.2, width: 1 },
    glow: { opacity: 0.3, size: 1.25, blend: "additive" },
    file: {
      size: 0.52,
      opacity: 1.0,
      blend: "additive",
      minPx: 2,
      maxPx: 26,
      dim: 0x2a2d33,
    },
    palette: [
      0xff6a3d, 0x36d6e7, 0x9d7bff, 0xb6e34d, 0xffb23d, 0xff5db1, 0x2fe0b0,
      0x5aa6ff, 0xff8a5c, 0x7cf2c0,
    ],
    misc: 0x6b7280,
  },
};
