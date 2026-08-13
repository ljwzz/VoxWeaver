import type { WorkspaceStatusBarItem } from '@/workspace/statusBar';

import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import WorkspaceStatusBar from '@/components/workspace/WorkspaceStatusBar.vue';
import statusBarSource from '@/components/workspace/WorkspaceStatusBar.vue?raw';

function styleRule(selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = statusBarSource.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`));
  if (!match?.[1])
    throw new Error(`Missing style rule: ${selector}`);
  return match[1];
}

describe('workspace status bar', () => {
  it('按左右规则渲染状态并保持空分区', () => {
    const items: WorkspaceStatusBarItem[] = [
      { key: 'tts', region: 'application', order: 20, label: 'TTS', value: '正常' },
      { key: 'core', region: 'application', order: 10, label: 'Core', value: '正常', icon: 'ok' },
      { key: 'task-near', region: 'project', order: 10, label: '任务 A', value: '运行中' },
      { key: 'task-far', region: 'project', order: 20, label: '任务 B', value: '等待中' },
    ];
    const wrapper = mount(WorkspaceStatusBar, { props: { items } });

    expect(wrapper.get('[data-region="application"]').findAll('.workspace-status-bar__item').map(item => item.text()))
      .toEqual(['Core: 正常', 'TTS: 正常']);
    expect(wrapper.get('[data-region="project"]').findAll('.workspace-status-bar__item').map(item => item.text()))
      .toEqual(['任务 B: 等待中', '任务 A: 运行中']);
    expect(wrapper.get('[data-status-key="core"] svg').attributes('width')).toBe('16');
    expect(wrapper.get('[data-status-key="core"] svg').attributes('height')).toBe('16');
  });

  it('仅交互状态项触发 activate 并保留 title', async () => {
    const items: WorkspaceStatusBarItem[] = [
      { key: 'passive', region: 'application', order: 10, label: 'Core', value: '正常' },
      {
        key: 'interactive',
        region: 'project',
        order: 10,
        label: '后台任务',
        value: '运行中',
        interactive: true,
        title: '打开任务详情',
      },
    ];
    const wrapper = mount(WorkspaceStatusBar, { props: { items } });

    const passive = wrapper.get('[data-status-key="passive"]');
    const interactive = wrapper.get('[data-status-key="interactive"]');
    expect(passive.element.tagName).toBe('SPAN');
    expect(interactive.element.tagName).toBe('BUTTON');
    expect(interactive.attributes('title')).toBe('打开任务详情');

    await passive.trigger('click');
    expect(wrapper.emitted('activate')).toBeUndefined();
    await interactive.trigger('click');
    expect(wrapper.emitted('activate')).toEqual([['interactive']]);
  });

  it('使用同色 16px 图标表达正常、加载与错误', () => {
    const items: WorkspaceStatusBarItem[] = [
      { key: 'ok', region: 'application', order: 10, label: 'OK', value: '正常', icon: 'ok' },
      { key: 'loading', region: 'application', order: 20, label: 'Loading', value: '启动中', icon: 'loading' },
      { key: 'error', region: 'application', order: 30, label: 'Error', value: '不可用', icon: 'error' },
    ];
    const wrapper = mount(WorkspaceStatusBar, { props: { items } });

    const okIcon = wrapper.get('[data-status-key="ok"] svg');
    expect(okIcon.attributes('fill')).toBe('currentColor');
    expect(okIcon.attributes('stroke-width')).toBe('2');
    expect(wrapper.get('[data-status-key="loading"] svg').classes())
      .toContain('workspace-status-bar__icon--loading');
    expect(wrapper.get('[data-status-key="error"] svg').attributes('stroke-width')).toBe('2');
    expect(wrapper.findAll('.workspace-status-bar__icon')).toHaveLength(3);
  });

  it('锁定 22px 状态栏、12px 字号与 16px 图标样式', () => {
    const barRule = styleRule('.workspace-status-bar');
    expect(barRule).toMatch(/height:\s*22px;/);
    expect(barRule).toMatch(/flex:\s*0 0 22px;/);
    expect(barRule).toMatch(/background:\s*#202522;/);
    expect(barRule).toMatch(/font-size:\s*12px;/);

    const itemRule = styleRule('.workspace-status-bar__item');
    expect(itemRule).toMatch(/gap:\s*4px;/);
    expect(itemRule).toMatch(/padding:\s*0 8px;/);

    const iconRule = styleRule('.workspace-status-bar__icon');
    expect(iconRule).toMatch(/width:\s*16px;/);
    expect(iconRule).toMatch(/height:\s*16px;/);
    expect(iconRule).toMatch(/color:\s*inherit;/);
    expect(statusBarSource).not.toMatch(/#3f8068|#b34444|#b37a1d/);
    expect(statusBarSource).toContain('@media (prefers-reduced-motion: reduce)');
  });
});
