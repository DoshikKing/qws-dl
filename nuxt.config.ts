export default defineNuxtConfig({
  compatibilityDate: "2026-01-01",
  devtools: { enabled: false },
  css: ["~/assets/main.css"],
  app: {
    baseURL: process.env.NUXT_APP_BASE_URL || "/",
    head: {
      title: "QWS · OrpheusDL",
      htmlAttrs: { lang: "ru" },
      meta: [
        {
          name: "description",
          content: "Веб-интерфейс OrpheusDL.",
        },
      ],
    },
  },
  nitro: { preset: "node-server" },
});
