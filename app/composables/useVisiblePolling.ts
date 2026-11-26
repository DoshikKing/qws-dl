/** Poll serially only while the page and the consuming panel are visible. */
export function useVisiblePolling(callback: () => Promise<unknown>, delay: number, enabled: () => boolean = () => true) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let mounted = false;
  let running = false;
  const active = () => mounted && document.visibilityState === 'visible' && enabled();
  function clear() { clearTimeout(timer); }
  async function run() {
    clear();
    if (!active() || running) return;
    running = true;
    try { await callback(); }
    finally {
      running = false;
      if (active()) timer = setTimeout(() => { void run(); }, delay);
    }
  }
  function resume() { clear(); if (active()) void run(); }
  watch(enabled, resume);
  onMounted(() => {
    mounted = true;
    document.addEventListener('visibilitychange', resume);
    resume();
  });
  onBeforeUnmount(() => {
    mounted = false;
    clear();
    document.removeEventListener('visibilitychange', resume);
  });
}
