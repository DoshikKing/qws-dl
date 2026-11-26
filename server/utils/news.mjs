// Newest first. Every app update needs a new unique id and factual release notes.
export const releases = [
  {
    "id": "2026-11-26-shared-audio",
    "version": "1.5.0",
    "date": "2026-11-26",
    "title": "Прослушивание по внешней ссылке",
    "summary": "Перед скачиванием архива можно прослушать фрагмент песни.",
    "sections": [
      {
        "title": "Предпрослушивание",
        "items": [
          "На странице внешней ссылки можно прослушать до 60 секунд выбранной песни перед скачиванием ZIP. Для альбома или подборки доступен выбор трека.",
          "Такое же прослушивание есть в окне «Поделиться» после создания ссылки. Звук не запускается автоматически; аудио загружается только после Play.",
          "Для совместимости браузеров фрагмент преобразуется в MP3. Исходный ZIP не изменяется; прослушивание не расходует лимит скачиваний и не увеличивает статистику.",
          "Прослушивание доступно только для аудиофайлов этого архива и ограничено сроком ссылки. Отзыв, отключение владельца и удаление архива закрывают доступ, включая выполняющуюся подготовку фрагмента."
        ]
      }
    ],
    "english": {
      "title": "Shared archive audio previews",
      "summary": "Listen to a song preview before downloading a shared archive.",
      "sections": [
        {
          "title": "Playback previews",
          "items": [
            "Public archive pages can play up to 60 seconds of a selected song before ZIP download. Albums and batches offer a track selector.",
            "The sharing dialog also provides playback after creating a link. Audio never autoplays and is fetched only after Play.",
            "Previews are converted to MP3 for browser compatibility. The original ZIP stays unchanged; previews do not consume download limits or add download statistics.",
            "Playback is scoped to audio in that ZIP and the link lifetime. Revocation, owner disablement and archive deletion deny access and stop in-flight preview preparation."
          ]
        }
      ]
    }
  },
  {
    "id": "2026-11-26-modern-web",
    "version": "1.4.0",
    "date": "2026-11-26",
    "title": "Обновление веб-интерфейса",
    "summary": "Раздельная загрузка разделов, меньше фоновых запросов и раннее отображение публичных архивов.",
    "sections": [
      {
        "title": "Интерфейс и загрузка",
        "items": [
          "Разделы приложения загружаются по мере открытия. Публичная страница архива получает сведения при серверном рендеринге; обложка загружается напрямую с высоким приоритетом.",
          "Опросы очереди, архивов, раскрытых списков треков и новостей приостанавливаются в скрытой вкладке и возобновляются при возвращении. Периодические запросы одного опроса не накладываются друг на друга.",
          "Раскрывающиеся панели используют нативную анимацию высоты, где она поддерживается, с прежним вариантом для остальных браузеров. Системная настройка уменьшения движения сохраняется.",
          "Добавлены поисковые области, подсказки клавиатуры и выделение ошибок полей после взаимодействия. Цветовая схема объявляется до загрузки стилей; заголовок вкладки соответствует открытому разделу.",
          "Модальные окна ограничивают передачу прокрутки фону в поддерживающих браузерах. В остальных сохраняются нативная блокировка фокуса и доступность диалога."
        ]
      }
    ],
    "english": {
      "title": "Web interface modernization",
      "summary": "Load sections on demand, reduce background requests and render shared archives earlier.",
      "sections": [
        {
          "title": "Interface and loading",
          "items": [
            "Application sections load on demand. Public archive metadata is server-rendered and artwork loads directly with high priority.",
            "Queue, archive, expanded-track and news polling pauses in hidden tabs and resumes on return. Periodic requests from the same poller run serially.",
            "Disclosures use native intrinsic-size animation where supported, retaining the previous grid fallback and reduced-motion support.",
            "Search landmarks, mobile keyboard hints and interaction-aware invalid-field styles improve forms. Color-scheme metadata is available before styles, and the browser title follows the active section.",
            "Modal dialogs contain background scroll chaining in supporting browsers. Native modal focus containment and accessibility remain available elsewhere."
          ]
        }
      ]
    }
  },
  {
    id: '2026-11-25-single-track-selection', version: '1.3.1', date: '2026-11-25', title: 'Одиночный трек без подборки',
    summary: 'Одна выбранная песня скачивается обычным заданием. Подборка создаётся для нескольких треков.',
    sections: [{ title: 'Выбор треков', items: [
      'Для одного выбранного трека поиск отправляет обычную ссылку и показывает кнопку «Скачать трек».',
      'Два и больше трека объединяются в подборку с общей сессией Qobuz и ZIP. Настройки качества, формата, текстов и хранения сохраняются.',
      'Сервер также обрабатывает пакет с одной уникальной ссылкой как обычный трек, в том числе после удаления повторов.',
    ] }],
    english: {
      title: 'Single-track selection without a batch',
      summary: 'One selected song now creates a normal track job. Batches are created for multiple tracks.',
      sections: [{ title: 'Track selection', items: [
        'Selecting one search track sends a normal URL and displays the Download track action.',
        'Two or more tracks share a batch, authenticated Qobuz client and ZIP. Quality, format, lyrics and retention settings are preserved.',
        'The server also treats a batch request containing one unique canonical URL as a normal track, including after deduplication.',
      ] }],
    },
  },
  {
    id: '2026-11-25-public-archives', version: '1.3.0', date: '2026-11-25', title: 'Внешние ссылки на архивы',
    summary: 'Архивом можно поделиться через отдельную страницу скачивания без входа в приложение.',
    sections: [{ title: 'Поделиться ZIP', items: [
      'В разделе «Архивы» появилась кнопка «Поделиться». Ссылка действует 1, 6 или 24 часа, но не дольше срока хранения архива; её можно отозвать.',
      'Публичная страница показывает обложку, название, исполнителя, длительность, размер ZIP и логин владельца. Для подборок показываются число треков и общая длительность, если теги позволяют её определить.',
      'Ссылка открывает только выбранный ZIP, не авторизует посетителя и не даёт доступ к другим архивам или аккаунту. Публичная страница отделена от личного кабинета.',
      'Удаление архива, исчерпание его лимита, отключение владельца или отзыв закрывают ссылку. Завершённые скачивания расходуют общий лимит архива; HEAD и прерванные передачи — нет.',
      'Ключи хранятся как хеши. Для публичных ответов отключены кеширование, индексация и передача referrer; пример nginx исключает ссылки из журналов. Проверены права, изоляция аккаунтов, срок, подмена и отзыв активной передачи.',
    ] }],
    english: {
      title: 'Public archive links',
      summary: 'Share a ZIP through a dedicated download page without signing the recipient into the application.',
      sections: [{ title: 'Share a ZIP', items: [
        'Archives now offers Share. Links expire after 1, 6 or 24 hours, never outlive the archive, and can be revoked.',
        'The public page shows artwork, title, artist, duration, ZIP size and the sharing username. Multi-track archives show a track count and total duration when metadata is available.',
        'A link grants access to exactly one ZIP. It does not authenticate its recipient or expose other archives or account APIs. Public rendering is isolated from the private workspace.',
        'Archive deletion, download-limit exhaustion, owner disablement and revocation close access. Completed public downloads consume the existing archive limit; HEAD and aborted transfers do not.',
        'Keys are stored as hashes. Public responses disable caching, indexing and referrers; the nginx example excludes share URLs from logs. Tests cover ownership, account isolation, expiry, tampering and active-stream revocation.',
      ] }],
    },
  },
  {
    id: '2026-11-25-track-batches', version: '1.2.0', date: '2026-11-25', title: 'Пакетная загрузка треков',
    summary: 'Выбранные в поиске треки объединяются в одно задание и один ZIP.',
    sections: [{ title: 'Подборки треков', items: [
      'Во вкладке «Треки» можно выбрать до 50 песен и скачать подборку одним заданием с общими настройками качества, формата, текстов и хранения.',
      'OrpheusDL запускается один раз и переиспользует подключение Qobuz для последовательной загрузки всех треков пакета.',
      'Подборку можно раскрыть: видны состояния песен и ошибки. Повтор отдельного трека сохраняется отдельным ZIP, как и у альбомов.',
      'Ошибки отдельных треков не удаляют успешные файлы. Песни с одинаковыми названиями сохраняются в отдельных папках; альбомы и дискографии остаются самостоятельными заданиями.',
    ] }],
    english: {
      title: 'Batch track downloads',
      summary: 'Selected search tracks now share one download job and one ZIP archive.',
      sections: [{ title: 'Track batches', items: [
        'Select up to 50 songs in Tracks and queue one batch with shared quality, format, lyrics and retention settings.',
        'OrpheusDL runs once and reuses its authenticated Qobuz client while downloading batch tracks sequentially.',
        'Expand the batch to inspect per-track statuses and errors. Single-track retries retain the job settings and produce a separate ZIP, matching album retries.',
        'Individual track failures preserve successful files. Separate folders prevent same-title songs from overwriting one another; albums and artist discographies remain separate jobs.',
      ] }],
    },
  },
  {
    id: '2026-11-24-usage-statistics', version: '1.1.0', date: '2026-11-24', title: 'Статистика скачиваний',
    summary: 'Личные счётчики архивов, треков и жанров; администратор видит сводку всех пользователей.',
    sections: [{ title: 'Использование приложения', items: [
      'В настройках появилась «Ваша статистика»: завершённые скачивания ZIP, число треков и распределение по жанрам из тегов.',
      'Администратор видит статистику всех аккаунтов в разделе «Пользователи» и может выбрать пользователя для просмотра жанров.',
      'Повторные скачивания учитываются повторно, прерванные передачи и запросы HEAD — нет. Файлы из раздела «Тексты» не входят в сводку.',
      'Счётчики сохраняются после удаления архивов и очистки истории. Учёт начинается после обновления: прошлые скачивания не восстанавливаются; архивы без сведений о треках помечаются отдельно.',
      'Для локальной установки нужен Node.js 22.13 или новее со встроенной SQLite; Docker уже использует подходящий Node 22.',
    ] }],
    english: {
      title: 'Download usage statistics',
      summary: 'Personal archive, track and genre totals, with an administrator overview of every account.',
      sections: [{ title: 'Application usage', items: [
        'Settings now includes personal statistics for completed ZIP transfers, audio-track counts and genres from embedded tags.',
        'Administrators can view all accounts in Users and select an account to inspect its genre breakdown.',
        'Repeated downloads count again; interrupted transfers and HEAD requests do not count. Lyrics-upload exports are excluded.',
        'Totals survive archive deletion and history pruning. Collection starts after this update; past downloads cannot be reconstructed, and archives without track summaries are identified separately.',
        'Local Node.js installations now require version 22.13 or newer for built-in SQLite. Docker uses the supported Node 22 runtime.',
      ] }],
    },
  },
  {
    id: '2026-11-23-github-releases', version: '1.0.0', date: '2026-11-23', title: 'Первый версионный релиз',
    summary: 'Релизы QWS теперь имеют версии, теги и отдельные архивы на GitHub.',
    sections: [
      { title: 'Релизы на GitHub', items: [
        'Каждый релиз содержит английское описание изменений и ссылку на русский файл, архив исходников и контрольные суммы SHA-256.',
        'Архив можно распаковать и развернуть через Docker Compose. Проверки и сборка выполняются до публикации.',
        'Следующие версии будут доступны в GitHub Releases с тегами и ссылками на сравнение изменений.',
      ] },
      { title: 'Что входит в v1.0.0', items: [
        'Поиск треков, альбомов и исполнителей с обложками, загрузки через OrpheusDL и Qobuz, докачка после обрыва и повтор отдельных треков.',
        'Тексты через LRCLIB с тегами и файлами .lrc, обработка загруженных пользователем аудиофайлов и настройки восьми выходных форматов.',
        'Личные архивы, хранение по времени или числу скачиваний, приглашения, администрирование и сохраняемые настройки по умолчанию.',
        'Новости приложения и уточнённая проверка срока подписки Qobuz без ложного истечения по исторической дате.',
      ] },
    ],
    english: {
      title: 'First versioned release',
      summary: 'QWS now has numbered GitHub releases with tags, downloadable sources and bilingual release notes.',
      sections: [
        { title: 'Release distribution', items: [
          'English release descriptions link to a separate Russian Markdown asset. Each release includes a source archive and SHA-256 checksums.',
          'Extract the source archive and deploy with Docker Compose. Validation and the application build run before publication.',
          'Future versions will appear in GitHub Releases with version tags and comparison links.',
        ] },
        { title: 'Included in v1.0.0', items: [
          'Track, album and artist search with artwork; OrpheusDL/Qobuz downloads; interrupted-transfer resume and per-track retries.',
          'LRCLIB lyrics embedded in tags and .lrc sidecars, user-uploaded audio enrichment, and configurable conversion to eight output formats.',
          'Personal archives, retention by time or completed downloads, invitations, administration and persistent application defaults.',
          'In-app update news and corrected subscription checks that do not infer Qobuz expiry from historical billing dates.',
        ] },
      ],
    },
  },
  {
    id: '2026-11-23-qobuz-date-fix', date: '2026-11-23', title: 'Уточнение срока подписки Qobuz',
    summary: 'Исправлено ложное сообщение об окончании подписки по старой дате Qobuz.',
    sections: [{ title: 'Подписка Qobuz', items: [
      'Сведения запрашиваются из текущего профиля. Историческая дата при действующем или неизвестном доступе отмечается как неподтверждённая.',
      'В настройках администратора появилась кнопка «Обновить данные». Время проверки отображается отдельно от срока подписки.',
    ] }],
  },
  {
    id: '2026-11-23-qobuz-subscription', date: '2026-11-23', title: 'Срок подписки Qobuz и обновлённое меню',
    summary: 'Боковое меню стало светлее. Администратору доступны сведения о периоде подписки Qobuz.',
    sections: [
      { title: 'Боковое меню', items: ['Левая панель слегка высветлена в светлой и тёмной темах с сохранением общей палитры.'] },
      { title: 'Подписка Qobuz', items: [
        'Администратор видит дату конца текущего периода, остаток дней и сведения об автопродлении. Индикатор открывает настройки Qobuz.',
        'За семь дней до конца периода появляется предупреждение. При отсутствии даты или устаревших данных это явно указано.',
        'Сведения обновляются вместе с сессией Qobuz и не показываются обычным пользователям.',
      ] },
    ],
  },
  {
    id: '2026-11-23-news', date: '2026-11-23', title: 'Больше возможностей для загрузок',
    summary: 'Настройки аудиоформатов, управление архивами и новости об обновлениях.',
    sections: [
      { title: 'Форматы и конвертация', items: [
        'Перед добавлением ссылки или результата поиска можно выбрать MP3, AAC, Vorbis, Opus, APE, ALAC, DSD или TTA. Исходный формат остаётся доступен.',
        'В блоке «Настройки формата» доступны параметры выбранного кодека: битрейт, CBR/VBR, сжатие, битность и частота. Для DSD — DSD64/128/256 и запас уровня.',
        'Обложки, основные теги и тексты переносятся в новый файл. Настройки наследуются при повторе отдельного трека.',
      ] },
      { title: 'Хранение и удаление архивов', items: [
        'Можно выбрать хранение по времени или от 1 до 15 завершённых скачиваний. Во втором режиме также действует срок: по умолчанию неделя; администратор задаёт от 1 часа до 30 дней.',
        'Каждый пользователь может удалить собственный архив в разделе «Архивы». Перед удалением появляется подтверждение; история загрузки сохраняется.',
        'Администратор сохраняет общие настройки по умолчанию и отдельные параметры хранения для двух режимов.',
      ] },
      { title: 'Поиск и тексты песен', items: [
        'В поиске есть отдельные вкладки треков, альбомов и исполнителей с обложками.',
        'LRCLIB помогает добавлять тексты к загрузкам. Для своего аудиофайла можно получить ZIP с обновлёнными тегами и файлом .lrc.',
      ] },
      { title: 'Новости приложения', items: [
        'После обновления появляется уведомление со сводкой изменений. Нажмите на него, чтобы прочитать подробности.',
        'Закройте уведомление или сводку — эта версия больше не появится автоматически. Открыть новости снова можно кнопкой «Новости» в верхней панели.',
      ] },
    ],
  },
];

export function newsFor(user) {
  return { releases, seen: (user.seenReleaseIds || []).includes(releases[0].id) };
}

export function acknowledgeNews(store, user, id) {
  if (!store.users.includes(user) || user.disabled)
    throw Object.assign(new Error('Войдите в аккаунт.'), { statusCode: 401 });
  if (typeof id !== 'string' || !releases.some(release => release.id === id))
    throw Object.assign(new Error('Неизвестная версия обновления.'), { statusCode: 400 });
  if ((user.seenReleaseIds || []).includes(id)) return;
  const seen = new Set([...(user.seenReleaseIds || []), id]);
  const previous = user.seenReleaseIds;
  user.seenReleaseIds = releases.filter(release => seen.has(release.id)).slice(0, 50).map(release => release.id);
  try { store.save(); }
  catch (error) { user.seenReleaseIds = previous; throw error; }
}
