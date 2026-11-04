/** Browser shim for the Cordis Loader resolver's file helpers. */
const unavailable = async (): Promise<never> => { throw new Error("Node filesystem writes are unavailable in the browser"); };
const fsPromises = { writeFile: unavailable, rename: unavailable, mkdir: unavailable };
export default fsPromises;
export const writeFile = fsPromises.writeFile;
export const rename = fsPromises.rename;
export const mkdir = fsPromises.mkdir;
