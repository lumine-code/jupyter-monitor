const os = require("os");

const MONITOR_URI = "lumine://jupyter-monitor";

/**
 * An editor with no path on disk is keyed by its id, not by a path, so a file
 * name of this shape is a placeholder rather than somewhere to open.
 */
function isUnsavedFilePath(filePath) {
  return /Unsaved\sEditor\s\d+/.test(filePath);
}

/** Replace the home directory in a path with `~`. */
function tildify(absolutePath) {
  const homeDir = os.homedir();
  if (!absolutePath || !homeDir) {
    return absolutePath;
  }
  const normalizedPath = absolutePath.replace(/\\/g, "/");
  const normalizedHome = homeDir.replace(/\\/g, "/");

  if (normalizedPath === normalizedHome) {
    return "~";
  }

  const homeWithSep = normalizedHome.endsWith("/") ? normalizedHome : `${normalizedHome}/`;
  if (normalizedPath.startsWith(homeWithSep)) {
    return `~/${normalizedPath.slice(homeWithSep.length)}`;
  }

  return absolutePath;
}

module.exports = { MONITOR_URI, isUnsavedFilePath, tildify };
