import type { MenuItemConstructorOptions } from 'electron';

interface ApplicationMenuOptions {
  readonly isMacOS: boolean;
  readonly openProjectLauncher: () => void;
}

export function createApplicationMenuTemplate(
  options: ApplicationMenuOptions,
): MenuItemConstructorOptions[] {
  return [
    ...(options.isMacOS
      ? [{ role: 'appMenu' as const }]
      : []),
    {
      label: '文件',
      submenu: [
        {
          label: '打开项目启动器',
          accelerator: 'CommandOrControl+O',
          click: options.openProjectLauncher,
        },
        { type: 'separator' },
        { role: 'close' },
      ],
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    {
      label: '帮助',
      role: 'help',
      submenu: [
        {
          label: '切换开发人员模式',
          role: 'toggleDevTools',
        },
      ],
    },
  ];
}
