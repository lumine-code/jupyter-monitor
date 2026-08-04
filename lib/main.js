const { CompositeDisposable, Disposable } = require("atom");
const { KERNEL_MONITOR_URI } = require("./utils");

let subscriptions = null;
let provider = null;
let pane = null;

function activate() {
  subscriptions = new CompositeDisposable(
    atom.commands.add("atom-workspace", {
      "jupyter-monitor:toggle": () => toggle(),
    }),
    atom.workspace.addOpener((uri) => (uri === KERNEL_MONITOR_URI ? createPane() : undefined)),
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
    atom.notifications.addWarning("jupyter-monitor", {
      description: "Waiting for `jupyter-repl` to provide a kernel.",
    });
    return undefined;
  }
  const KernelMonitorPane = require("./kernel-monitor-pane");
  pane = new KernelMonitorPane(provider);
  return pane;
}

function destroyPane() {
  const item = atom.workspace
    .getPaneItems()
    .find((candidate) => candidate.getURI?.() === KERNEL_MONITOR_URI);
  item?.destroy();
  pane = null;
}

// Toggle, but focus it when it is being shown: the table is driven by the
// keyboard, so opening it without focus would be half a command.
async function toggle() {
  const paneForUri = atom.workspace.paneForURI(KERNEL_MONITOR_URI);
  const element = paneForUri?.element;
  const isFocused =
    element &&
    (element.offsetWidth !== 0 || element.offsetHeight !== 0) &&
    element.contains(document.activeElement);

  if (isFocused) {
    atom.workspace.getCenter().activate();
    return;
  }

  const item = await atom.workspace.open(KERNEL_MONITOR_URI, { searchAllPanes: true });
  item?.focus?.();
}

module.exports = { activate, deactivate, consumeJupyterKernel };
