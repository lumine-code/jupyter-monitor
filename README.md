# jupyter-monitor

Watch every running Jupyter kernel in one table.

Keep a dockable overview of local and remote sessions, their connection and execution state, and the documents they serve. Sessions and processes remain owned by jupyter-repl.

## Features

- **Live sessions**: lists running kernels, gateway names, execution counts, timing and served documents.
- **Session control**: interrupts, restarts and shuts down the selected session through its public API.
- **Remote names**: renames sessions whose provider exposes that capability.
- **Navigation**: opens served documents from a row or its individual file links.
- **Persistence**: restores the same dock item before the runtime is available and reconnects it when a provider arrives.

## Installation

To install jupyter-monitor search for it in the Install pane of the Lumine settings, or run the command `lumine --install lumine-code/jupyter-monitor`. Install jupyter-repl to provide running sessions.

## Commands

Commands available in `lumine-workspace`:

- `jupyter-monitor:toggle-focus`: focus the monitor or return focus to the editor.

Commands available in `.jupyter-monitor .monitor-wrapper`:

- `jupyter-monitor:open-files`: open documents served by the selected session,
- `jupyter-monitor:interrupt`: interrupt the selected session,
- `jupyter-monitor:restart`: restart the selected session,
- `jupyter-monitor:shutdown`: shut down the selected session.

## Customization

Add this to your `styles.css` to adjust the table density.

```css
.jupyter-monitor .monitor-table td {
  padding: 0.5em 0.75em;
  color: var(--text-color);
}
```

## Services

- `jupyter.kernel`: consumed to observe public sessions and control the selected one.
- `background-tips.provider`: provided to introduce the kernel overview in the empty workspace.

## Contributing

Got ideas to make this package better, found a bug, or want to help add new features? Just drop your thoughts on GitHub. Any feedback is welcome!
