// Scene-graph color/material config per visual style.
// Chrome (panels, labels, buttons) is themed in CSS via [data-theme].

export const THEMES = {
  parchment: {
    name: "Parchemin",
    fog: { color: 0xe9e2d2, near: 42, far: 150 },
    branch: { color: 0x7a6a52, opacity: 0.32, width: 1 },
    glow: { opacity: 0.15, size: 1.0, blend: "normal" },
    file: { size: 0.46, opacity: 0.95, blend: "normal", dim: 0x9c9486 },
    pulse: { blend: "normal", size: 0.7, fade: 0xe6ddc9 },
    ring: { opacity: 0.4, disc: 0.05 },
    arc: { opacity: 0.16 },
    palette: [
      0x4a7fb5, 0x7d5bbf, 0x96892f, 0xc66e36, 0x3f9e6e, 0xc0433f, 0x3f8f9e,
      0x9e6b8f, 0x6f86c4, 0xb07d3a,
    ],
    misc: 0xa39a89,
  },
};
