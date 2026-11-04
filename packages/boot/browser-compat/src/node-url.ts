/** Browser shim for the Cordis Loader resolver's URL helpers. */
const url = {
  fileURLToPath: (value: string | URL) => String(value),
  pathToFileURL: (value: string) => new URL(value, "file:///"),
};
export default url;
export const fileURLToPath = url.fileURLToPath;
export const pathToFileURL = url.pathToFileURL;
