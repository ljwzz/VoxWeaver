// @vitest-environment node

import type { MenuItemConstructorOptions } from 'electron';

import { describe, expect, it, vi } from 'vitest';
import { createApplicationMenuTemplate } from './applicationMenu.ts';

function findItem(
  items: readonly MenuItemConstructorOptions[],
  label: string,
): MenuItemConstructorOptions | undefined {
  return items.find(item => item.label === label);
}

function getSubmenu(item: MenuItemConstructorOptions): MenuItemConstructorOptions[] {
  if (!Array.isArray(item.submenu))
    throw new TypeError(`Menu item "${item.label}" has no template submenu.`);
  return item.submenu;
}

describe('application menu', () => {
  it('在帮助菜单中提供开发人员模式切换', () => {
    const template = createApplicationMenuTemplate({
      isMacOS: false,
      openProjectLauncher: vi.fn(),
    });

    const helpMenu = findItem(template, '帮助');

    expect(helpMenu).toMatchObject({ label: '帮助', role: 'help' });
    expect(getSubmenu(helpMenu!)).toContainEqual({
      label: '切换开发人员模式',
      role: 'toggleDevTools',
    });
  });

  it('仅在 macOS 模板中保留应用菜单', () => {
    const openProjectLauncher = vi.fn();

    const macTemplate = createApplicationMenuTemplate({
      isMacOS: true,
      openProjectLauncher,
    });
    const otherTemplate = createApplicationMenuTemplate({
      isMacOS: false,
      openProjectLauncher,
    });

    expect(macTemplate[0]).toEqual({ role: 'appMenu' });
    expect(otherTemplate).not.toContainEqual({ role: 'appMenu' });
  });
});
