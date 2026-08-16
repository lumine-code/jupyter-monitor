const { CompositeDisposable, Disposable } = require("lumine");
const { MONITOR_URI } = require("./utils");
const etch = require("@lumine-code/etch");

// Etch holds its scheduler per copy of the library, and this package resolves
// its own copy — so the assignment the editor makes on core's copy never
// reaches it. Point it at the view registry before anything renders, or this
// package's DOM writes land on an animation frame of their own alongside the
// editor's and force a synchronous reflow.
etch.setScheduler(lumine.views);

let subscriptions = null;
let provider = null;
let pane = null;

function activate() {
  subscriptions = new CompositeDisposable(
    lumine.commands.add("lumine-workspace", {
      "jupyter-monitor:toggle-focus": () => toggleFocus(),
    }),
    lumine.workspace.addOpener((uri) => (uri === MONITOR_URI ? createPane() : undefined)),
    // The pane holds a view built against the provider, so it cannot outlive it.
    new Disposable(() => destroyPane()),
  );
}

function deactivate() {
  subscriptions?.dispose();
  subscriptions = null;
}

/**
 * Consume the kernel provider. Without it there is nothing to monitor, so the
 * pane is torn down if the provider goes away.
 */
function consumeJupyterKernel(jupyterProvider) {
  provider = jupyterProvider;
  return new Disposable(() => {
    provider = null;
    destroyPane();
  });
}

function createPane() {
  if (!provider) {
    lumine.notifications.addWarning("jupyter-monitor", {
      description: "Waiting for `jupyter-repl` to provide a kernel.",
    });
    return undefined;
  }
  const MonitorPane = require("./monitor-pane");
  pane = new MonitorPane(provider);
  return pane;
}

function destroyPane() {
  const item = lumine.workspace
    .getPaneItems()
    .find((candidate) => candidate.getURI?.() === MONITOR_URI);
  item?.destroy();
  pane = null;
}

// Toggle, but focus it when it is being shown: the table is driven by the
// keyboard, so opening it without focus would be half a command.
async function toggleFocus() {
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

  const item = await lumine.workspace.open(MONITOR_URI, { searchAllPanes: true });
  item?.focus?.();
}

module.exports = { activate, deactivate, consumeJupyterKernel };
