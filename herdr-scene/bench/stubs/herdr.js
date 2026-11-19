// The host API the mods import, answering as a window at 100% would. Only what
// a drawing reads returns something; the rest does nothing.
const none = () => undefined;

export const settings = () => ({ zoom: 1 });
export const theme = () => ({});
export const props = () => ({});
export const window = () => ({ platform: "bench" });
export const shared = () => ({});
export const home = () => "/nonexistent";
export const appHome = () => "/nonexistent";
export const agents = () => [];
export const knownAgents = () => [];
export const panes = () => [];
export const spaces = () => [];
export const terminals = () => [];
export const focused = () => null;
export const nextCommand = () => null;
export const readTextFile = async () => "";
export const writeTextFile = async () => {};
export const exec = async () => ({ code: 0, stdout: "", stderr: "" });
export const run = async () => ({ code: 0, stdout: "", stderr: "" });
export const hc = none;
export const notify = none;
export const setShared = none;
export const watchFolder = none;
export const openOverlay = none;
export const closeOverlay = none;
