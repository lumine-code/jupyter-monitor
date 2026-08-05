const { CompositeDisposable, Disposable, Emitter } = require("atom");
const { MONITOR_URI } = require("./utils");
const Monitor = require("./monitor");

class MonitorPane {
  constructor(provider) {
    this.emitter = new Emitter();
    this.element = document.createElement("div");
    this.element.classList.add("jupyter-monitor");
    this.element.tabIndex = -1;

    this.component = new Monitor({ provider });
    this.element.appendChild(this.component.element);

    this.element.addEventListener("focus", this.redirectFocus);
    this.disposer = new CompositeDisposable(
      new Disposable(() => this.element.removeEventListener("focus", this.redirectFocus)),
      new Disposable(() => this.component.destroy()),
    );
  }

  getTitle = () => "Monitor";
  getIconName = () => "pulse";
  getURI = () => MONITOR_URI;
  getDefaultLocation = () => "bottom";
  getAllowedLocations = () => ["bottom", "left", "right"];

  // The table is what takes the keyboard, not the pane wrapper around it.
  getFocusTarget() {
    return this.element.querySelector(".monitor-wrapper") || this.element;
  }

  redirectFocus = (event) => {
    if (event.target !== this.element) {
      return;
    }
    const target = this.getFocusTarget();
    if (target !== this.element) {
      requestAnimationFrame(() => {
        // Stand down when focus moved on while this was pending: an explicit
        // focusExpression() — or the user clicking anywhere — must not be
        // overridden by a deferred hand-off from an earlier focus.
        if (document.activeElement === this.element) {
          target.focus?.({ preventScroll: true });
        }
      });
    }
  };

  focus = () => {
    this.getFocusTarget().focus?.({ preventScroll: true });
  };

  /**
   * A pane only drops an item it is told about. Destroying the item directly —
   * which is what happens when the kernel service goes away — leaves the tab
   * behind without this.
   *
   * @param {Function} callback
   * @returns {Disposable}
   */
  onDidDestroy(callback) {
    return this.emitter.on("did-destroy", callback);
  }

  destroy() {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.disposer.dispose();
    this.element.remove();
    this.emitter.emit("did-destroy");
    this.emitter.dispose();
  }
}

module.exports = MonitorPane;
