describe("Monitor rename modal host", () => {
  let view;

  beforeEach(() => jasmine.attachToDOM(lumine.workspace.getElement()));
  afterEach(async () => {
    view?.close();
    await view?.destroyPromise;
  });

  it("confirms through InputDialog and retires the input editor once", async () => {
    const RenameView = require("../lib/rename-view");
    const confirmed = jasmine.createSpy("renamed");
    const baseline = lumine.textEditors.getEditors().length;
    view = new RenameView({ prompt: "Session name", defaultText: "Previous" }, confirmed);
    view.attach();
    const editor = view.miniEditor;
    expect(lumine.textEditors.getEditors().length).toBe(baseline + 1);
    expect(editor.getText()).toBe("Previous");
    editor.setText("New session");
    lumine.commands.dispatch(editor.getElement(), "core:confirm");
    await view.destroyPromise;
    view.confirm();
    expect(confirmed).toHaveBeenCalledOnceWith("New session");
    expect(editor.isDestroyed()).toBeTrue();
    expect(lumine.textEditors.getEditors().length).toBe(baseline);
  });

  it("lets Escape cancel through the host and delivers cancellation once", async () => {
    const RenameView = require("../lib/rename-view");
    const cancelled = jasmine.createSpy("cancelled");
    view = new RenameView({ prompt: "Session name" }, null, cancelled);
    view.attach();
    lumine.commands.dispatch(view.miniEditor.getElement(), "core:cancel");
    await view.destroyPromise;
    view.cancel();
    expect(cancelled).toHaveBeenCalledTimes(1);
    expect(view.host.isDestroyed()).toBeTrue();
  });
});
