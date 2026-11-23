import formatFields from './audio-options.json' with { type: 'json' };
export { formatFields };

export const audioFormats = {
  original: 'Исходный формат', mp3: 'MP3', aac: 'AAC · .m4a',
  vorbis: 'Vorbis · .ogg', opus: 'Opus', ape: 'APE · .ape',
  alac: 'ALAC · .m4a', dsd: 'DSD · .dsf', tta: 'TTA · .tta',
};
export function validateOutputFormat(value = 'original') {
  if (typeof value !== 'string' || !Object.hasOwn(audioFormats, value)) throw new Error('Выберите поддерживаемый выходной формат.');
  return value;
}

export function normalizeFormatOptions(format, options = {}) {
  validateOutputFormat(format);
  const fields = formatFields[format];
  if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(key => !Object.hasOwn(fields, key)))
    throw new Error('Некорректные настройки формата.');
  return Object.fromEntries(Object.entries(fields).map(([key, field]) => {
    const value = Object.hasOwn(options, key) ? options[key] : field.default;
    if (!field.choices.some(([choice]) => choice === value)) throw new Error(`Недопустимое значение: ${field.label}.`);
    return [key, value];
  }));
}

export function describeFormat(format, options = {}) {
  const values = normalizeFormatOptions(format, options);
  return [audioFormats[format], ...Object.entries(formatFields[format])
    .filter(([, field]) => !field.when || values[field.when[0]] === field.when[1])
    .map(([key, field]) => {
      const label = field.choices.find(([value]) => value === values[key])[1];
      if (key === 'bitDepth' && values[key] === 0) return 'Исходная битность';
      if (key === 'sampleRate' && values[key] === 0) return 'Исходная частота';
      if (key === 'compression' && format === 'opus') return `Сложность ${values[key]}`;
      if (key === 'headroom') return `Запас ${label}`;
      return label;
    })].join(' · ');
}
