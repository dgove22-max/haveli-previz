import { exportKeepout } from './keepout.js';
import { exportElevations } from './elevations.js';
import { exportScreenshot } from './screenshot.js';

export function createExports(ctx) {
  return {
    keepout:    () => exportKeepout(ctx.model),
    elevations: () => exportElevations(ctx.model),
    screenshot: () => exportScreenshot(ctx)
  };
}
