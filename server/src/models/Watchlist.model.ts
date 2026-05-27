export interface WatchlistItem {
  ticker: string;
  name: string;
  addedAt: string;
  buyPrice?: number;
}

export interface WatchlistRecord {
  userId: string;
  items: WatchlistItem[];
  updatedAt: string;
}
