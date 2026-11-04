/** Browser shim: the Cordis Loader's resolver is never used in the page boot path. */
const fs = {
  existsSync: () => false,
};
export default fs;
export const existsSync = fs.existsSync;
