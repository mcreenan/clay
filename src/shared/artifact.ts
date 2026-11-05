/** New saves use .clay; older .caddis files remain readable. */
export const ARTIFACT_EXT = "clay";
export const ARTIFACT_OPEN_EXTENSIONS = [ARTIFACT_EXT, "caddis"];

export function isArtifactPath(file: string) {
  return ARTIFACT_OPEN_EXTENSIONS.some((ext) => file.toLowerCase().endsWith(`.${ext}`));
}

/** Replace a legacy extension instead of appending a second extension. */
export function clayArtifactPath(file: string) {
  return isArtifactPath(file) ? file.replace(/\.[^.]+$/, `.${ARTIFACT_EXT}`) : `${file}.${ARTIFACT_EXT}`;
}
