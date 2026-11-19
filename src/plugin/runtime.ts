import type { Services } from '../infrastructure/composition/createServices.js';
import type { JobRegistry } from './service/VideoNotesService.js';

/** Everything a tool may touch, resolved lazily so plugin load stays cheap. */
export interface PluginRuntime {
  /** Build (once) and return the service graph. */
  services(): Services;
  readonly jobs: JobRegistry;
}
