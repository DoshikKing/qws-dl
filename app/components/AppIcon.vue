<script setup lang="ts">
withDefaults(defineProps<{ name?: string }>(), { name: "download" });
const paths: Record<string, string> = {
  key: "M14 3a7 7 0 0 0-6.5 9.5L2 18v4h4v-3h3v-3l2-2A7 7 0 1 0 14 3m3 4v.01",
  user: "M4 21v-2a8 8 0 0 1 16 0v2M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8",
  users:
    "M2 21v-2a6 6 0 0 1 12 0v2m2-8a6 6 0 0 1 6 6v2M8 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8m9 0a4 4 0 0 1 0 8",
  shield: "m12 2 8 3v6c0 5-4 8-8 11-4-3-8-6-8-11V5zM8 12l3 3 5-6",
  copy: "M8 8h13v13H8zM16 8V3H3v13h5",
  trash: "M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7",
  download: "M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4",
  queue: "M4 5h16M4 12h12M4 19h8",
  library: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z",
  settings:
    "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2",
  link: "M9 15l6-6M7 10 5 12a5 5 0 0 0 7 7l2-2M10 7l2-2a5 5 0 0 1 7 7l-2 2",
  music:
    "M9 17V5l11-2v12M9 9l11-2M9 17a3 3 0 1 1-3-3 3 3 0 0 1 3 3M20 15a3 3 0 1 1-3-3 3 3 0 0 1 3 3",
  check: "m5 12 4 4L19 6",
  lock: "M6 10h12v11H6zM8 10V6a4 4 0 0 1 8 0v4",
  "arrow-right": "M5 12h14m-6-6 6 6-6 6",
  plus: "M12 5v14M5 12h14",
  close: "m6 6 12 12M18 6 6 18",
  logout: "M9 4H4v16h5m5-13 5 5-5 5M9 12h11",
  alert: "M12 8v5m0 3v.01M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20",
  terminal: "m5 7 4 5-4 5m7 0h7",
  archive: "M4 7h16v14H4zM3 3h18v4H3zM9 11h6",
  search: "M16 16l5 5M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14",
};
</script>
<template>
  <svg
    class="app-icon"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path :d="paths[name] || paths.download" />
  </svg>
</template>
