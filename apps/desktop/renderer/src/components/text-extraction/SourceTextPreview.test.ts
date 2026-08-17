import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SourceTextPreview from './SourceTextPreview.vue';

interface ViewportMetrics {
  clientHeight: number;
  scrollHeight: number;
  scrollTop: number;
}

class ResizeObserverMock {
  static instances: ResizeObserverMock[] = [];

  readonly disconnect = vi.fn();
  readonly observe = vi.fn();

  constructor(private readonly callback: ResizeObserverCallback) {
    ResizeObserverMock.instances.push(this);
  }

  trigger(): void {
    this.callback([], this as unknown as ResizeObserver);
  }
}

async function mountPreview(
  metrics: ViewportMetrics,
  props: Partial<{
    text: string;
    loading: boolean;
    done: boolean;
    errorMessage: string;
    resetKey: number;
  }> = {},
) {
  const wrapper = mount(SourceTextPreview, {
    props: {
      text: '',
      loading: false,
      done: false,
      errorMessage: '',
      resetKey: 0,
      ...props,
    },
  });
  const viewport = wrapper.get<HTMLElement>('.preview-viewport').element;
  const lineMeasure = wrapper.get<HTMLElement>('.line-measure').element;
  Object.defineProperties(viewport, {
    clientHeight: { configurable: true, get: () => metrics.clientHeight },
    scrollHeight: { configurable: true, get: () => metrics.scrollHeight },
    scrollTop: {
      configurable: true,
      get: () => metrics.scrollTop,
      set: (value: number) => {
        metrics.scrollTop = value;
      },
    },
  });
  vi.spyOn(lineMeasure, 'getBoundingClientRect').mockReturnValue({
    bottom: 20,
    height: 20,
    left: 0,
    right: 10,
    top: 0,
    width: 10,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
  await flushPromises();
  return { viewport, wrapper };
}

describe('source text preview', () => {
  beforeEach(() => {
    ResizeObserverMock.instances = [];
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('首次挂载请求两个视口，并在响应内容不足时立即续取', async () => {
    const metrics = { clientHeight: 100, scrollHeight: 100, scrollTop: 0 };
    const { wrapper } = await mountPreview(metrics);

    expect(wrapper.emitted('requestLines')).toEqual([[10]]);

    await wrapper.setProps({ loading: true });
    await wrapper.setProps({ loading: false, text: '一行短文本\n' });
    await flushPromises();

    expect(wrapper.emitted('requestLines')).toEqual([[10], [10]]);
    wrapper.unmount();
  });

  it('容器放大后缓存不足时续取', async () => {
    const metrics = { clientHeight: 100, scrollHeight: 300, scrollTop: 0 };
    const { wrapper } = await mountPreview(metrics);

    await wrapper.setProps({ loading: true });
    await wrapper.setProps({ loading: false, text: '已有内容\n' });
    await flushPromises();
    expect(wrapper.emitted('requestLines')).toEqual([[10]]);

    metrics.clientHeight = 200;
    ResizeObserverMock.instances[0]?.trigger();
    await flushPromises();

    expect(wrapper.emitted('requestLines')).toEqual([[10], [20]]);
    wrapper.unmount();
  });

  it('按折行后的像素高度预取单个超长逻辑行', async () => {
    const metrics = { clientHeight: 100, scrollHeight: 400, scrollTop: 250 };
    const { wrapper } = await mountPreview(metrics, { text: '中'.repeat(2_000) });

    expect(wrapper.emitted('requestLines')).toEqual([[31]]);
    wrapper.unmount();
  });

  it('快速滚动扩大批次且不重复发出并发请求', async () => {
    const metrics = { clientHeight: 100, scrollHeight: 1_000, scrollTop: 0 };
    const { viewport, wrapper } = await mountPreview(metrics, { text: '已有内容\n' });

    metrics.scrollTop = 900;
    viewport.dispatchEvent(new Event('scroll'));
    viewport.dispatchEvent(new Event('scroll'));
    viewport.dispatchEvent(new Event('scroll'));
    await flushPromises();

    expect(wrapper.emitted('requestLines')).toEqual([[40]]);
    wrapper.unmount();
  });

  it('编码重置会清空旧滚动量和分片请求状态', async () => {
    const metrics = { clientHeight: 100, scrollHeight: 1_000, scrollTop: 600 };
    const { wrapper } = await mountPreview(metrics, { text: '旧编码内容\n' });
    expect(wrapper.emitted('requestLines')).toBeUndefined();

    await wrapper.setProps({ resetKey: 1, text: '' });
    await flushPromises();
    expect(metrics.scrollTop).toBe(0);
    expect(wrapper.emitted('requestLines')).toEqual([[10]]);

    await wrapper.setProps({ loading: true });
    metrics.scrollHeight = 150;
    await wrapper.setProps({ loading: false, text: '新编码内容\n' });
    await flushPromises();

    expect(wrapper.emitted('requestLines')).toEqual([[10], [10]]);
    wrapper.unmount();
  });
});
