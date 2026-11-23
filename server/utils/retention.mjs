export function retentionPolicy(retentionMode = 'time', retentionHours = 24, downloadLimit = 1, maxHours = 24, downloadRetentionHours = 168) {
  if (!['time', 'downloads'].includes(retentionMode))
    throw new Error('Выберите хранение по времени или по числу скачиваний.');
  if (!Number.isInteger(retentionHours) || retentionHours < 1 || retentionHours > maxHours)
    throw new Error(`Срок хранения: целое число от 1 до ${maxHours} часов.`);
  if (!Number.isInteger(downloadLimit) || downloadLimit < 1 || downloadLimit > 15)
    throw new Error('Число скачиваний: целое число от 1 до 15.');
  if (!Number.isInteger(downloadRetentionHours) || downloadRetentionHours < 1 || downloadRetentionHours > 720)
    throw new Error('Срок хранения по скачиваниям: целое число от 1 до 720 часов (30 дней).');
  return { retentionMode, retentionHours, downloadLimit, downloadRetentionHours };
}

export function archiveExpiration(job) {
  return new Date(
    Date.parse(job.finishedAt || job.createdAt || new Date().toISOString()) + (job.retentionMode === 'downloads' ? (job.downloadRetentionHours ?? 168) : job.retentionHours) * 3600_000,
  ).toISOString();
}
