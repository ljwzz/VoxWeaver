export interface ActivatableWindow {
  isDestroyed: () => boolean;
}

export function findWindowForAppActivation<Window extends ActivatableWindow>(
  projectWindows: Iterable<Window>,
  startupWindow?: Window,
): Window | undefined {
  for (const window of projectWindows) {
    if (!window.isDestroyed())
      return window;
  }

  return startupWindow && !startupWindow.isDestroyed()
    ? startupWindow
    : undefined;
}
