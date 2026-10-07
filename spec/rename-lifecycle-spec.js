const { CompositeDisposable, Disposable, Emitter } = require("lumine");

describe("public session rename ownership", () => {
  let main, pane, events, views, session, edges;

  beforeEach(() => {
    main = require("../lib/main");
    main.initialize();
    main.activate();
    edges = new CompositeDisposable();
    views = [];
    events = new Emitter();
    session = {
      id: "rename-session",
      generation: 1,
      displayName: "Remote",
      gatewayName: "gateway",
      capabilities: { rename: true },
      executionState: "idle",
      isDestroyed: () => false,
      onDidChangeStatus: (callback) => events.on("status", callback),
      onDidChangeGeneration: (callback) => events.on("generation", callback),
      onDidDestroy: (callback) => events.on("destroy", callback),
      rename: jasmine.createSpy("rename").and.resolveTo(true),
      interrupt: jasmine.createSpy("interrupt"),
      restart: jasmine.createSpy("restart"),
      shutdown: jasmine.createSpy("shutdown"),
    };
    const provider = {
      getRunningKernels: () => [session],
      getFilesForKernel: () => [],
      observeActiveKernel(callback) {
        callback(session);
        return new Disposable();
      },
      onDidChangeKernels: () => new Disposable(),
    };
    edges.add(main.consumeJupyterKernel(provider));
    pane = main.deserializeMonitorPane();
    const RenameView = require("../lib/rename-view");
    spyOn(RenameView.prototype, "attach").and.callFake(function () {
      views.push(this);
    });
  });
  afterEach(() => {
    edges.dispose();
    main.deactivate();
    events.dispose();
  });

  it("uses the public rename method once and releases its input editor", () => {
    const baseline = lumine.textEditors.getEditors().length;
    pane.component.promptRename(session);
    expect(lumine.textEditors.getEditors().length).toBe(baseline + 1);
    views[0].miniEditor.setText("Renamed session");
    views[0].confirm();
    views[0].confirm();
    expect(session.rename).toHaveBeenCalledOnceWith("Renamed session");
    expect(lumine.textEditors.getEditors().length).toBe(baseline);
    expect(pane.component.pendingRenames.size).toBe(0);
  });

  it("cancels the rename input on generation replacement", () => {
    pane.component.promptRename(session);
    session.generation++;
    events.emit("generation", session.generation);
    expect(views[0].closed).toBe(true);
    views[0].confirm();
    expect(session.rename).not.toHaveBeenCalled();
  });

  it("closes old rename inputs on provider withdrawal without shutting down sessions", () => {
    pane.component.promptRename(session);
    const previous = pane.component;
    edges.dispose();
    expect(views[0].closed).toBe(true);
    expect(previous.destroyed).toBe(true);
    expect(pane.destroyed).not.toBe(true);
    expect(pane.component.provider.getRunningKernels()).toEqual([]);
    expect(session.shutdown).not.toHaveBeenCalled();
    expect(session.rename).not.toHaveBeenCalled();
    expect(events.handlersByEventName.status).toBeUndefined();
    expect(events.handlersByEventName.generation).toBeUndefined();
  });

  it("does not build rename UI when the public capability is absent", () => {
    session.capabilities.rename = false;
    pane.component.promptRename(session);
    expect(views).toEqual([]);
    expect(session.rename).not.toHaveBeenCalled();
  });
});
