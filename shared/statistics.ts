export type UsageSummary = {
  since: string;
  archives: number;
  tracks: number;
  unknownArchives: number;
  genres: { name: string; tracks: number }[];
};
export type UserUsage = UsageSummary & { id: string; username: string; disabled: boolean };
