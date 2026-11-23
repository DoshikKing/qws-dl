export const audioFormats = {
  original: 'Исходный формат', mp3: 'MP3 · 320 кбит/с', aac: 'AAC · .m4a · 256 кбит/с',
  vorbis: 'Vorbis · .ogg · VBR q6', opus: 'Opus · 192 кбит/с', ape: 'APE · без потерь',
  alac: 'ALAC · .m4a · без потерь', dsd: 'DSD64 · .dsf', tta: 'TTA · без потерь',
};
export function validateOutputFormat(value = 'original') {
  if (typeof value !== 'string' || !Object.hasOwn(audioFormats, value)) throw new Error('Выберите поддерживаемый выходной формат.');
  return value;
}
