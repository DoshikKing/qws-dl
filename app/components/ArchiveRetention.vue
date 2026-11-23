<script setup lang="ts">
defineProps<{ job: { retentionMode?: string; downloadLimit?: number; downloadCount?: number; retentionHours?: number;
  expiresAt?: string | null; expiredAt?: string | null; deletedAt?: string | null; deletedBy?: string } }>();
const date = (value: string) => new Date(value).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
</script>
<template>
  <span>{{ job.deletedAt ? (job.deletedBy === 'owner' ? 'Удалено владельцем' : 'Удалено администратором')
    : job.expiredAt ? (job.retentionMode === 'downloads' && (job.downloadCount || 0) >= (job.downloadLimit || 1) ? 'Лимит скачиваний исчерпан' : 'Архив удалён')
    : job.retentionMode === 'downloads' ? `Осталось скачиваний: ${Math.max(0, (job.downloadLimit || 1) - (job.downloadCount || 0))} из ${job.downloadLimit || 1}${job.expiresAt ? ` · до ${date(job.expiresAt)}` : ''}`
    : job.expiresAt ? `Доступен до ${date(job.expiresAt)}` : `Хранение после завершения: ${job.retentionHours} ч` }}</span>
</template>
