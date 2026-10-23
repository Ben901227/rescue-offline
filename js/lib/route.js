// 搜救路線：計算長度，以及轉成 GPX 航跡。
import { distance } from './twd97.js';

export function routeLength(points) {
  let m = 0;
  for (let i = 1; i < points.length; i++) m += distance(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1]);
  return m;
}

export const ROUTE_COLORS = ['#e11d48', '#2563eb', '#16a34a', '#9333ea', '#ea580c', '#0891b2'];
