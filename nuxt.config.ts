export default defineNuxtConfig({
  compatibilityDate: "2026-01-01",
  devtools: { enabled: false },
  css: ["~/assets/main.css"],
  app: {
    head: {
      title: "QWS · OrpheusDL",
      htmlAttrs: { lang: "ru" },
      meta: [
        {
          name: "description",
          content: "Личная библиотека загрузок Qobuz на OrpheusDL.",
        },
      ],
    },
  },
  nitro: { preset: "node-server" },
});
