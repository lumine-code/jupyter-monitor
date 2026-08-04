const { CompositeDisposable, Disposable } = require("atom");
const { KERNEL_MONITOR_URI } = require("./utils");
const KernelMonitor = require("./kernel-monitor");

class KernelMonitorPane {
  constructor(provider) {
    this.element = document.createElement("div");
    this.element.classList.add("jupyter-kernel-monitor");
    this.element.tabIndex = -1;

    this.component = new KernelMonitor({ provider });
    this.element.appendChild(this.component.element);

    this.element.addEventListener("focus", this.redirectFocus);
    this.disposer = new CompositeDisposable(
      new Disposable(() => this.element.removeEventListener("focus", this.redirectFocus)),
      new Disposable(() => this.component.destroy()),
    );
  }

  getTitle = () => "Kernel Monitor";
  getIconName = () => "pulse";
  getURI = () => KERNEL_MONITOR_URI;
  getDefaultLocation = () => "bottom";
  getAllowedLocations = () => ["bottom", "left", "right"];

  // The table is what takes the keyboard, not the pane wrapper around it.
  getFocusTarget() {
    return this.element.querySelector(".kernel-monitor-wrapper") || this.element;
  }

  redirectFocus = (event) => {
    if (event.target !== this.element) {
      return;
    }
    const target = this.getFocusTarget();
    if (target !== this.element) {
      requestAnimationFrame(() => target.focus?.({ preventScroll: true }));
    }
  };

  focus = () => {
    this.getFocusTarget().focus?.({ preventScroll: true });
  };

  destroy() {
    this.disposer.dispose();
    this.element.remove();
  }
}

module.exports = KernelMonitorPane;
