/**
 * dsh-plugin-admin browser entry (Phase B1: the committed lib/client.js is
 * now a BUILD PRODUCT of this tree — run `npm run build:client` after any
 * edit here; CI fails when the artifact drifts from these sources).
 *
 * The dsh module loader reads exactly `apply` and `inject` off the factory's
 * return value (client-modules manifest: dsh.client.platform === 'web' plus
 * an exports './client' bundle). `loadPanels` rides along for the harnesses:
 * the section components moved into the lazy chunk (Phase B2), so a test that
 * mounts one directly asks for the chunk module first.
 */
import { apply, loadPanels } from './impl.js'

/** Services the browser half needs before it mounts. */
export const inject = ['slots', 'connection']

export { apply, loadPanels }
