export default defineNuxtConfig({
  compatibilityDate: "2026-01-01",
  devtools: { enabled: false },
  // Vue's built-in tag list predates <search>; keep it native, even near a search ref.
  vue: { compilerOptions: { isCustomElement: (tag) => tag === 'search' } },
  hooks: {
    'build:manifest'(manifest) {
      // Lazy private sections should load on demand, including on public share pages.
      for (const chunk of Object.values(manifest)) chunk.prefetch = false;
    },
  },
  css: ["~/assets/main.css"],
  app: {
    baseURL: process.env.NUXT_APP_BASE_URL || "/",
    head: {
      title: "QWS · OrpheusDL",
      htmlAttrs: { lang: "ru" },
      meta: [
        { name: "color-scheme", content: "light dark" },
        {
          name: "description",
          content: "Веб-интерфейс OrpheusDL.",
        },
      ],
    },
  },
  nitro: { preset: "node-server" },
});
