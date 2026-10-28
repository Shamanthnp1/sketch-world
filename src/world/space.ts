// World-space constants and geometry types shared by layout, collide, drag and build (design.md "layout").
export const W = 24, Z_BACK = -12, Z_FRONT = 6, HORIZON = 0.35, R_MAX = 1.5, SKY_R = 40;
export type Vec2 = { x: number; z: number };
export type Vec3 = { x: number; y: number; z: number };
export type Circle = { x: number; z: number; r: number };
export type Size = { w: number; h: number };
