const { CompositeDisposable, Disposable } = require("lumine");
const { MONITOR_URI } = require("./utils");

let subscriptions = null;
let provider = null;
let pane;
let providerConnections = new Set();

// The workspace may restore this pane before activation and before the kernel
// service arrives. Initialize the singleton slot ahead of both paths.
function initialize() {
  pane ??= null;
}

function activate() {
  initialize();
  if (subscriptions) return;
  subscriptions = new CompositeDisposable(
    lumine.commands.add("lumine-workspace", {
      "jupyter-monitor:toggle-focus": () => toggleFocus(),
    }),
    lumine.workspace.addOpener((uri) => {
      if (uri !== MONITOR_URI) return undefined;
      // A resolved undefined still claims this URI, so the warning path does
      // not fall through to the workspace's ordinary text-editor opener.
      return Promise.resolve(getMonitorPane());
    }),
    new Disposable(() => destroyPane()),
  );
}

function deactivate() {
  subscriptions?.dispose();
  subscriptions = null;
  destroyPane();
  provider = null;
  for (const connection of providerConnections) connection.provider = null;
  providerConnections = new Set();
}

/**
 * Each provider edge owns its binding. An empty table keeps the same pane
 * available while the runtime is absent or replaced.
 */
function consumeJupyterKernel(jupyterProvider) {
  const connections = providerConnections;
  const connection = { provider: jupyterProvider };
  connections.add(connection);
  const refresh = () => {
    if (providerConnections !== connections) return;
    const next = Array.from(connections).at(-1)?.provider ?? null;
    if (provider === next) return;
    provider = next;
    pane?.setProvider(provider);
  };
  refresh();
  return new Disposable(() => {
    connections.delete(connection);
    connection.provider = null;
    refresh();
  });
}

function getMonitorPane() {
  initialize();
  if (!pane) {
    require("@lumine-code/etch").setScheduler(lumine.views);
    const MonitorPane = require("./monitor-pane");
    const created = new MonitorPane(provider);
    created.onDidDestroy(() => {
      if (pane === created) {
        pane = null;
      }
    });
    pane = created;
  }
  return pane;
}

function destroyPane() {
  pane?.destroy();
  pane = null;
}

function deserializeMonitorPane() {
  return getMonitorPane();
}

// Toggle, but focus it when it is being shown: the table is driven by the
// keyboard, so opening it without focus would be half a command.
async function toggleFocus() {
  const activation = subscriptions;
  const paneForUri = lumine.workspace.paneForURI(MONITOR_URI);
  const element = paneForUri?.element;
  const isFocused =
    element &&
    (element.offsetWidth !== 0 || element.offsetHeight !== 0) &&
    element.contains(document.activeElement);

  if (isFocused) {
    lumine.workspace.getCenter().activate();
    return;
  }

  if (!provider) await lumine.packages.requestService("jupyter.kernel", "^1.0.0");
  if (!activation || subscriptions !== activation || activation.disposed) return;

  const item = await lumine.workspace.open(MONITOR_URI, { searchAllPanes: true });
  item?.focus?.();
}

module.exports = {
  provideBackgroundTips() {
    return {
      packageName: "jupyter-monitor",
      tips: [
        "You can see every running kernel, and interrupt or restart any of them, with {{ 'jupyter-monitor:toggle-focus' | keystroke }}",
      ],
    };
  },

  initialize,
  activate,
  deactivate,
  deserializeMonitorPane,
  consumeJupyterKernel,
  toggleFocus,
};
