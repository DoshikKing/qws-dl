export function retentionPolicy(retentionMode = 'time', retentionHours = 24, downloadLimit = 1, maxHours = 24) {
  if (!['time', 'downloads'].includes(retentionMode))
    throw new Error('Выберите хранение по времени или по числу скачиваний.');
  if (!Number.isInteger(retentionHours) || retentionHours < 1 || retentionHours > maxHours)
    throw new Error(`Срок хранения: целое число от 1 до ${maxHours} часов.`);
  if (!Number.isInteger(downloadLimit) || downloadLimit < 1 || downloadLimit > 100)
    throw new Error('Число скачиваний: целое число от 1 до 100.');
  return { retentionMode, retentionHours, downloadLimit };
}

export function archiveExpiration(job) {
  return job.retentionMode === 'downloads' ? null : new Date(
    Date.parse(job.finishedAt || job.createdAt || new Date().toISOString()) + job.retentionHours * 3600_000,
  ).toISOString();
}
