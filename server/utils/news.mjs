// Newest first. Every app update needs a new unique id and factual release notes.
export const releases = [
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
